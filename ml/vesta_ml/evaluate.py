"""Evalúa un modelo entrenado: python -m vesta_ml.evaluate heads-v1 [--source vesta] [--split test].

Por defecto usa todas las fotos propias (`vesta`): un modelo entrenado antes de importarlas no las ha visto.
Con --folder evalúa una carpeta de imágenes etiquetadas por el nombre de sus carpetas (botas/, Calzado/zuecos/…).
Esas imágenes no se copian, no se guardan en la caché y nunca entran en el manifiesto ni en el entrenamiento.
Muestra métricas por cabeza y, con --details, la predicción de cada foto.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torch.utils.data import DataLoader

from .common import data_dir, empty_labels, read_jsonl
from .embed import ImageDataset, cache_dir, embed_batch, load_backbone
from .features import FEATURE_DIM, PREPROCESSING, EmbeddingCache
from .targets import HeadSpec, apply_rules, encode, evaluate
from .sources.photo_folders import IMAGE_SUFFIXES, folder_labels
from .taxonomy import Taxonomy, load_taxonomy
from .train import MultiHead

def folder_records(folder: Path, taxonomy: Taxonomy) -> tuple[list[dict], list[str]]:
    """Records for every readable image under `folder`, plus the skipped paths and why."""
    records, skipped = [], []
    for path in sorted(folder.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        relative = path.relative_to(folder)
        labels = folder_labels(relative.parts[:-1], taxonomy)
        if labels is None:
            skipped.append(f"{relative.as_posix()}: la carpeta no es ninguna categoría ni subcategoría")
            continue
        try:
            with Image.open(path) as image:
                image.verify()
        except Exception:
            skipped.append(f"{relative.as_posix()}: no se puede abrir")
            continue
        records.append({"id": relative.as_posix(), "image": relative.as_posix(), "group": relative.parent.as_posix(),
                        "labels": {**empty_labels(), **labels}})
    return records, skipped


def embed_folder(folder: Path, records: list[dict]) -> np.ndarray:
    torch.set_num_threads(max(1, (os.cpu_count() or 2) // 2))
    backbone = load_backbone()
    loader = DataLoader(ImageDataset(folder, records), batch_size=32, num_workers=min(4, os.cpu_count() or 1))
    rows = np.zeros((len(records), FEATURE_DIM), np.float32)
    for indices, pixels in loader:
        rows[indices.numpy()] = embed_batch(backbone, pixels).numpy()
    return rows


def folder_errors(specs: list[HeadSpec], records: list[dict], outputs: dict, active: dict) -> list[str]:
    """Photos whose category or subcategory was wrong; values the model was not trained on are not counted."""
    errors = []
    for spec in specs:
        if spec.name not in ("category", "subcategory"):
            continue
        for row, record in enumerate(records):
            truth = record["labels"][spec.name]
            if truth not in spec.values:
                continue
            predicted = spec.values[int(outputs[spec.name][row].argmax())] if active[spec.name][row] else "desconocido"
            if predicted != truth:
                errors.append(f"{record['id']}: {truth} → {predicted}")
    return errors


def load_heads(root: Path, name: str) -> tuple[list[HeadSpec], MultiHead, dict]:
    """A saved model from models/<name>: head specs, the network in eval mode and heads.json."""
    directory = root / "models" / name
    metadata = json.loads((directory / "heads.json").read_text(encoding="utf-8"))
    if metadata["preprocessing"] != PREPROCESSING:
        raise SystemExit("El modelo usa otro preprocesado que la caché de embeddings actual.")
    specs = [HeadSpec(head["name"], head["multiLabel"], head["values"], head["dropped"]) for head in metadata["heads"]]
    model = MultiHead(specs, np.zeros(FEATURE_DIM, np.float32), np.ones(FEATURE_DIM, np.float32),
                      metadata["training"]["hidden"], metadata["training"]["dropout"])
    model.load_state_dict(torch.load(directory / "heads.pt", weights_only=True))
    model.eval()
    return specs, model, metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", help="Nombre del directorio en models/")
    parser.add_argument("--source", default="vesta")
    parser.add_argument("--folder", type=Path, help="Carpeta de imágenes etiquetadas por el nombre de sus carpetas")
    parser.add_argument("--split", choices=("train", "val", "test"))
    parser.add_argument("--details", action="store_true")
    arguments = parser.parse_args()

    root = data_dir()
    specs, model, metadata = load_heads(root, arguments.model)

    taxonomy = load_taxonomy()
    if arguments.folder:
        records, skipped = folder_records(arguments.folder, taxonomy)
        for line in skipped:
            print(f"  omitida {line}")
        if not records:
            raise SystemExit("No hay imágenes dentro de carpetas con nombre de categoría o subcategoría.")
        features = embed_folder(arguments.folder, records)
        described = f"{len(records)} fotos de {arguments.folder}"
    else:
        records = [record for record in read_jsonl(root / "manifest.jsonl")
                   if record["source"] == arguments.source and (not arguments.split or record["split"] == arguments.split)]
        if not records:
            raise SystemExit("No hay imágenes con ese filtro.")
        features = EmbeddingCache(cache_dir(root)).load([r["id"] for r in records])
        described = f"{len(records)} fotos de {len({r['group'] for r in records})} prendas ({arguments.source})"
    with torch.inference_mode():
        outputs = {name: logits.numpy() for name, logits in model(torch.from_numpy(features)).items()}

    outputs, active = apply_rules(specs, outputs, taxonomy)
    print(f"{arguments.model} sobre {described}")
    for spec in specs:
        result = evaluate(spec, encode(records, spec), outputs[spec.name], active[spec.name])
        if not result:
            print(f"  {spec.name:12s} sin etiquetas")
            continue
        errors = ", ".join(f"{item['true']}→{item['predicted']} ×{item['count']}" for item in result.get("topConfusions", []))
        print(f"  {spec.name:12s} n={result['n']:3d}  acc {result['accuracy']:.3f}  macro-F1 {result['macroF1']:.3f}"
              + (f"  errores: {errors}" if errors else ""))
    if metadata["untrainedHeads"]:
        print(f"  sin entrenar: {', '.join(metadata['untrainedHeads'])}")

    if arguments.folder:
        trained = {value for spec in specs for value in spec.values}
        unknown = sorted({record["labels"]["subcategory"] for record in records} - trained - {None})
        if unknown:
            print(f"  el modelo aún no conoce: {', '.join(unknown)} (no cuentan en la subcategoría)")
        if not arguments.details and (errors := folder_errors(specs, records, outputs, active)):
            print(f"\nFallos ({len(errors)}):\n  " + "\n  ".join(errors))

    if arguments.details:
        for row, record in enumerate(records):
            parts = []
            for spec in specs:
                if not active[spec.name][row]:
                    parts.append(f"{spec.name}=—")
                    continue
                probabilities = torch.softmax(torch.from_numpy(outputs[spec.name][row]), dim=0).numpy()
                best = int(probabilities.argmax())
                truth = record["labels"][spec.name]
                mark = "" if truth is None else (" ✓" if truth == spec.values[best] else f" ✗ ({truth})")
                parts.append(f"{spec.name}={spec.values[best]} {probabilities[best]:.0%}{mark}")
            print(f"\n{record['id']}\n  " + "\n  ".join(parts))


if __name__ == "__main__":
    main()
