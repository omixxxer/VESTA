"""Embeddings DINOv2 del manifiesto: python -m vesta_ml.embed [--limit N].

Reanudable: solo calcula las imágenes que aún no están en la caché.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModel

from .common import data_dir, read_jsonl
from .features import BACKBONE, EmbeddingCache, preprocess

SHARD_SIZE = 2048


def cache_dir(root: Path) -> Path:
    return root / "embeddings" / "dinov2-small-224"


class ImageDataset(Dataset):
    def __init__(self, root: Path, records: list[dict]):
        self.root = root
        self.records = records

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> tuple[int, torch.Tensor]:
        with Image.open(self.root / self.records[index]["image"]) as image:
            return index, torch.from_numpy(preprocess(image))


def load_backbone() -> torch.nn.Module:
    model = AutoModel.from_pretrained(BACKBONE)
    model.eval()
    return model


@torch.inference_mode()
def embed_batch(model: torch.nn.Module, pixels: torch.Tensor) -> torch.Tensor:
    hidden = model(pixel_values=pixels).last_hidden_state
    return torch.cat([hidden[:, 0], hidden[:, 1:].mean(dim=1)], dim=1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, help="Procesa como mucho N imágenes nuevas (para probar)")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1))
    arguments = parser.parse_args()

    root = data_dir()
    manifest = root / "manifest.jsonl"
    if not manifest.exists():
        raise SystemExit("No hay manifest.jsonl; ejecuta antes python -m vesta_ml.prepare merge")
    cache = EmbeddingCache(cache_dir(root))
    cache.check_config()
    known = cache.known_ids()
    pending = [record for record in read_jsonl(manifest) if record["id"] not in known]
    if arguments.limit:
        pending = pending[: arguments.limit]
    print(f"Caché: {cache.directory} ({len(known)} ya calculadas, {len(pending)} pendientes)")
    if not pending:
        return

    torch.set_num_threads(max(1, (os.cpu_count() or 2) // 2))
    model = load_backbone()
    loader = DataLoader(ImageDataset(root, pending), batch_size=arguments.batch_size, num_workers=arguments.workers)
    ids: list[str] = []
    rows: list[np.ndarray] = []
    done = 0
    started = time.monotonic()
    for indices, pixels in loader:
        rows.append(embed_batch(model, pixels).numpy())
        ids.extend(pending[index]["id"] for index in indices.tolist())
        done += len(indices)
        if len(ids) >= SHARD_SIZE:
            cache.write_shard(ids, np.concatenate(rows))
            ids, rows = [], []
        rate = done / (time.monotonic() - started)
        print(f"\r  {done}/{len(pending)} imágenes, {rate:.1f}/s, quedan ~{(len(pending) - done) / rate / 60:.0f} min",
              end="", file=sys.stderr)
    if ids:
        cache.write_shard(ids, np.concatenate(rows))
    print(f"\nListo: {done} embeddings nuevos en {(time.monotonic() - started) / 60:.1f} min")


if __name__ == "__main__":
    main()
