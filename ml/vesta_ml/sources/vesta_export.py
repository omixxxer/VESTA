"""Fotos propias exportadas desde la app con «Exportar datos de entrenamiento»."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

from ..common import make_record, reset_dir, save_image, write_jsonl
from ..taxonomy import Taxonomy, load_taxonomy

SOURCE = "vesta"
EXPORT_FORMAT = "vesta-training-export"


def relabel(labels: dict, raw: dict, taxonomy: Taxonomy) -> dict:
    """Re-match the original text with the current taxonomy, so synonyms added after the export still count.

    Mirrors toTrainingRecord in src/ml/datasetExport.ts; a value the app matched is never dropped.
    """
    def unique(head: str, values: list[str]) -> list[str] | None:
        matches = list(dict.fromkeys(match for value in values if (match := taxonomy.match(head, value))))
        return matches or None

    subcategory = taxonomy.match("subcategory", raw.get("subcategory")) or labels["subcategory"]
    # Dress levels (a list) since app database v6; earlier exports have one formality (Casual → diario…).
    previous = labels.get("formality")
    dress_levels = [*(raw.get("dressLevels") or [raw.get("formality")]),
                    *(previous if isinstance(previous, list) else [previous])]
    formality = unique("formality", [value for value in dress_levels if value])
    fresh = {
        "category": taxonomy.category_of(subcategory) if subcategory else taxonomy.match("category", raw.get("category")),
        "subcategory": subcategory,
        "pattern": taxonomy.match("pattern", raw.get("pattern")),
        "seasons": unique("seasons", raw.get("seasons", [])),
        "colors": unique("colors", raw.get("colors", [])),
    }
    # formality is always replaced: a single value from an old export is not a valid multi-label value.
    return {**labels, **{head: value for head, value in fresh.items() if value is not None}, "formality": formality}


def prepare(root: Path, archive: Path) -> Path:
    taxonomy = load_taxonomy()
    output = reset_dir(root / "sources" / SOURCE)
    records = []
    with zipfile.ZipFile(archive) as bundle:
        info = json.loads(bundle.read("export.json"))
        if info.get("format") != EXPORT_FORMAT:
            raise ValueError(f"{archive} no es una exportación de VESTA")
        # Older exports are fine: relabel() re-matches the original text with the current taxonomy.
        if not isinstance(info.get("taxonomyVersion"), int) or info["taxonomyVersion"] > taxonomy.version:
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
                    labels=relabel(garment["labels"], garment["raw"], taxonomy),
                    license_name="Fotos propias del usuario",
                    license_url="",
                    meta={"review": garment["review"], "raw": garment["raw"], "width": width, "height": height},
                ))
    manifest = output / "manifest.jsonl"
    count = write_jsonl(manifest, records)
    print(f"{SOURCE}: {count} fotos de {len({r['group'] for r in records})} prendas")
    return manifest
