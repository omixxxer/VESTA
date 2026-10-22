"""Prueba de humo de extremo a extremo en CPU con imágenes SINTÉTICAS.

Valida el pipeline (dataset -> entrenamiento -> checkpoint -> ONNX -> cuantización), NO la calidad del
modelo. Las imágenes son formas de color generadas al vuelo; no hay datos reales.

    python smoke_test.py --workdir /ruta/temporal
"""
from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

from common import Taxonomy

HERE = Path(__file__).resolve().parent
SUBTYPES = ["shirt_blouse", "pants", "shoe"]


def draw(subtype: str, rng: random.Random, size: int = 96) -> Image.Image:
    image = Image.new("RGB", (size, size), (245, 245, 245))
    pen = ImageDraw.Draw(image)
    color = tuple(rng.randint(30, 220) for _ in range(3))
    if subtype == "shirt_blouse":
        pen.rectangle([28, 22, 68, 78], fill=color)
        pen.rectangle([14, 22, 82, 36], fill=color)
    elif subtype == "pants":
        pen.rectangle([30, 10, 66, 30], fill=color)
        pen.rectangle([30, 30, 46, 88], fill=color)
        pen.rectangle([50, 30, 66, 88], fill=color)
    else:
        pen.ellipse([12, 52, 84, 80], fill=color)
        pen.rectangle([12, 40, 40, 66], fill=color)
    return image


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--workdir", required=True, type=Path)
    parser.add_argument("--per-class", type=int, default=60)
    parser.add_argument("--backbone", default="mobilenetv3_small_100")
    args = parser.parse_args()

    taxonomy = Taxonomy.load()
    rng = random.Random(1)
    data = args.workdir / "data"
    for split, count in (("train", args.per_class), ("val", 15)):
        (data / "crops" / split).mkdir(parents=True, exist_ok=True)
        with (data / f"manifest_{split}.jsonl").open("w", encoding="utf-8") as manifest:
            for subtype in SUBTYPES:
                for index in range(count):
                    relative = f"crops/{split}/{subtype}_{index}.jpg"
                    draw(subtype, rng).save(data / relative)
                    labels = {
                        "subtype": subtype,
                        "category": taxonomy.subtype_category(subtype),
                        # Cabeza con etiquetas parciales: solo la mitad de las imágenes la tienen.
                        **({"pattern": rng.choice(["plain", "striped"])} if index % 2 == 0 else {}),
                    }
                    manifest.write(json.dumps({"image": relative, "split": split, "source": "synthetic", "labels": labels}) + "\n")

    run = lambda *cmd: subprocess.run([sys.executable, *map(str, cmd)], cwd=HERE, check=True)
    run("train.py", "--manifests", data / "manifest_train.jsonl", "--val-manifests", data / "manifest_val.jsonl",
        "--out", args.workdir / "run", "--backbone", args.backbone, "--no-pretrained", "--epochs", "3",
        "--batch-size", "16", "--workers", "0", "--device", "cpu", "--image-size", "96", "--min-per-class", "10")
    run("export_onnx.py", "--checkpoint", args.workdir / "run" / "best.pt", "--out", args.workdir / "dist")
    meta = json.loads((args.workdir / "dist" / "vesta_model.json").read_text(encoding="utf-8"))
    assert set(meta["heads"]) >= {"subtype", "category"}, meta["heads"].keys()
    print("SMOKE TEST OK. Cabezas exportadas:", list(meta["heads"]))


if __name__ == "__main__":
    main()
