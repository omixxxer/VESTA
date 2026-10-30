"""Open Images V7: recortes de objetos (reloj, corbata, gafas, calzado…) de fotos de Flickr.

Las cajas son CC BY 4.0 (Google) y cada foto conserva la licencia de su autor; solo se usan las CC BY 2.0 (ver
source_mappings.json). Las clases y el máximo por subcategoría están en source_mappings.json. No se descarga el
dataset entero: los CSV se leen en streaming y solo se guardan las filas de las clases elegidas, y de cada foto
solo se guardan los recortes. Reanudable: los recortes ya guardados no se vuelven a descargar.
"""

from __future__ import annotations

import csv
import hashlib
import io
import sys
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from PIL import Image

from ..common import make_record, save_image, write_jsonl
from ..taxonomy import load_source_mappings

SOURCE = "open-images"
BASE_URL = "https://storage.googleapis.com/openimages"
CLASSES_PATH = "v7/oidv7-class-descriptions-boxable.csv"
BOXES_PATHS = {
    "train": "v6/oidv6-train-annotations-bbox.csv",  # ~2,3 GB, se lee en streaming
    "validation": "v5/validation-annotations-bbox.csv",
    "test": "v5/test-annotations-bbox.csv",
}
IMAGES_PATHS = {
    "train": "2018_04/train/train-images-boxable-with-rotation.csv",  # ~640 MB, se lee en streaming
    "validation": "2018_04/validation/validation-images-with-rotation.csv",
    "test": "2018_04/test/test-images-with-rotation.csv",
}
IMAGE_URL = "https://open-images-dataset.s3.amazonaws.com/{subset}/{image_id}.jpg"
ANNOTATION_LICENSE = "CC BY 4.0 (cajas, Google Open Images)"
MIN_BOX_FRACTION = 0.04  # descarta cajas diminutas antes de descargar nada
MIN_CROP_SIDE = 64
CROP_PADDING = 0.1
MAX_CROPS_PER_IMAGE = 2
DOWNLOAD_WORKERS = 16


def filtered_rows(url: str, cache: Path, keep: Callable[[dict], bool]) -> list[dict]:
    """Streams a CSV and keeps the matching rows in a small local cache, so the large files are never stored."""
    if cache.exists():
        with cache.open(encoding="utf-8", newline="") as handle:
            return list(csv.DictReader(handle))
    print(f"Leyendo {url}")
    cache.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    request = urllib.request.Request(url, headers={"User-Agent": "vesta-ml"})
    with urllib.request.urlopen(request) as response:
        reader = csv.DictReader(io.TextIOWrapper(response, encoding="utf-8", newline=""))
        fields = reader.fieldnames
        for index, row in enumerate(reader):
            if keep(row):
                rows.append(row)
            if index % 1_000_000 == 0 and index:
                print(f"\r  {index / 1e6:.0f} M filas, {len(rows)} útiles", end="", file=sys.stderr)
    print(file=sys.stderr)
    partial = cache.with_name(cache.name + ".part")
    with partial.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    partial.replace(cache)
    return rows


def usable_box(row: dict) -> bool:
    if row["IsGroupOf"] == "1" or row["IsDepiction"] == "1":
        return False
    return (float(row["XMax"]) - float(row["XMin"]) >= MIN_BOX_FRACTION
            and float(row["YMax"]) - float(row["YMin"]) >= MIN_BOX_FRACTION)


def usable_image(row: dict, licenses: set[str]) -> bool:
    return row["License"] in licenses and row.get("Rotation", "") in ("", "0", "0.0")


def select_crops(boxes: list[dict], images: dict[str, dict], label_subcategories: dict[str, str],
                 max_per_subcategory: int) -> list[dict]:
    """Picks a deterministic, image-diverse sample of boxes per subcategory; pure so it can be tested."""
    by_subcategory: dict[str, list[dict]] = defaultdict(list)
    for box in boxes:
        subcategory = label_subcategories.get(box["LabelName"])
        if subcategory and box["ImageID"] in images and usable_box(box):
            by_subcategory[subcategory].append(box)
    crops, taken = [], set()
    for subcategory, candidates in sorted(by_subcategory.items()):
        candidates.sort(key=lambda box: hashlib.sha256(
            f"{box['ImageID']}:{box['XMin']}:{box['YMin']}".encode()).hexdigest())
        per_image: dict[str, int] = defaultdict(int)
        chosen = 0
        for box in candidates:
            if chosen >= max_per_subcategory:
                break
            corner = f"{round(float(box['XMin']) * 1000)}-{round(float(box['YMin']) * 1000)}"
            crop_id = f"{SOURCE}:{box['ImageID']}:{corner}"
            # Boxes sharing a rounded corner would share the id and the file: almost always the same object.
            if per_image[box["ImageID"]] >= MAX_CROPS_PER_IMAGE or crop_id in taken:
                continue
            taken.add(crop_id)
            per_image[box["ImageID"]] += 1
            chosen += 1
            image = images[box["ImageID"]]
            crops.append({
                "id": crop_id,
                "group": f"{SOURCE}:{box['ImageID']}",
                "image_id": box["ImageID"],
                "subset": image["Subset"],
                "box": tuple(float(box[key]) for key in ("XMin", "YMin", "XMax", "YMax")),
                "labels": {"subcategory": subcategory},
                "license_url": image["License"],
                "attribution": f"{image['Author']} — {image['OriginalLandingURL']}",
                "meta": {"openImagesClass": box["LabelName"]},
            })
    return crops


