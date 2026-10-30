"""Shared VESTA taxonomy. Mirrors src/ml/taxonomy.ts; both read ml/taxonomy.json."""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parent.parent
TAXONOMY_PATH = ML_ROOT / "taxonomy.json"
SOURCE_MAPPINGS_PATH = ML_ROOT / "source_mappings.json"

LABEL_HEADS = ("category", "subcategory", "sleeve", "fit", "pattern", "formality", "seasons", "colors")
MULTI_LABEL_HEADS = ("formality", "seasons", "colors")


def normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text.lower())
    without_accents = "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", without_accents).strip()


def plural_pattern(phrase: str) -> str:
    """Each word also matches its Spanish plural: azul → azules, pantalon corto → pantalones cortos."""
    return " ".join(f"{re.escape(word)}(?:e?s)?" for word in phrase.split(" "))


@dataclass(frozen=True, eq=False)
class Taxonomy:
    version: int
    categories: dict[str, dict]
    subcategories: dict[str, dict]
    attributes: dict[str, dict]

    def head_values(self, head: str) -> list[str]:
        if head == "category":
            return list(self.categories)
        if head == "subcategory":
            return list(self.subcategories)
        return [value["id"] for value in self.attributes[head]["values"]]

    def category_of(self, subcategory: str) -> str:
        return self.subcategories[subcategory]["category"]

    def applies(self, head: str, category: str | None, subcategory: str | None) -> bool:
        """Whether an attribute makes sense for a garment (sleeve on tops, fit on trousers…).

        appliesToSubcategories only rules out a known subcategory outside the list: a garment of the right category
        without subcategory may still carry the attribute.
        """
        attribute = self.attributes.get(head, {})
        if "appliesTo" in attribute and category not in attribute["appliesTo"]:
            return False
        allowed = attribute.get("appliesToSubcategories")
        return allowed is None or subcategory is None or subcategory in allowed

    def match(self, head: str, text: str | None) -> str | None:
        """Map free text to a value id; the longest matching phrase wins."""
        if not text:
            return None
        normalized = normalize(text)
        if not normalized:
            return None
        best: tuple[int, str] | None = None
        for value_id, phrases in _phrases(self, head):
            for phrase in phrases:
                if normalized == phrase:
                    return value_id
                if re.search(rf"(^| ){plural_pattern(phrase)}( |$)", normalized):
                    if best is None or len(phrase) > best[0]:
                        best = (len(phrase), value_id)
        return best[1] if best else None

    def validate_labels(self, labels: dict) -> None:
        unknown = set(labels) - set(LABEL_HEADS)
        if unknown:
            raise ValueError(f"Cabezas desconocidas: {sorted(unknown)}")
        for head, value in labels.items():
            if value is None:
                continue
            allowed = set(self.head_values(head))
            values = value if head in MULTI_LABEL_HEADS else [value]
            if head in MULTI_LABEL_HEADS and (not isinstance(value, list) or not value):
                raise ValueError(f"{head} debe ser una lista no vacía o null")
            for item in values:
                if item not in allowed:
                    raise ValueError(f"Valor {item!r} no válido para {head}")
        subcategory = labels.get("subcategory")
        category = labels.get("category")
        if subcategory and category and self.category_of(subcategory) != category:
            raise ValueError(f"{subcategory} no pertenece a la categoría {category}")


@lru_cache(maxsize=None)
def _phrases(taxonomy: Taxonomy, head: str) -> tuple[tuple[str, tuple[str, ...]], ...]:
    if head == "category":
        entries = [(value_id, [entry["label"]]) for value_id, entry in taxonomy.categories.items()]
    elif head == "subcategory":
        entries = [(value_id, [entry["label"], *entry["synonyms"]]) for value_id, entry in taxonomy.subcategories.items()]
    else:
        entries = [(value["id"], [value["label"], *value["synonyms"]]) for value in taxonomy.attributes[head]["values"]]
    return tuple(
        (value_id, tuple(phrase for phrase in {normalize(text) for text in [value_id, *texts]} if phrase))
        for value_id, texts in entries
    )


@lru_cache(maxsize=1)
def load_taxonomy(path: Path = TAXONOMY_PATH) -> Taxonomy:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return Taxonomy(
        version=raw["version"],
        categories={entry["id"]: entry for entry in raw["categories"]},
        subcategories={entry["id"]: entry for entry in raw["subcategories"]},
        attributes=raw["attributes"],
    )


@lru_cache(maxsize=1)
def load_source_mappings(path: Path = SOURCE_MAPPINGS_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))
