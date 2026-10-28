"""Fotos propias exportadas desde la app con «Exportar datos de entrenamiento»."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

from ..common import make_record, reset_dir, save_image, write_jsonl
from ..taxonomy import load_taxonomy

SOURCE = "vesta"
EXPORT_FORMAT = "vesta-training-export"


def prepare(root: Path, archive: Path) -> Path:
    taxonomy = load_taxonomy()
    output = reset_dir(root / "sources" / SOURCE)
    records = []
    with zipfile.ZipFile(archive) as bundle:
        info = json.loads(bundle.read("export.json"))
        if info.get("format") != EXPORT_FORMAT:
            raise ValueError(f"{archive} no es una exportación de VESTA")
        if info.get("taxonomyVersion") != taxonomy.version:
            raise ValueError(f"La exportación usa la taxonomía v{info.get('taxonomyVersion')} y ml/ tiene la v{taxonomy.version}")
        for line in bundle.read("labels.jsonl").decode("utf-8").splitlines():
            if not line.strip():
                continue
            garment = json.loads(line)
            for index, member in enumerate(garment["images"]):
                destination = output / "images" / f"{garment['garmentId']}-{index}.jpg"
                width, height = save_image(bundle.read(member), destination)
                records.append(make_record(
                    record_id=f"{SOURCE}:{garment['garmentId']}:{index}",
                    source=SOURCE,
                    image=destination,
                    root=root,
                    group=f"{SOURCE}:{garment['garmentId']}",
                    labels=garment["labels"],
                    license_name="Fotos propias del usuario",
                    license_url="",
                    meta={"review": garment["review"], "raw": garment["raw"], "width": width, "height": height},
                ))
    manifest = output / "manifest.jsonl"
    count = write_jsonl(manifest, records)
    print(f"{SOURCE}: {count} fotos de {len({r['group'] for r in records})} prendas")
    return manifest
