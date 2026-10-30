"""Label encoding and metrics for the multi-task heads (numpy only, no torch)."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

import numpy as np

from .taxonomy import LABEL_HEADS, MULTI_LABEL_HEADS, Taxonomy

MISSING = -1


@dataclass
class HeadSpec:
    name: str
    multi_label: bool
    values: list[str]
    # Taxonomy values left out because train has too few examples; their labels count as unknown.
    dropped: list[str]


def head_specs(taxonomy: Taxonomy, train_records: list[dict], min_examples: int) -> list[HeadSpec]:
    """One spec per head with enough training data; values keep taxonomy order."""
    specs = []
    for head in LABEL_HEADS:
        multi = head in MULTI_LABEL_HEADS
        counts: Counter[str] = Counter()
        for record in train_records:
            value = record["labels"][head]
            if value is not None:
                counts.update(value if multi else [value])
        values = [value for value in taxonomy.head_values(head) if counts[value] >= min_examples]
        dropped = [value for value in taxonomy.head_values(head) if 0 < counts[value] < min_examples]
        if len(values) >= (1 if multi else 2):
            specs.append(HeadSpec(head, multi, values, dropped))
    return specs


def encode(records: list[dict], spec: HeadSpec) -> np.ndarray:
    """Single-label: int index or MISSING. Multi-label: float multi-hot, or a row of MISSING when unknown."""
    index = {value: position for position, value in enumerate(spec.values)}
    if spec.multi_label:
        output = np.full((len(records), len(spec.values)), MISSING, dtype=np.float32)
        for row, record in enumerate(records):
            value = record["labels"][spec.name]
            if value is None:
                continue
            known = [index[item] for item in value if item in index]
            if len(known) != len(value):
                continue  # A dropped value makes the whole set unreliable.
            output[row] = 0
            output[row, known] = 1
        return output
    output = np.full(len(records), MISSING, dtype=np.int64)
    for row, record in enumerate(records):
        output[row] = index.get(record["labels"][spec.name], MISSING)
    return output


def labeled_mask(targets: np.ndarray, multi_label: bool) -> np.ndarray:
    return targets[:, 0] != MISSING if multi_label else targets != MISSING


def class_weights(targets: np.ndarray, num_classes: int, power: float = 0.5) -> np.ndarray:
    """Inverse-frequency weights softened by `power`, normalised to mean 1 over present classes."""
    counts = np.bincount(targets[targets != MISSING], minlength=num_classes).astype(np.float64)
    weights = np.zeros(num_classes)
    present = counts > 0
    weights[present] = (counts[present] / counts[present].max()) ** -power
    weights[present] /= weights[present].mean()
    return weights.astype(np.float32)


def apply_rules(specs: list[HeadSpec], outputs: dict[str, np.ndarray],
                taxonomy: Taxonomy) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    """Make predictions consistent with the predicted category.

    The subcategory must belong to the category (shoes cannot be a raincoat) and is hidden when the category has
    no trained subcategories; attributes are hidden where they do not apply (Taxonomy.applies: sleeve outside
    tops, fit outside trousers). Returns (logits, active), where active[head] is False for rows whose prediction
    should be shown as unknown.
    """
    logits = dict(outputs)
    active = {spec.name: np.ones(len(next(iter(outputs.values()))), dtype=bool) for spec in specs}
    names = {spec.name: spec for spec in specs}
    if "category" not in names:
        return logits, active
    category = np.array(names["category"].values)[outputs["category"].argmax(axis=1)]
    if "subcategory" in names:
        owner = np.array([taxonomy.category_of(value) for value in names["subcategory"].values])
        allowed = owner[None, :] == category[:, None]
        logits["subcategory"] = np.where(allowed, outputs["subcategory"], np.float32(-1e9))
        active["subcategory"] = allowed.any(axis=1)
    subcategory = [None] * len(category)
    if "subcategory" in names:
        subcategory = [names["subcategory"].values[int(row.argmax())] if on else None
                       for row, on in zip(logits["subcategory"], active["subcategory"])]
    for head in names.keys() & taxonomy.attributes.keys():
        active[head] = np.array([taxonomy.applies(head, cat, sub) for cat, sub in zip(category, subcategory)], dtype=bool)
    return logits, active


def _per_class(true: np.ndarray, predicted: np.ndarray, values: list[str]) -> dict:
    """true/predicted are boolean (n, classes) indicator matrices."""
    report = {}
    for position, value in enumerate(values):
        support = int(true[:, position].sum())
        hits = int((true[:, position] & predicted[:, position]).sum())
        predicted_count = int(predicted[:, position].sum())
        precision = hits / predicted_count if predicted_count else 0.0
        recall = hits / support if support else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        report[value] = {"support": support, "precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4)}
    return report


def evaluate(spec: HeadSpec, targets: np.ndarray, outputs: np.ndarray, active: np.ndarray | None = None) -> dict | None:
    """outputs: logits (n, classes). Macro-F1 averages only classes present in `targets`.

    Rows where `active` is False predict nothing, which counts as a miss when the row is labelled.
    """
    mask = labeled_mask(targets, spec.multi_label)
    if not mask.any():
        return None
    targets, outputs = targets[mask], outputs[mask]
    active = np.ones(len(targets), dtype=bool) if active is None else active[mask]
    classes = len(spec.values)
    if spec.multi_label:
        true = targets > 0.5
        predicted = (outputs > 0) & active[:, None]
        exact = float((true == predicted).all(axis=1).mean())
    else:
        true = np.eye(classes, dtype=bool)[targets]
        guesses = np.where(active, outputs.argmax(axis=1), MISSING)
        predicted = np.eye(classes, dtype=bool)[guesses] & active[:, None]
        exact = float((guesses == targets).mean())
    per_class = _per_class(true, predicted, spec.values)
    present = [entry["f1"] for entry in per_class.values() if entry["support"]]
    result = {
        "n": int(mask.sum()),
        "accuracy": round(exact, 4),
        "macroF1": round(float(np.mean(present)), 4),
        "perClass": per_class,
    }
    if not spec.multi_label:
        confusions: Counter[tuple[str, str]] = Counter()
        for truth, guess in zip(targets, guesses):
            if truth != guess:
                confusions[(spec.values[truth], spec.values[guess] if guess != MISSING else "desconocido")] += 1
        result["topConfusions"] = [
            {"true": truth, "predicted": guess, "count": count} for (truth, guess), count in confusions.most_common(8)
        ]
    return result
