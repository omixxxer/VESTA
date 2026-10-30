"""Fashionpedia: prendas recortadas de fotos de personas, con estampado, largo de manga y corte de pantalón.

Las anotaciones son CC BY 4.0, pero cada foto conserva la licencia de su autor. Solo se
usan las fotos cuya licencia permite uso comercial y obras derivadas (ver
source_mappings.json); el resto (NC, ND y sin licencia) se descarta.
"""

from __future__ import annotations

import json
import zipfile
from collections import defaultdict
from pathlib import Path

from ..common import download, make_record, reset_dir, save_image, write_jsonl
from ..taxonomy import load_source_mappings

SOURCE = "fashionpedia"
BASE_URL = "https://s3.amazonaws.com/ifashionist-dataset"
SPLITS = {
    "val": ("annotations/instances_attributes_val2020.json", "images/val_test2020.zip"),
    "train": ("annotations/instances_attributes_train2020.json", "images/train2020.zip"),
}
ANNOTATION_LICENSE = "CC BY 4.0 (anotaciones, Jia et al., ECCV 2020)"
MIN_CROP_SIDE = 80
CROP_PADDING = 0.08


def allowed_license_ids(include_share_alike: bool) -> set[int]:
    mapping = load_source_mappings()[SOURCE]
    allowed = set(mapping["commercialLicenseIds"])
    if include_share_alike:
        allowed |= set(mapping["shareAlikeLicenseIds"])
    return allowed


def _contains_center(outer: list[float], inner: list[float]) -> bool:
    x, y, width, height = outer
    center_x = inner[0] + inner[2] / 2
    center_y = inner[1] + inner[3] / 2
    return x <= center_x <= x + width and y <= center_y <= y + height


def fit_from(category: str, names: list[str], mapping: dict) -> str | None:
    """Trouser fit from Fashionpedia silhouette attributes.

    A garment often has several (regular fit + bootcut): the leg shape wins over the generic fit, following
    fitPriority. "peg" (tapered) is left out: it is neither skinny nor straight.
    """
    if category not in mapping["fitCategories"]:
        return None
    fits = {mapping["fits"][name] for name in names if name in mapping["fits"]}
    return next((fit for fit in mapping["fitPriority"] if fit in fits), None)


