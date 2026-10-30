"""Exporta un modelo entrenado a ONNX para la app: python -m vesta_ml.export heads-v4 [--check 300].

Un único grafo: imagen preprocesada (1×3×224×224, letterbox y normalización ya hechos) → DINOv2 → CLS + media de
parches → cabezas → logits de cada cabeza. Se cuantiza a int8 (pesos) y se guarda en public/models/vesta/ junto a
vesta-model.json (valores de cada cabeza, preprocesado y reglas), que la app lee para interpretar las salidas.
Con --check compara PyTorch, ONNX fp32 y ONNX int8 en imágenes de test.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from .common import data_dir, read_jsonl
from .embed import load_backbone
from .evaluate import load_heads
from .features import preprocess
from .taxonomy import ML_ROOT

OUTPUT = ML_ROOT.parent / "public" / "models" / "vesta"
MODEL_FILE = "model_quantized.onnx"
METADATA_FILE = "vesta-model.json"
FORMAT = "vesta-model"


class ExportedModel(torch.nn.Module):
    def __init__(self, backbone: torch.nn.Module, heads: torch.nn.Module, names: list[str]):
        super().__init__()
        self.backbone, self.heads, self.names = backbone, heads, names

    def forward(self, pixel_values: torch.Tensor) -> tuple[torch.Tensor, ...]:
        hidden = self.backbone(pixel_values=pixel_values).last_hidden_state
        features = torch.cat([hidden[:, 0], hidden[:, 1:].mean(dim=1)], dim=1)
        outputs = self.heads(features)
        return tuple(outputs[name] for name in self.names)


def export(model: ExportedModel, path: Path) -> None:
    example = torch.zeros(1, 3, 224, 224)
    torch.onnx.export(model, (example,), str(path), input_names=["pixel_values"], output_names=model.names,
                      opset_version=18, dynamo=True, external_data=False)


def quantize(source: Path, destination: Path) -> None:
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic

    # The torch exporter leaves shape annotations that onnx shape inference rejects; they are recomputed anyway.
    model = onnx.load(str(source))
    del model.graph.value_info[:]
    cleaned = source.with_name("model-clean.onnx")
    onnx.save(model, str(cleaned))
    quantize_dynamic(str(cleaned), str(destination), weight_type=QuantType.QInt8)
    cleaned.unlink()


def check(model: ExportedModel, paths: dict[str, Path], records: list[dict], root: Path) -> None:
    """Agreement of each ONNX file with PyTorch on the top prediction of every head, plus the largest logit gap."""
    import onnxruntime

    sessions = {name: onnxruntime.InferenceSession(str(path), providers=["CPUExecutionProvider"])
                for name, path in paths.items()}
    agree = {name: {head: 0 for head in model.names} for name in sessions}
    gap = {name: 0.0 for name in sessions}
    for record in records:
        with Image.open(root / record["image"]) as image:
            pixels = preprocess(image)[None]
        with torch.inference_mode():
            reference = [output.numpy() for output in model(torch.from_numpy(pixels))]
        for name, session in sessions.items():
            outputs = session.run(model.names, {"pixel_values": pixels})
            for head, expected, actual in zip(model.names, reference, outputs):
                agree[name][head] += int(expected.argmax() == actual.argmax())
                gap[name] = max(gap[name], float(np.abs(expected - actual).max()))
    for name in sessions:
        heads = ", ".join(f"{head} {agree[name][head] / len(records):.1%}" for head in model.names)
        print(f"  {name}: misma predicción que PyTorch en {heads}; diferencia máxima de logit {gap[name]:.3f}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", help="Nombre del directorio en models/")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--check", type=int, default=300, help="Imágenes de test para comparar (0 para no comparar)")
    arguments = parser.parse_args()

    root = data_dir()
    specs, heads, metadata = load_heads(root, arguments.model)
    names = [spec.name for spec in specs]
    model = ExportedModel(load_backbone(), heads, names).eval()

    work = root / "models" / arguments.model / "onnx"
    work.mkdir(parents=True, exist_ok=True)
    full, quantized = work / "model.onnx", work / MODEL_FILE
    print("Exportando a ONNX…")
    export(model, full)
    quantize(full, quantized)
    print(f"ONNX fp32 {full.stat().st_size / 1e6:.1f} MB, int8 {quantized.stat().st_size / 1e6:.1f} MB")

    if arguments.check:
        test = [record for record in read_jsonl(root / "manifest.jsonl") if record["split"] == "test"]
        step = max(1, len(test) // arguments.check)
        print(f"Comparando con PyTorch en {len(test[::step][:arguments.check])} imágenes de test…")
        check(model, {"fp32": full, "int8": quantized}, test[::step][:arguments.check], root)

    arguments.output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(quantized, arguments.output / MODEL_FILE)
    description = {
        "format": FORMAT,
        "name": arguments.model,
        "taxonomyVersion": metadata["taxonomyVersion"],
        "preprocessing": metadata["preprocessing"],
        "input": "pixel_values",
        "heads": [{"name": spec.name, "multiLabel": spec.multi_label, "values": spec.values} for spec in specs],
        "rules": metadata["rules"],
        "file": MODEL_FILE,
        "bytes": quantized.stat().st_size,
    }
    (arguments.output / METADATA_FILE).write_text(json.dumps(description, indent=2, ensure_ascii=False) + "\n",
                                                  encoding="utf-8")
    print(f"Modelo para la app en {arguments.output}")


if __name__ == "__main__":
    main()
