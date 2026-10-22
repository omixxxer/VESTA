"""Lista los atributos reales de Fashionpedia y comprueba cuántos cubre attribute_mapping.json.

Úsalo ANTES de entrenar para ajustar los patrones del mapeo a los nombres exactos del JSON:
    python inspect_ontology.py --annotations data/raw/fashionpedia/instances_attributes_val2020.json
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from common import Taxonomy, load_attribute_mapping


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--annotations", required=True, type=Path)
    parser.add_argument("--mapping", type=Path, default=None)
    parser.add_argument("--taxonomy", type=Path, default=None)
    args = parser.parse_args()

    data = json.loads(args.annotations.read_text(encoding="utf-8"))
    mapping = load_attribute_mapping(args.mapping)
    taxonomy = Taxonomy.load(args.taxonomy)

    print("== Categorías de Fashionpedia ==")
    known = taxonomy.source_to_subtype("fashionpedia")
    for category in data["categories"]:
        name = category["name"].lower()
        print(f"  {'OK ' if name in known else '-- '} {category['name']!r}" + (f" -> {known[name]}" if name in known else " (ignorada)"))

    usage = Counter(a for ann in data["annotations"] for a in ann.get("attribute_ids", []))
    by_super: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for attribute in data.get("attributes", []):
        by_super[attribute.get("supercategory", "") or "(sin supercategoría)"].append((attribute["id"], attribute["name"]))

    print("\n== Atributos por supercategoría (nº de usos en este JSON) ==")
    for supercategory, items in sorted(by_super.items()):
        print(f"\n[{supercategory}]")
        for attribute_id, name in sorted(items, key=lambda item: -usage[item[0]]):
            print(f"  {usage[attribute_id]:7d}  {name}")

    print("\n== Cobertura del mapeo ==")
    for head, spec in mapping.items():
        if head.startswith("_") or head.startswith("myntra") or not isinstance(spec, dict):
            continue
        super_re = re.compile(spec["supercategory"], re.IGNORECASE)
        covered = 0
        total = 0
        for attribute in data.get("attributes", []):
            sup = attribute.get("supercategory", "") or ""
            if sup and not super_re.search(sup):
                continue
            total += 1
            name = attribute["name"].lower()
            if any(re.search(p, name) for patterns in spec["values"].values() for p in patterns):
                covered += usage[attribute["id"]]
        print(f"  {head:14s} usos de atributos mapeados: {covered:8d} (atributos candidatos: {total})")
    print("\nSi una cabeza sale con 0 usos, revisa su 'supercategory' y sus regex en attribute_mapping.json.")


if __name__ == "__main__":
    main()
