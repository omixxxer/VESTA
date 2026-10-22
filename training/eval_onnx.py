"""Compara precisión fp32 vs int8 (los ONNX exportados) sobre manifiestos de validación.

    python eval_onnx.py --model-dir dist/vesta-garment-classifier --manifests data/prepared/manifest_val.jsonl

Criterio sugerido: no publicar el int8 si la precisión equilibrada de 'subtype' cae más de ~2 puntos
respecto al fp32; en ese caso exporta/usa el fp32 o prueba cuantización estática con calibración.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from common import IGNORE_INDEX, IMAGENET_MEAN, IMAGENET_STD


def preprocess(path: Path, size: int) -> np.ndarray:
    with Image.open(path) as image:
        image = image.convert("RGB").resize((size, size), Image.BILINEAR)
    array = (np.asarray(image, dtype=np.float32) / 255.0 - np.array(IMAGENET_MEAN, dtype=np.float32)) / np.array(IMAGENET_STD, dtype=np.float32)
    return array.transpose(2, 0, 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--manifests", nargs="+", required=True, type=Path)
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()

    meta = json.loads((args.model_dir / "vesta_model.json").read_text(encoding="utf-8"))
    size = meta["input"]["size"]
    heads = meta["heads"]
    rows = []
    for manifest in args.manifests:
        for line in manifest.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                row["_root"] = manifest.parent
                rows.append(row)

    for variant in ("model.onnx", "model_quantized.onnx"):
        session = ort.InferenceSession(str(args.model_dir / "onnx" / variant), providers=["CPUExecutionProvider"])
        output_names = [spec["output"] for spec in heads.values()]
        hits = {h: {} for h in heads}
        for start in range(0, len(rows), args.batch_size):
            batch = rows[start:start + args.batch_size]
            pixels = np.stack([preprocess(r["_root"] / r["image"], size) for r in batch])
            outputs = session.run(output_names, {"pixel_values": pixels})
            for head, logits in zip(heads, outputs):
                classes = heads[head]["classes"]
                for row, prediction in zip(batch, logits.argmax(1)):
                    value = row["labels"].get(head)
                    if value is None or value not in classes:
                        continue
                    target = classes.index(value)
                    stats = hits[head].setdefault(target, [0, 0])
                    stats[0] += int(prediction == target)
                    stats[1] += 1
        print(f"== {variant}")
        for head in heads:
            stats = hits[head]
            if not stats:
                continue
            recalls = [h / n for h, n in stats.values()]
            total = sum(n for _, n in stats.values())
            accuracy = sum(h for h, _ in stats.values()) / total
            print(f"  {head:14s} acc={accuracy:.3f}  bal_acc={sum(recalls) / len(recalls):.3f}  n={total}")


if __name__ == "__main__":
    main()
