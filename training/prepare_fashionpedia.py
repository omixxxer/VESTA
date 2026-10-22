"""Recorta cada prenda de Fashionpedia y genera un manifiesto JSONL con etiquetas por cabeza.

Uso (ejemplo):
    python prepare_fashionpedia.py \
        --annotations data/raw/fashionpedia/instances_attributes_train2020.json \
        --images-dir data/raw/fashionpedia/train \
        --out data/prepared --split train

    python prepare_fashionpedia.py \
        --annotations data/raw/fashionpedia/instances_attributes_val2020.json \
        --images-dir data/raw/fashionpedia/test \
        --out data/prepared --split val

Licencia: las anotaciones son CC BY 4.0; las imágenes siguen los términos de sus fuentes
(Flickr, Unsplash, Pexels...). Revisa https://fashionpedia.github.io/home/data_license.html
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image

from common import Taxonomy, labels_from_attributes, load_attribute_mapping, with_derived_category


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--annotations", required=True, type=Path)
    parser.add_argument("--images-dir", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--split", required=True, choices=["train", "val"])
    parser.add_argument("--margin", type=float, default=0.08, help="Margen relativo alrededor del bbox.")
    parser.add_argument("--min-side", type=int, default=64, help="Descarta recortes con un lado menor (px).")
    parser.add_argument("--max-side", type=int, default=320, help="Reduce el lado mayor de cada recorte (px).")
    parser.add_argument("--taxonomy", type=Path, default=None)
    parser.add_argument("--mapping", type=Path, default=None)
    args = parser.parse_args()

    taxonomy = Taxonomy.load(args.taxonomy)
    mapping = load_attribute_mapping(args.mapping)
    name_to_subtype = taxonomy.source_to_subtype("fashionpedia")

    data = json.loads(args.annotations.read_text(encoding="utf-8"))
    categories = {c["id"]: c["name"].lower() for c in data["categories"]}
    attributes = {a["id"]: (a["name"], a.get("supercategory", "") or "") for a in data.get("attributes", [])}
    images = {im["id"]: im for im in data["images"]}

    unknown_categories = sorted({name for name in categories.values() if name not in name_to_subtype})
    print(f"Categorías ignoradas (partes u otras sin subtipo): {len(unknown_categories)}")

    by_image: dict[int, list[dict]] = defaultdict(list)
    for annotation in data["annotations"]:
        by_image[annotation["image_id"]].append(annotation)

    crops_dir = args.out / "crops" / args.split
    crops_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out / f"manifest_{args.split}.jsonl"

    head_counts: Counter[str] = Counter()
    skipped: Counter[str] = Counter()
    written = 0
    with manifest_path.open("w", encoding="utf-8") as manifest:
        for image_id, annotations in by_image.items():
            info = images.get(image_id)
            if info is None:
                skipped["sin_imagen_en_json"] += 1
                continue
            image_path = args.images_dir / info["file_name"]
            if not image_path.exists():
                skipped["archivo_no_encontrado"] += 1
                continue
            with Image.open(image_path) as source:
                source = source.convert("RGB")
                for annotation in annotations:
                    category_name = categories.get(annotation["category_id"], "")
                    subtype = name_to_subtype.get(category_name)
                    if subtype is None:
                        skipped["categoria_sin_subtipo"] += 1
                        continue
                    if annotation.get("iscrowd"):
                        skipped["iscrowd"] += 1
                        continue
                    x, y, w, h = annotation["bbox"]
                    if w < args.min_side or h < args.min_side:
                        skipped["demasiado_pequeño"] += 1
                        continue
                    pad_x, pad_y = w * args.margin, h * args.margin
                    box = (
                        max(0, int(x - pad_x)),
                        max(0, int(y - pad_y)),
                        min(source.width, int(x + w + pad_x)),
                        min(source.height, int(y + h + pad_y)),
                    )
                    crop = source.crop(box)
                    scale = args.max_side / max(crop.size)
                    if scale < 1:
                        crop = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.LANCZOS)
                    relative = f"crops/{args.split}/{annotation['id']}.jpg"
                    crop.save(args.out / relative, quality=90)

                    attribute_pairs = [attributes[a] for a in annotation.get("attribute_ids", []) if a in attributes]
                    labels = labels_from_attributes(attribute_pairs, category_name, mapping)
                    labels["subtype"] = subtype
                    labels = with_derived_category(labels, taxonomy)
                    for head in labels:
                        head_counts[head] += 1
                    manifest.write(json.dumps({
                        "image": relative, "split": args.split, "source": "fashionpedia", "labels": labels,
                    }, ensure_ascii=False) + "\n")
                    written += 1

    print(f"Recortes escritos: {written} -> {manifest_path}")
    print("Etiquetas por cabeza:", dict(head_counts))
    if skipped:
        print("Descartados:", dict(skipped))


if __name__ == "__main__":
    main()