def pixel_box(box: tuple[float, float, float, float], width: int, height: int) -> tuple[int, int, int, int]:
    x_min, y_min, x_max, y_max = box
    pad_x, pad_y = (x_max - x_min) * CROP_PADDING, (y_max - y_min) * CROP_PADDING
    return (max(0, round((x_min - pad_x) * width)), max(0, round((y_min - pad_y) * height)),
            min(width, round((x_max + pad_x) * width)), min(height, round((y_max + pad_y) * height)))


def crop_path(output: Path, crop: dict) -> Path:
    return output / "images" / f"{crop['id'].split(':', 1)[1].replace(':', '-')}.jpg"


def save_crops(output: Path, image_crops: list[dict]) -> list[tuple[dict, Path]]:
    """Downloads one photo and stores its crops; already stored crops are reused."""
    pending = [crop for crop in image_crops if not crop_path(output, crop).exists()]
    if pending:
        first = image_crops[0]
        url = IMAGE_URL.format(subset=first["subset"], image_id=first["image_id"])
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "vesta-ml"}), timeout=60) as response:
                image = Image.open(io.BytesIO(response.read()))
                image.load()
        except Exception as error:  # A missing photo only loses its crops.
            print(f"\n  {first['image_id']}: {error}", file=sys.stderr)
            return []
        for crop in pending:
            box = pixel_box(crop["box"], *image.size)
            if min(box[2] - box[0], box[3] - box[1]) >= MIN_CROP_SIDE:
                save_image(image, crop_path(output, crop), box)
    return [(crop, crop_path(output, crop)) for crop in image_crops if crop_path(output, crop).exists()]


def prepare(root: Path, subsets: list[str], max_per_subcategory: int | None = None) -> Path:
    mapping = load_source_mappings()[SOURCE]
    downloads = root / "downloads" / SOURCE
    names = {row["DisplayName"]: row["LabelName"] for row in filtered_rows(
        f"{BASE_URL}/{CLASSES_PATH}", downloads / "classes.csv", lambda row: True)}
    missing = sorted(set(mapping["classes"]) - set(names))
    if missing:
        raise SystemExit(f"Open Images no tiene estas clases: {', '.join(missing)}")
    label_subcategories = {names[name]: subcategory for name, subcategory in mapping["classes"].items()}
    # The cache is only valid for the same set of classes.
    key = hashlib.sha256(",".join(sorted(label_subcategories)).encode()).hexdigest()[:8]
    licenses = set(mapping["commercialLicenses"])

    boxes, images = [], {}
    for subset in subsets:
        subset_boxes = filtered_rows(f"{BASE_URL}/{BOXES_PATHS[subset]}", downloads / f"boxes-{subset}-{key}.csv",
                                     lambda row: row["LabelName"] in label_subcategories)
        wanted = {row["ImageID"] for row in subset_boxes}
        images.update({row["ImageID"]: row for row in filtered_rows(
            f"{BASE_URL}/{IMAGES_PATHS[subset]}", downloads / f"images-{subset}-{key}.csv",
            lambda row: row["ImageID"] in wanted) if usable_image(row, licenses)})
        boxes += subset_boxes
    crops = select_crops(boxes, images, label_subcategories, max_per_subcategory or mapping["maxPerSubcategory"])

    by_image: dict[str, list[dict]] = defaultdict(list)
    for crop in crops:
        by_image[crop["image_id"]].append(crop)
    output = root / "sources" / SOURCE
    print(f"{len(crops)} recortes de {len(by_image)} fotos CC BY")
    saved: list[tuple[dict, Path]] = []
    with ThreadPoolExecutor(DOWNLOAD_WORKERS) as pool:
        for index, result in enumerate(pool.map(lambda group: save_crops(output, group), by_image.values()), 1):
            saved += result
            print(f"\r  {index}/{len(by_image)} fotos", end="", file=sys.stderr)
    print(file=sys.stderr)

    records = [make_record(
        record_id=crop["id"], source=SOURCE, image=path, root=root, group=crop["group"], labels=crop["labels"],
        license_name=f"CC BY 2.0 (foto); {ANNOTATION_LICENSE}", license_url=crop["license_url"],
        attribution=crop["attribution"], meta=crop["meta"],
    ) for crop, path in sorted(saved, key=lambda item: item[0]["id"])]
    manifest = output / "manifest.jsonl"
    count = write_jsonl(manifest, records)
    totals = defaultdict(int)
    for record in records:
        totals[record["labels"]["subcategory"]] += 1
    print(f"{SOURCE}: {count} recortes ({', '.join(f'{name}={total}' for name, total in sorted(totals.items()))})")
    return manifest
