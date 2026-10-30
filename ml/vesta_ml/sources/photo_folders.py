"""Carpetas de fotos de Unsplash y Pexels etiquetadas por el nombre de sus carpetas (chanclas/, Calzado/zuecos/…).

Solo se aceptan archivos con el nombre que ponen esas webs al descargar, del que salen el autor y la URL de la
foto para la atribución; cualquier otro archivo (p. ej. de Google Imágenes o de una tienda) se rechaza. Las
subcarpetas dentro de la de la subcategoría (por color, por tipo…) solo sirven para organizar: cada foto es
independiente al repartir train/val/test. Varios recortes de una misma foto (mismo nombre con otro sufijo, p. ej.
« (2)») se aceptan y van al mismo split; las copias idénticas se descartan.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from PIL import Image

from ..common import make_record, reset_dir, save_image, write_jsonl
from ..taxonomy import Taxonomy, load_taxonomy

SOURCE = "photo-folders"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".jfif", ".png", ".webp", ".avif", ".bmp", ".gif"}
# Unsplash: nombre-apellido-<id de 11>-unsplash.jpg; Pexels: pexels-<autor>-<número>.jpg o pexels-photo-<número>.jpeg
UNSPLASH = re.compile(r"^(?P<author>.+)-(?P<id>[A-Za-z0-9_-]{11})-unsplash$")
PEXELS = re.compile(r"^pexels-(?P<author>.+?)-(?P<id>\d{4,})$")
LICENSES = {
    "unsplash": ("Unsplash License", "https://unsplash.com/license", "https://unsplash.com/photos/{id}"),
    "pexels": ("Pexels License", "https://www.pexels.com/license/", "https://www.pexels.com/photo/{id}/"),
}


def folder_labels(parts: tuple[str, ...], taxonomy: Taxonomy) -> dict | None:
    """The outermost folder that names a subcategory (or, failing that, a category) gives the label."""
    for part in parts:
        if subcategory := taxonomy.match("subcategory", part):
            return {"category": taxonomy.category_of(subcategory), "subcategory": subcategory}
    for part in parts:
        if category := taxonomy.match("category", part):
            return {"category": category}
    return None


def photo_origin(stem: str) -> tuple[str, str, str] | None:
    """(site, photo id, author) from a downloaded file name, or None if it does not come from Unsplash/Pexels."""
    stem = re.sub(r" \(\d+\)$", "", stem)  # Windows adds " (1)" to repeated downloads.
    if match := UNSPLASH.match(stem):
        return "unsplash", match["id"], match["author"].replace("-", " ")
    if match := PEXELS.match(stem):
        author = match["author"].replace("-", " ")
        return "pexels", match["id"], "" if author == "photo" else author
    return None


def scan(folder: Path, taxonomy: Taxonomy) -> tuple[list[dict], list[str]]:
    """Describes every importable photo under `folder`, plus the rejected paths and why."""
    photos, rejected = [], []
    contents: dict[tuple[str, str], set[str]] = {}
    for path in sorted(folder.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        relative = path.relative_to(folder)
        labels = folder_labels(relative.parts[:-1], taxonomy)
        origin = photo_origin(path.stem)
        if labels is None:
            rejected.append(f"{relative.as_posix()}: la carpeta no es ninguna categoría ni subcategoría")
            continue
        if origin is None:
            rejected.append(f"{relative.as_posix()}: el nombre no es el de una descarga de Unsplash o Pexels")
            continue
        site, photo_id, author = origin
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        seen = contents.setdefault((site, photo_id), set())
        if digest in seen:
            rejected.append(f"{relative.as_posix()}: foto repetida")
            continue
        seen.add(digest)
        # Different files with the same photo id are crops of one photo: they share a group, so a split.
        # Subfolders (by color, by type…) only organize them.
        photos.append({"path": path, "site": site, "photo_id": photo_id, "crop": len(seen), "author": author,
                       "group": f"{SOURCE}:{site}:{photo_id}", "labels": labels})
    return photos, rejected


def prepare(root: Path, folder: Path) -> Path:
    photos, rejected = scan(folder, load_taxonomy())
    for line in rejected:
        print(f"  rechazada {line}")
    output = reset_dir(root / "sources" / SOURCE)
    records = []
    for photo in photos:
        name, license_url, photo_url = LICENSES[photo["site"]]
        key = f"{photo['site']}-{photo['photo_id']}" + (f"-{photo['crop']}" if photo["crop"] > 1 else "")
        destination = output / "images" / f"{key}.jpg"
        try:
            with Image.open(photo["path"]) as image:
                width, height = save_image(image, destination)
        except Exception:
            print(f"  rechazada {photo['path'].relative_to(folder).as_posix()}: no se puede abrir")
            continue
        url = photo_url.format(id=photo["photo_id"])
        records.append(make_record(
            record_id=f"{SOURCE}:{key.replace('-', ':', 1)}", source=SOURCE, image=destination, root=root,
            group=photo["group"], labels=photo["labels"], license_name=name, license_url=license_url,
            attribution=f"{photo['author']} — {url}" if photo["author"] else url,
            meta={"width": width, "height": height},
        ))
    manifest = output / "manifest.jsonl"
    count = write_jsonl(manifest, records)
    print(f"{SOURCE}: {count} fotos importadas, {len(rejected)} rechazadas")
    return manifest
