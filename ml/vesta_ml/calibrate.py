"""Calibra las confianzas de un modelo: python -m vesta_ml.calibrate heads-v4.

Ajusta una temperatura por cabeza (temperature scaling) en las fotos de validación: los logits se dividen por T antes
del softmax, de modo que un 80 % acierte más o menos 8 de cada 10 veces. No cambia qué valor gana. Guarda
calibration.json junto al modelo, muestra el error de calibración (ECE) antes y después en validación y test, y
actualiza public/models/vesta/vesta-model.json si describe este mismo modelo.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

from .targets import MISSING, HeadSpec, encode

CALIBRATION_FILE = "calibration.json"
BINS = 15


def softmax(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    scaled = logits / temperature
    scaled = scaled - scaled.max(axis=1, keepdims=True)
    exponentials = np.exp(scaled)
    return exponentials / exponentials.sum(axis=1, keepdims=True)


def negative_log_likelihood(logits: np.ndarray, targets: np.ndarray, temperature: float) -> float:
    probabilities = softmax(logits, temperature)
    return float(-np.log(probabilities[np.arange(len(targets)), targets] + 1e-12).mean())


def fit_temperature(logits: np.ndarray, targets: np.ndarray) -> float:
    """Temperature that minimises the negative log-likelihood; golden-section search on log T in [1/20, 20]."""
    if not len(targets):
        return 1.0
    low, high = math.log(0.05), math.log(20.0)
    ratio = (math.sqrt(5) - 1) / 2
    for _ in range(60):
        left, right = high - ratio * (high - low), low + ratio * (high - low)
        if negative_log_likelihood(logits, targets, math.exp(left)) < negative_log_likelihood(logits, targets, math.exp(right)):
            high = right
        else:
            low = left
    return math.exp((low + high) / 2)


def calibration_error(probabilities: np.ndarray, targets: np.ndarray, bins: int = BINS) -> float:
    """Expected calibration error: mean gap between confidence and accuracy, weighted by photos per bin."""
    if not len(targets):
        return 0.0
    confidence = probabilities.max(axis=1)
    correct = probabilities.argmax(axis=1) == targets
    edges = np.linspace(0, 1, bins + 1)
    error = 0.0
    for low, high in zip(edges[:-1], edges[1:]):
        inside = (confidence > low) & (confidence <= high)
        if inside.any():
            error += inside.mean() * abs(confidence[inside].mean() - correct[inside].mean())
    return float(error)


def labeled(spec: HeadSpec, records: list[dict], logits: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    targets = encode(records, spec)
    keep = targets != MISSING
    return logits[keep], targets[keep]


def temperatures(specs: list[HeadSpec], records: list[dict], outputs: dict[str, np.ndarray]) -> dict[str, float]:
    """One temperature per single-label head; multi-label heads are not shown as a percentage in the app."""
    return {spec.name: round(fit_temperature(*labeled(spec, records, outputs[spec.name])), 4)
            for spec in specs if not spec.multi_label}


def main() -> None:
    import torch

    from .common import data_dir, read_jsonl
    from .embed import cache_dir
    from .evaluate import load_heads
    from .export import METADATA_FILE, OUTPUT
    from .features import EmbeddingCache

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", help="Nombre del directorio en models/")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    arguments = parser.parse_args()

    root = data_dir()
    specs, model, _ = load_heads(root, arguments.model)
    records = list(read_jsonl(root / "manifest.jsonl"))
    cache = EmbeddingCache(cache_dir(root))
    splits = {}
    for split in ("val", "test"):
        chosen = [record for record in records if record["split"] == split]
        with torch.inference_mode():
            features = torch.from_numpy(cache.load([record["id"] for record in chosen]))
            splits[split] = (chosen, {name: logits.numpy() for name, logits in model(features).items()})

    found = temperatures(specs, *splits["val"])
    print(f"{arguments.model}: error de calibración (ECE) antes → después")
    for spec in specs:
        if spec.name not in found:
            continue
        parts = []
        for split, (chosen, outputs) in splits.items():
            logits, targets = labeled(spec, chosen, outputs[spec.name])
            before = calibration_error(softmax(logits), targets)
            after = calibration_error(softmax(logits, found[spec.name]), targets)
            parts.append(f"{split} {before:.1%} → {after:.1%}")
        print(f"  {spec.name:12s} T={found[spec.name]:.2f}  " + "  ".join(parts))

    (root / "models" / arguments.model / CALIBRATION_FILE).write_text(
        json.dumps({"method": "temperature", "split": "val", "temperatures": found}, indent=2) + "\n", encoding="utf-8")
    description_path = arguments.output / METADATA_FILE
    if description_path.exists():
        description = json.loads(description_path.read_text(encoding="utf-8"))
        if description.get("name") == arguments.model:
            for head in description["heads"]:
                if head["name"] in found:
                    head["temperature"] = found[head["name"]]
            description_path.write_text(json.dumps(description, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            print(f"Temperaturas añadidas a {description_path}")


if __name__ == "__main__":
    main()
