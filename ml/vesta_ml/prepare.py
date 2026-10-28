"""Preparación de datos: python -m vesta_ml.prepare <fuente> [opciones]."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from pathlib import Path

from .common import assign_split, data_dir, read_jsonl, write_jsonl
from .sources import clothing_dataset, fashionpedia, vesta_export
from .taxonomy import LABEL_HEADS, MULTI_LABEL_HEADS

# Own photos are scarce and the closest to real use, so half of them are held out for testing.
SPLIT_RATIOS = {vesta_export.SOURCE: (0.5, 0.0, 0.5)}
DEFAULT_SPLIT_RATIOS = (0.8, 0.1, 0.1)


def merge(root: Path) -> Path:
    records = []
    for manifest in sorted((root / "sources").glob("*/manifest.jsonl")):
        for record in read_jsonl(manifest):
            record["split"] = assign_split(record["group"], SPLIT_RATIOS.get(record["source"], DEFAULT_SPLIT_RATIOS))
            records.append(record)
    if not records:
        raise SystemExit("No hay fuentes preparadas en " + str(root / "sources"))
    output = root / "manifest.jsonl"
    write_jsonl(output, records)
    print(f"Manifiesto unificado: {output} ({len(records)} imágenes)")
    print(summarize(records))
    return output


def summarize(records: list[dict]) -> str:
    lines = []
    by_split = Counter(record["split"] for record in records)
    by_source = Counter(record["source"] for record in records)
    lines.append("Por split: " + ", ".join(f"{split}={count}" for split, count in sorted(by_split.items())))
    lines.append("Por fuente: " + ", ".join(f"{source}={count}" for source, count in sorted(by_source.items())))
    for head in LABEL_HEADS:
        values: Counter[str] = Counter()
        labeled: dict[str, int] = defaultdict(int)
        for record in records:
            value = record["labels"][head]
            if value is None:
                continue
            labeled[record["split"]] += 1
            values.update(value if head in MULTI_LABEL_HEADS else [value])
        coverage = ", ".join(f"{split}={labeled.get(split, 0)}" for split in ("train", "val", "test"))
        top = ", ".join(f"{value}={count}" for value, count in values.most_common())
        lines.append(f"\n[{head}] etiquetadas: {coverage}\n  {top or 'sin datos'}")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    clothing = commands.add_parser("clothing-dataset", help="Descarga y prepara Clothing Dataset (CC0, ~160 MB)")
    clothing.add_argument("--limit", type=int)
    pedia = commands.add_parser("fashionpedia", help="Descarga y prepara Fashionpedia con licencias comerciales")
    pedia.add_argument("--split", choices=sorted(fashionpedia.SPLITS), default="val",
                       help="val: ~250 MB para probar; train: ~3,9 GB")
    pedia.add_argument("--include-share-alike", action="store_true",
                       help="Incluye fotos CC BY-SA; revisa antes si es compatible con tu uso")
    pedia.add_argument("--limit", type=int)
    own = commands.add_parser("vesta-export", help="Importa el ZIP exportado desde la app")
    own.add_argument("archive", type=Path)
    commands.add_parser("merge", help="Une las fuentes preparadas en manifest.jsonl con splits")
    arguments = parser.parse_args()

    root = data_dir()
    print(f"Directorio de datos: {root}")
    if arguments.command == "clothing-dataset":
        clothing_dataset.prepare(root, arguments.limit)
    elif arguments.command == "fashionpedia":
        fashionpedia.prepare(root, arguments.split, arguments.include_share_alike, arguments.limit)
    elif arguments.command == "vesta-export":
        vesta_export.prepare(root, arguments.archive)
    else:
        merge(root)


if __name__ == "__main__":
    main()
