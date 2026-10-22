"""OPCIONAL: prepara el dataset "Fashion Product Images" (Myntra, Kaggle) para entrenar las cabezas
de formalidad y temporada, que Fashionpedia no tiene.

AVISO DE LICENCIA: no he podido verificar la licencia de este dataset. Compruébala en la página de
Kaggle antes de usarlo y, sobre todo, antes de distribuir un modelo entrenado con él. Por eso el
script exige --i-accept-license-risk.

Espera la estructura del dataset original: styles.csv e images/<id>.jpg
    python prepare_myntra.py --csv data/raw/myntra/styles.csv --images-dir data/raw/myntra/images \
        --out data/prepared --i-accept-license-risk
"""
from __future__ import annotations

import argparse
import csv
import json
import random
from collections import Counter
from pathlib import Path

from PIL import Image

from common import Taxonomy, load_attribute_mapping, with_derived_category


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", required=True, type=Path)
    parser.add_argument("--images-dir", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--val-fraction", type=float, default=0.05)
    parser.add_argument("--max-side", type=int, default=320)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--taxonomy", type=Path, default=None)
    parser.add_argument("--mapping", type=Path, default=None)
    parser.add_argument("--i-accept-license-risk", action="store_true")
    args = parser.parse_args()
    if not args.i_accept_license_risk:
        parser.error("Lee el aviso de licencia en la cabecera del script y añade --i-accept-license-risk.")

    taxonomy = Taxonomy.load(args.taxonomy)
    mapping = load_attribute_mapping(args.mapping)
    article_to_subtype = taxonomy.source_to_subtype("myntra", case_sensitive=True)
    usage_map = mapping["myntra_usage_to_formality"]
    season_map = mapping["myntra_season_to_season"]

    rng = random.Random(args.seed)
    crops_dir = args.out / "crops" / "myntra"
    crops_dir.mkdir(parents=True, exist_ok=True)
    writers = {
        "train": (args.out / "manifest_train_myntra.jsonl").open("w", encoding="utf-8"),
        "val": (args.out / "manifest_val_myntra.jsonl").open("w", encoding="utf-8"),
    }
    skipped: Counter[str] = Counter()
    head_counts: Counter[str] = Counter()
    written = 0
    try:
        with args.csv.open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                if None in row:  # filas con comas sobrantes: formato roto en el CSV original
                    skipped["fila_malformada"] += 1
                    continue
                subtype = article_to_subtype.get(row.get("articleType", ""))
                if subtype is None:
                    skipped["articleType_sin_mapear"] += 1
                    continue
                source_path = args.images_dir / f"{row['id']}.jpg"
                if not source_path.exists():
                    skipped["imagen_no_encontrada"] += 1
                    continue
                labels: dict[str, str] = {"subtype": subtype}
                if row.get("usage") in usage_map:
                    labels["formality"] = usage_map[row["usage"]]
                if row.get("season") in season_map:
                    labels["season"] = season_map[row["season"]]
                labels = with_derived_category(labels, taxonomy)

                with Image.open(source_path) as image:
                    image = image.convert("RGB")
                    scale = args.max_side / max(image.size)
                    if scale < 1:
                        image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.LANCZOS)
                    relative = f"crops/myntra/{row['id']}.jpg"
                    image.save(args.out / relative, quality=90)

                split = "val" if rng.random() < args.val_fraction else "train"
                writers[split].write(json.dumps({
                    "image": relative, "split": split, "source": "myntra", "labels": labels,
                }, ensure_ascii=False) + "\n")
                for head in labels:
                    head_counts[head] += 1
                written += 1
    finally:
        for writer in writers.values():
            writer.close()

    print(f"Imágenes escritas: {written}")
    print("Etiquetas por cabeza:", dict(head_counts))
    if skipped:
        print("Descartadas:", dict(skipped))


if __name__ == "__main__":
    main()
