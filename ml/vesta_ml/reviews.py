"""Human review decisions on automatic proposals.

Decisions are versioned in the repository (ml/reviews/decisions.jsonl) because they are manual work; proposals are
regenerable and live in the data directory. Each line is {"id", "status", "subcategory", "at"}, plus "relabel": true
for reviews of images that already had a label; the last line for an id wins.
"""

from __future__ import annotations

import json
from pathlib import Path

from .common import read_jsonl
from .taxonomy import ML_ROOT, load_taxonomy

DECISIONS_PATH = ML_ROOT / "reviews" / "decisions.jsonl"
# labeled: subcategory confirmed; unknown: none of the options fits; rejected: unusable image or wrong category.
STATUSES = ("labeled", "unknown", "rejected")


def proposals_path(root: Path) -> Path:
    return root / "review" / "proposals.jsonl"


def load_decisions(path: Path = DECISIONS_PATH) -> dict[str, dict]:
    if not path.exists():
        return {}
    return {decision["id"]: decision for decision in read_jsonl(path)}


def append_decisions(decisions: list[dict], path: Path = DECISIONS_PATH) -> None:
    taxonomy = load_taxonomy()
    for decision in decisions:
        if decision["status"] not in STATUSES:
            raise ValueError(f"Estado no válido: {decision['status']}")
        if (decision["status"] == "labeled") != bool(decision.get("subcategory")):
            raise ValueError("Solo las decisiones 'labeled' llevan subcategoría")
        if decision.get("subcategory") and decision["subcategory"] not in taxonomy.subcategories:
            raise ValueError(f"Subcategoría desconocida: {decision['subcategory']}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as lines:
        for decision in decisions:
            lines.write(json.dumps(decision, ensure_ascii=False) + "\n")


def apply_decisions(records: list[dict], decisions: dict[str, dict]) -> list[dict]:
    """Fills reviewed subcategories and drops rejected images.

    A decision never overrides a source label, except relabel decisions (propose --relabel): they replace the
    subcategory, and the category with it, or clear the subcategory when none of the options fits.
    """
    taxonomy = load_taxonomy()
    output = []
    for record in records:
        decision = decisions.get(record["id"])
        if decision and decision["status"] == "rejected":
            continue
        if decision and decision.get("relabel"):
            subcategory = decision["subcategory"] if decision["status"] == "labeled" else None
            labels = {**record["labels"], "subcategory": subcategory}
            if subcategory:
                labels["category"] = taxonomy.category_of(subcategory)
            # E.g. trousers relabeled as a skirt lose their fit.
            for head in taxonomy.attributes:
                if labels.get(head) is not None and not taxonomy.applies(head, labels["category"], subcategory):
                    labels[head] = None
            record ={**record, "labels": labels, "meta": {**record["meta"], "subcategorySource": "review"}}
        elif decision and decision["status"] == "labeled" and record["labels"]["subcategory"] is None:
            subcategory = decision["subcategory"]
            if taxonomy.category_of(subcategory) == record["labels"]["category"]:
                record = {**record, "labels": {**record["labels"], "subcategory": subcategory},
                          "meta": {**record["meta"], "subcategorySource": "review"}}
        output.append(record)
    return output
