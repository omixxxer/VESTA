"""Exporta un checkpoint a ONNX (fp32 y cuantizado int8) + metadatos para la app.

    python export_onnx.py --checkpoint runs/vesta-v1/best.pt --out dist/vesta-garment-classifier

Genera en --out:
    onnx/model.onnx             (fp32)
    onnx/model_quantized.onnx   (int8 dinámico, el que debería cargar la app)
    vesta_model.json            (cabezas, clases, preprocesado, versión)
Salidas ONNX: una por cabeza, llamadas logits_<cabeza>. Entrada: pixel_values [N,3,H,W].
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic

from common import IMAGENET_MEAN, IMAGENET_STD, Taxonomy
from model import MultiHeadClassifier


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--taxonomy", type=Path, default=None)
    parser.add_argument("--model-version", default=None, help="Por defecto, sha256[:12] del ONNX fp32.")
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()

    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    taxonomy = Taxonomy.load(args.taxonomy)
    if checkpoint["taxonomy_version"] != taxonomy.version:
        raise SystemExit(f"El checkpoint usa taxonomía {checkpoint['taxonomy_version']} y la actual es {taxonomy.version}.")

    model = MultiHeadClassifier(checkpoint["backbone"], checkpoint["head_sizes"], pretrained=False)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    size = checkpoint["image_size"]
    heads: list[str] = checkpoint["heads"]

    onnx_dir = args.out / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)
    fp32_path = onnx_dir / "model.onnx"
    dummy = torch.randn(1, 3, size, size)
    torch.onnx.export(
        model, (dummy,), str(fp32_path),
        input_names=["pixel_values"], output_names=[f"logits_{h}" for h in heads],
        dynamic_axes={"pixel_values": {0: "batch"}, **{f"logits_{h}": {0: "batch"} for h in heads}},
        opset_version=args.opset, dynamo=False,
    )
    onnx.checker.check_model(onnx.load(str(fp32_path)))

    quant_path = onnx_dir / "model_quantized.onnx"
    quantize_dynamic(str(fp32_path), str(quant_path), weight_type=QuantType.QUInt8)

    # Verificación: PyTorch vs ONNX fp32 vs int8 sobre entradas aleatorias.
    sample = torch.randn(4, 3, size, size)
    with torch.no_grad():
        reference = [o.numpy() for o in model(sample)]
    report = {}
    for label, path in (("fp32", fp32_path), ("int8", quant_path)):
        session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        outputs = session.run(None, {"pixel_values": sample.numpy()})
        deltas = [float(np.abs(a - b).max()) for a, b in zip(outputs, reference)]
        agree = [float((a.argmax(1) == b.argmax(1)).mean()) for a, b in zip(outputs, reference)]
        report[label] = {"max_abs_logit_diff": max(deltas), "argmax_agreement": min(agree)}
        print(f"{label}: diff máx logits={max(deltas):.4f} | coincidencia argmax mín={min(agree):.2f}")
    if report["fp32"]["max_abs_logit_diff"] > 1e-3:
        raise SystemExit("El ONNX fp32 no coincide con PyTorch: no publiques este modelo.")

    version = args.model_version or sha256(fp32_path)[:12]
    metadata = {
        "name": "vesta-garment-classifier",
        "modelVersion": version,
        "taxonomyVersion": taxonomy.version,
        "backbone": checkpoint["backbone"],
        "input": {
            "name": "pixel_values", "size": size, "resize": "direct-squash",
            "mean": list(IMAGENET_MEAN), "std": list(IMAGENET_STD), "channelOrder": "RGB",
        },
        "heads": {
            head: {
                "output": f"logits_{head}",
                "classes": taxonomy.values[head],
                "labelsEs": [taxonomy.data["heads"][head]["values"][v]["es"] for v in taxonomy.values[head]],
                # Solo en 'category': nombre exacto de GarmentCategory en la app.
                **({"appCategories": [taxonomy.data["heads"][head]["values"][v]["app_category"] for v in taxonomy.values[head]]}
                   if head == "category" else {}),
                # Solo en 'subtype': categoría de la app a la que pertenece cada subtipo.
                **({"appCategories": [taxonomy.data["heads"]["category"]["values"][taxonomy.subtype_category(v)]["app_category"]
                                      for v in taxonomy.values[head]]} if head == "subtype" else {}),
            }
            for head in heads
        },
        "validation": checkpoint.get("val_report", {}),
        "exportChecks": report,
        "files": {
            "model_quantized.onnx": {"sha256": sha256(quant_path), "bytes": quant_path.stat().st_size},
            "model.onnx": {"sha256": sha256(fp32_path), "bytes": fp32_path.stat().st_size},
        },
    }
    (args.out / "vesta_model.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Listo: {args.out} | cuantizado: {quant_path.stat().st_size / 1e6:.1f} MB | versión {version}")


if __name__ == "__main__":
    main()