def garment_records(annotations: dict, include_share_alike: bool = False) -> list[dict]:
    """Turn COCO-style annotations into crop descriptions with taxonomy labels.

    Returns dicts with image, bbox and labels; no files are read here so it can be tested.
    """
    mapping = load_source_mappings()[SOURCE]
    categories = {entry["id"]: entry["name"] for entry in annotations["categories"]}
    attributes = {entry["id"]: entry["name"] for entry in annotations["attributes"]}
    licenses = {entry["id"]: entry for entry in annotations["licenses"]}
    allowed = allowed_license_ids(include_share_alike)
    images = {image["id"]: image for image in annotations["images"] if image["license"] in allowed}

    by_image: dict[int, list[dict]] = defaultdict(list)
    for annotation in annotations["annotations"]:
        if annotation["image_id"] in images:
            by_image[annotation["image_id"]].append(annotation)

    crops = []
    for image_id, image_annotations in by_image.items():
        image = images[image_id]
        sleeves = [a for a in image_annotations if categories[a["category_id"]] == mapping["sleeveCategory"]]
        for annotation in image_annotations:
            base = mapping["categories"].get(categories[annotation["category_id"]])
            x, y, width, height = annotation["bbox"]
            if base is None or min(width, height) < MIN_CROP_SIDE:
                continue
            names = [attributes[attribute_id] for attribute_id in annotation.get("attribute_ids", [])]
            labels = dict(base)

            nicknames = {mapping["nicknames"][name] for name in names if name in mapping["nicknames"]}
            if len(nicknames) == 1:
                labels["subcategory"] = nicknames.pop()

            patterns = {mapping["patterns"][name] for name in names if name in mapping["patterns"]}
            if len(patterns) == 1:
                labels["pattern"] = patterns.pop()

            if labels["category"] in ("top", "one-piece", "outerwear"):
                # Sleeve length is annotated on separate "sleeve" parts; garment-level
                # length attributes describe the garment itself, except "sleeveless".
                if mapping["garmentSleevelessAttribute"] in names:
                    sleeve_values = {"sin-mangas"}
                else:
                    sleeve_values = {
                        mapping["sleeveLengths"][attributes[attribute_id]]
                        for sleeve in sleeves if _contains_center(annotation["bbox"], sleeve["bbox"])
                        for attribute_id in sleeve.get("attribute_ids", [])
                        if attributes[attribute_id] in mapping["sleeveLengths"]
                    }
                if len(sleeve_values) == 1:
                    labels["sleeve"] = sleeve_values.pop()

            if fit := fit_from(categories[annotation["category_id"]], names, mapping):
                labels["fit"] = fit

            pad_x, pad_y = width * CROP_PADDING, height * CROP_PADDING
            box = (
                max(0, round(x - pad_x)),
                max(0, round(y - pad_y)),
                min(image["width"], round(x + width + pad_x)),
                min(image["height"], round(y + height + pad_y)),
            )
            license_entry = licenses[image["license"]]
            crops.append({
                "id": f"{SOURCE}:{image_id}:{annotation['id']}",
                "group": f"{SOURCE}:{image_id}",
                "file_name": image["file_name"],
                "box": box,
                "labels": labels,
                "license_name": license_entry["name"],
                "license_url": license_entry["url"],
                "attribution": image.get("original_url"),
                "meta": {"fashionpediaCategory": categories[annotation["category_id"]], "attributes": names},
            })
    return crops


def prepare(root: Path, split: str = "val", include_share_alike: bool = False, limit: int | None = None) -> Path:
    annotation_path, images_path = SPLITS[split]
    annotations_file = download(f"{BASE_URL}/{annotation_path}", root / "downloads" / "fashionpedia" / Path(annotation_path).name)
    images_zip = download(f"{BASE_URL}/{images_path}", root / "downloads" / "fashionpedia" / Path(images_path).name)
    print("Leyendo anotaciones (el split train necesita varios GB de RAM)…")
    with annotations_file.open(encoding="utf-8") as handle:
        annotations = json.load(handle)
    for annotation in annotations["annotations"]:
        annotation.pop("segmentation", None)
    crops = garment_records(annotations, include_share_alike)
    del annotations
    if limit:
        crops = crops[:limit]

    output = reset_dir(root / "sources" / f"{SOURCE}-{split}")
    records = []
    with zipfile.ZipFile(images_zip) as bundle:
        members = {Path(name).name: name for name in bundle.namelist() if not name.endswith("/")}
        cache: tuple[str, bytes] | None = None
        for crop in sorted(crops, key=lambda item: item["file_name"]):
            member = members.get(crop["file_name"])
            if member is None:
                continue
            if cache is None or cache[0] != member:
                cache = (member, bundle.read(member))
            destination = output / "images" / f"{crop['id'].split(':', 1)[1].replace(':', '-')}.jpg"
            width, height = save_image(cache[1], destination, crop["box"])
            records.append(make_record(
                record_id=crop["id"],
                source=SOURCE,
                image=destination,
                root=root,
                group=crop["group"],
                labels=crop["labels"],
                license_name=f"{crop['license_name']} (foto); {ANNOTATION_LICENSE}",
                license_url=crop["license_url"],
                attribution=crop["attribution"],
                meta={**crop["meta"], "width": width, "height": height},
            ))
    manifest = output / "manifest.jsonl"
    count = write_jsonl(manifest, records)
    print(f"{SOURCE} ({split}): {count} recortes de {len({c['group'] for c in crops})} fotos con licencia compatible")
    return manifest
