"""Backbone preprocessing and the on-disk embedding cache (numpy only, no torch)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

BACKBONE = "facebook/dinov2-small"  # Apache-2.0
INPUT_SIZE = 224  # 16 x 16 patches of 14 px
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)
# Padding with the mean colour makes the padded area ~0 after normalisation.
PAD_COLOR = tuple(round(value * 255) for value in MEAN)
# CLS token + mean of patch tokens, both after the final layer norm.
FEATURE_LAYOUT = "cls+mean-patch"
FEATURE_DIM = 2 * 384

PREPROCESSING = {
    "backbone": BACKBONE,
    "inputSize": INPUT_SIZE,
    "resize": "letterbox-bilinear",
    "padColor": list(PAD_COLOR),
    "mean": list(MEAN),
    "std": list(STD),
    "features": FEATURE_LAYOUT,
    "featureDim": FEATURE_DIM,
}


def letterbox(image: Image.Image, size: int = INPUT_SIZE) -> Image.Image:
    """Fit the whole garment in a square without cropping (a centre crop can cut sleeves or hems)."""
    image = ImageOps.exif_transpose(image).convert("RGB")
    scale = size / max(image.size)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.BILINEAR)
    canvas = Image.new("RGB", (size, size), PAD_COLOR)
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def preprocess(image: Image.Image) -> np.ndarray:
    """Returns a float32 CHW array ready for the backbone."""
    array = np.asarray(letterbox(image), dtype=np.float32) / 255.0
    array = (array - np.array(MEAN, dtype=np.float32)) / np.array(STD, dtype=np.float32)
    return array.transpose(2, 0, 1).copy()


class EmbeddingCache:
    """Shards of (ids, float16 features). Ids are manifest record ids, which stay stable across merges."""

    def __init__(self, directory: Path):
        self.directory = directory
        self.config_path = directory / "config.json"

    def check_config(self) -> None:
        if self.config_path.exists():
            stored = json.loads(self.config_path.read_text(encoding="utf-8"))
            if stored != PREPROCESSING:
                raise SystemExit(f"{self.directory} se calculó con otro preprocesado; bórralo o usa otro directorio.")
        else:
            self.directory.mkdir(parents=True, exist_ok=True)
            self.config_path.write_text(json.dumps(PREPROCESSING, indent=2), encoding="utf-8")

    def shards(self) -> list[Path]:
        return sorted(self.directory.glob("shard-*.npz"))

    def known_ids(self) -> set[str]:
        ids: set[str] = set()
        for shard in self.shards():
            with np.load(shard) as data:
                ids.update(data["ids"].tolist())
        return ids

    def write_shard(self, ids: list[str], features: np.ndarray) -> Path:
        index = len(self.shards())
        path = self.directory / f"shard-{index:05d}.npz"
        partial = path.with_name(path.stem + ".part.npz")
        np.savez(partial, ids=np.array(ids), features=features.astype(np.float16))
        partial.replace(path)
        return path

    def load(self, ids: list[str]) -> np.ndarray:
        """Features for the given ids, in order, as float32. Fails if any id is missing."""
        position = {record_id: index for index, record_id in enumerate(ids)}
        output = np.zeros((len(ids), FEATURE_DIM), dtype=np.float32)
        found = np.zeros(len(ids), dtype=bool)
        for shard in self.shards():
            with np.load(shard) as data:
                for record_id, row in zip(data["ids"].tolist(), data["features"]):
                    index = position.get(record_id)
                    if index is not None:
                        output[index] = row
                        found[index] = True
        if not found.all():
            missing = [ids[index] for index in np.flatnonzero(~found)[:5]]
            raise SystemExit(f"Faltan {int((~found).sum())} embeddings (p. ej. {missing}); ejecuta vesta_ml.embed.")
        return output
