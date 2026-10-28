"""Data directory, downloads, image saving and manifest records."""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import sys
import urllib.request
from pathlib import Path
from typing import Iterable, Iterator

from PIL import Image, ImageOps

from .taxonomy import LABEL_HEADS, load_taxonomy

MAX_IMAGE_SIDE = 512
JPEG_QUALITY = 90


def data_dir() -> Path:
    """Large files live outside the repository and outside synced folders."""
    configured = os.environ.get("VESTA_ML_DATA")
    if configured:
        path = Path(configured)
    elif sys.platform == "win32":
        path = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "vesta-ml"
    else:
        path = Path.home() / ".local" / "share" / "vesta-ml"
    if "onedrive" in str(path).lower():
        print(f"Aviso: {path} está dentro de OneDrive; la sincronización puede corromper o ralentizar los datos.", file=sys.stderr)
    path.mkdir(parents=True, exist_ok=True)
    return path


def download(url: str, destination: Path) -> Path:
    """Download once; a partially downloaded file is replaced on the next run."""
    if destination.exists():
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + ".part")
    print(f"Descargando {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "vesta-ml"})
    with urllib.request.urlopen(request) as response, partial.open("wb") as output:
        total = int(response.headers.get("Content-Length") or 0)
        copied = 0
        while chunk := response.read(1 << 20):
            output.write(chunk)
            copied += len(chunk)
            if total:
                print(f"\r  {copied / total:6.1%} de {total / 1e6:,.0f} MB", end="", file=sys.stderr)
        print(file=sys.stderr)
    partial.replace(destination)
    return destination


def save_image(source: bytes | Image.Image, destination: Path, crop: tuple[int, int, int, int] | None = None) -> tuple[int, int]:
    """Store an RGB JPEG no larger than MAX_IMAGE_SIDE; returns the saved size."""
    image = source if isinstance(source, Image.Image) else Image.open(io.BytesIO(source))
    image = ImageOps.exif_transpose(image).convert("RGB")
    if crop:
        image = image.crop(crop)
    image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "JPEG", quality=JPEG_QUALITY)
    return image.size


def empty_labels() -> dict:
    return {head: None for head in LABEL_HEADS}


def make_record(*, record_id: str, source: str, image: Path, root: Path, group: str, labels: dict,
                license_name: str, license_url: str, attribution: str | None = None, meta: dict | None = None) -> dict:
    full_labels = {**empty_labels(), **labels}
    taxonomy = load_taxonomy()
    if full_labels["subcategory"] and not full_labels["category"]:
        full_labels["category"] = taxonomy.category_of(full_labels["subcategory"])
    taxonomy.validate_labels(full_labels)
    return {
        "id": record_id,
        "source": source,
        "image": image.relative_to(root).as_posix(),
        "group": group,
        "license": {"name": license_name, "url": license_url},
        "attribution": attribution,
        "labels": full_labels,
        "meta": meta or {},
    }


def write_jsonl(path: Path, records: Iterable[dict]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    count = 0
    with partial.open("w", encoding="utf-8") as output:
        for record in records:
            output.write(json.dumps(record, ensure_ascii=False) + "\n")
            count += 1
    partial.replace(path)
    return count


def read_jsonl(path: Path) -> Iterator[dict]:
    with path.open(encoding="utf-8") as lines:
        for line in lines:
            if line.strip():
                yield json.loads(line)


def assign_split(group: str, ratios: tuple[float, float, float]) -> str:
    """Deterministic split by group so crops/photos of one item never leak across splits."""
    position = int(hashlib.sha256(group.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    train, val, _ = ratios
    if position < train:
        return "train"
    if position < train + val:
        return "val"
    return "test"


def reset_dir(path: Path) -> Path:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)
    return path
