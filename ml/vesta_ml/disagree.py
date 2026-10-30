"""Propuestas de revisión donde un modelo entrenado contradice la etiqueta: python -m vesta_ml.disagree heads-v3.

Busca imágenes con subcategoría en las que el modelo predice otra con seguridad (--min-confidence) y apenas da
probabilidad a la etiqueta (--max-label). Suelen ser etiquetas erróneas o dudosas de las fuentes. Se revisan con
vesta_ml.review como las de propose --relabel: cada imagen llega marcada con su etiqueta actual (guardar sin tocar
la confirma) y la decisión sustituye la etiqueta, categoría incluida. Las fotos propias (vesta) no se incluyen: se
corrigen en la app.
"""

from __future__ import annotations

import argparse
import json
import time

import numpy as np
import torch

from .common import data_dir, read_jsonl
from .embed import cache_dir
from .evaluate import load_heads
from .features import EmbeddingCache
from .reviews import load_decisions, proposals_path
from .targets import HeadSpec, apply_rules
from .taxonomy import Taxonomy, load_taxonomy


def disagreements(records: list[dict], spec: HeadSpec, probabilities: np.ndarray, predicted: list[str | None],
                  min_confidence: float, max_label: float) -> list[tuple[dict, list[tuple[str, float]]]]:
    """Records whose label the model contradicts, with candidates: the label first, the prediction second."""
    index = {value: position for position, value in enumerate(spec.values)}
    found = []
    for row, record in enumerate(records):
        label, guess = record["labels"]["subcategory"], predicted[row]
        if label not in index or guess is None or guess == label:
            continue
        if probabilities[row, index[guess]] < min_confidence or probabilities[row, index[label]] >= max_label:
            continue
        ranked = sorted(((value, float(probabilities[row, position])) for value, position in index.items()
                         if value not in (label, guess)), key=lambda pair: -pair[1])
        found.append((record, [(label, float(probabilities[row, index[label]])),
                               (guess, float(probabilities[row, index[guess]]))] + ranked))
    return found


def proposal(record: dict, candidates: list[tuple[str, float]], taxonomy: Taxonomy, model: str, at: str) -> dict:
    return {
        "id": record["id"], "image": record["image"], "source": record["source"],
        "category": taxonomy.category_of(candidates[0][0]),
        "candidates": [{"value": value, "p": round(p, 4)} for value, p in candidates],
        "relabel": True, "model": model, "at": at,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", help="Nombre del directorio en models/")
    parser.add_argument("--min-confidence", type=float, default=0.5, help="Probabilidad mínima de la predicción")
    parser.add_argument("--max-label", type=float, default=0.2, help="Probabilidad máxima de la etiqueta actual")
    arguments = parser.parse_args()

    root = data_dir()
    taxonomy = load_taxonomy()
    decisions = load_decisions()
    # Images already relabeled by hand are settled; other reviews only filled a missing subcategory.
    records = [record for record in read_jsonl(root / "manifest.jsonl")
               if record["labels"]["subcategory"] and record["source"] != "vesta"
               and not decisions.get(record["id"], {}).get("relabel")]
    specs, model, _ = load_heads(root, arguments.model)
    with torch.inference_mode():
        features = EmbeddingCache(cache_dir(root)).load([record["id"] for record in records])
        outputs = {name: logits.numpy() for name, logits in model(torch.from_numpy(features)).items()}
    spec = next(spec for spec in specs if spec.name == "subcategory")
    probabilities = torch.softmax(torch.from_numpy(outputs["subcategory"]), dim=1).numpy()
    ruled, active = apply_rules(specs, dict(outputs), taxonomy)
    predicted = [spec.values[int(row.argmax())] if on else None for row, on in zip(ruled["subcategory"], active["subcategory"])]

    found = disagreements(records, spec, probabilities, predicted, arguments.min_confidence, arguments.max_label)
    at = time.strftime("%Y-%m-%dT%H:%M:%S")
    path = proposals_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as lines:
        for record, candidates in found:
            lines.write(json.dumps(proposal(record, candidates, taxonomy, arguments.model, at), ensure_ascii=False) + "\n")
    print(f"{len(found)} imágenes en las que {arguments.model} contradice la etiqueta. Revísalas con: python -m vesta_ml.review")


if __name__ == "__main__":
    main()
