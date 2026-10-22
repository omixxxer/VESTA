"""Utilidades compartidas: taxonomía, mapeo de atributos y constantes."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent
IGNORE_INDEX = -1
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


class Taxonomy:
    """Acceso cómodo a taxonomy.json. El orden de los valores define los índices del modelo."""

    def __init__(self, data: dict):
        self.data = data
        self.version: str = data["version"]
        self.heads: list[str] = list(data["heads"].keys())
        self.values: dict[str, list[str]] = {h: list(spec["values"].keys()) for h, spec in data["heads"].items()}

    @classmethod
    def load(cls, path: str | Path | None = None) -> "Taxonomy":
        return cls(json.loads(Path(path or ROOT / "taxonomy.json").read_text(encoding="utf-8")))

    def index(self, head: str, value: str) -> int:
        return self.values[head].index(value)

    def subtype_category(self, subtype: str) -> str:
        return self.data["heads"]["subtype"]["values"][subtype]["category"]

    def source_to_subtype(self, source: str, case_sensitive: bool = False) -> dict[str, str]:
        """Devuelve {nombre_en_el_dataset: subtype}. source = 'fashionpedia' | 'myntra'."""
        mapping: dict[str, str] = {}
        for subtype, spec in self.data["heads"]["subtype"]["values"].items():
            for name in spec.get(source, []):
                mapping[name if case_sensitive else name.lower()] = subtype
        return mapping


def load_attribute_mapping(path: str | Path | None = None) -> dict:
    return json.loads(Path(path or ROOT / "attribute_mapping.json").read_text(encoding="utf-8"))


def labels_from_attributes(
    attributes: Iterable[tuple[str, str]],
    fashionpedia_category: str,
    mapping: dict,
) -> dict[str, str]:
    """Convierte los atributos de Fashionpedia de una prenda en etiquetas de cabeza.

    attributes: pares (nombre, supercategoría). Si una cabeza coincide con más de un valor
    (ambigua) o con ninguno, se omite: queda como "sin dato" y no entra en la pérdida.
    """
    attributes = list(attributes)
    labels: dict[str, str] = {}
    for head, spec in mapping.items():
        if head.startswith("_") or head.startswith("myntra") or not isinstance(spec, dict):
            continue
        only = spec.get("only_for_categories")
        if only and fashionpedia_category.lower() not in [name.lower() for name in only]:
            continue
        supercategory = re.compile(spec["supercategory"], re.IGNORECASE)
        matched: set[str] = set()
        for name, attr_super in attributes:
            if attr_super and not supercategory.search(attr_super):
                continue
            lowered = name.lower()
            for value, patterns in spec["values"].items():
                if any(re.search(pattern, lowered) for pattern in patterns):
                    matched.add(value)
                    break
        if len(matched) == 1:
            labels[head] = next(iter(matched))
    return labels


def with_derived_category(labels: dict[str, str], taxonomy: Taxonomy) -> dict[str, str]:
    """Añade la cabeza 'category' a partir de 'subtype' cuando falta."""
    result = dict(labels)
    if "subtype" in result and "category" not in result:
        result["category"] = taxonomy.subtype_category(result["subtype"])
    return result
