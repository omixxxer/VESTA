"""Clothing Dataset by Alexey Grigorev (CC0): ~5.000 fotos de prendas sueltas en 20 clases."""

from __future__ import annotations

import csv
import io
import zipfile
from pathlib import Path

from ..common import download, make_record, reset_dir, save_image, write_jsonl
from ..taxonomy import load_source_mappings

SOURCE = "clothing-dataset"
ARCHIVE_URL = "https://codeload.github.com/alexeygrigorev/clothing-dataset/zip/refs/heads/master"
LICENSE_NAME = "CC0-1.0"
LICENSE_URL = "https://github.com/alexeygrigorev/clothing-dataset/blob/master/LICENSE"


def labels_for(row: dict) -> dict | None:
    """Return taxonomy labels for a CSV row, or None when the row is not usable."""
    mapping = load_source_mappings()[SOURCE]
    return mapping["labels"].get(row["label"])


def prepare(root: Path, limit: int | None = None) -> Path:
    archive = download(ARCHIVE_URL, root / "downloads" / "clothing-dataset-master.zip")
    output = reset_dir(root / "sources" / SOURCE)
    records = []
    skipped: dict[str, int] = {}
    with zipfile.ZipFile(archive) as bundle:
        members = {Path(name).name: name for name in bundle.namelist()}
        rows = list(csv.DictReader(io.TextIOWrapper(bundle.open(members["images.csv"]), encoding="utf-8")))
        for row in rows:
            labels = labels_for(row)
            member = members.get(f"{row['image']}.jpg")
            if labels is None or member is None:
                reason = row["label"] if labels is None else "imagen ausente"
                skipped[reason] = skipped.get(reason, 0) + 1
                continue
            destination = output / "images" / f"{row['image']}.jpg"
            width, height = save_image(bundle.read(member), destination)
            records.append(make_record(
                record_id=f"{SOURCE}:{row['image']}",
                source=SOURCE,
                image=destination,
                root=root,
                # Photos from one contributor often show the same garment or room.
                group=f"{SOURCE}:sender:{row['sender_id']}",
                labels=labels,
                license_name=LICENSE_NAME,
                license_url=LICENSE_URL,
                meta={"originalLabel": row["label"], "kids": row["kids"] == "True", "width": width, "height": height},
            ))
            if limit and len(records) >= limit:
                break
    manifest = output / "manifest.jsonl"
    count = write_jsonl(manifest, records)
    print(f"{SOURCE}: {count} registros; descartados {skipped}")
    return manifest
