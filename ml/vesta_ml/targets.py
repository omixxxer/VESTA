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


def evaluate(spec: HeadSpec, targets: np.ndarray, outputs: np.ndarray) -> dict | None:
    """outputs: logits (n, classes). Macro-F1 averages only classes present in `targets`."""
    mask = labeled_mask(targets, spec.multi_label)
    if not mask.any():
        return None
    targets, outputs = targets[mask], outputs[mask]
    classes = len(spec.values)
    if spec.multi_label:
        true = targets > 0.5
        predicted = outputs > 0
        exact = float((true == predicted).all(axis=1).mean())
    else:
        true = np.eye(classes, dtype=bool)[targets]
        predicted = np.eye(classes, dtype=bool)[outputs.argmax(axis=1)]
        exact = float((outputs.argmax(axis=1) == targets).mean())
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
        for truth, guess in zip(targets, outputs.argmax(axis=1)):
            if truth != guess:
                confusions[(spec.values[truth], spec.values[guess])] += 1
        result["topConfusions"] = [
            {"true": truth, "predicted": guess, "count": count} for (truth, guess), count in confusions.most_common(8)
        ]
    return result
