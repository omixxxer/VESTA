"""Dataset multi-cabeza a partir de manifiestos JSONL. Las cabezas sin etiqueta valen IGNORE_INDEX."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import torch
from PIL import Image
from torch.utils.data import Dataset
from torchvision import transforms

from common import IGNORE_INDEX, IMAGENET_MEAN, IMAGENET_STD, Taxonomy


def build_transforms(image_size: int, train: bool):
    # Redimensionado directo (sin recorte central) para no perder bordes de la prenda.
    # La app debe aplicar EXACTAMENTE lo mismo: resize a image_size x image_size + normalización ImageNet.
    if train:
        return transforms.Compose([
            transforms.RandomResizedCrop((image_size, image_size), scale=(0.7, 1.0), ratio=(0.75, 1.33)),
            transforms.RandomHorizontalFlip(),
            transforms.ColorJitter(brightness=0.25, contrast=0.25, saturation=0.25, hue=0.03),
            transforms.RandomRotation(8, fill=(255, 255, 255)),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ])
    return transforms.Compose([
        transforms.Resize((image_size, image_size)),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])


def read_manifests(paths: list[Path]) -> list[dict]:
    rows: list[dict] = []
    for path in paths:
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    row = json.loads(line)
                    row["_root"] = str(path.parent)
                    rows.append(row)
    return rows


class GarmentDataset(Dataset):
    def __init__(self, rows: list[dict], taxonomy: Taxonomy, heads: list[str], image_size: int, train: bool):
        self.rows = rows
        self.taxonomy = taxonomy
        self.heads = heads
        self.transform = build_transforms(image_size, train)

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int):
        row = self.rows[index]
        with Image.open(Path(row["_root"]) / row["image"]) as image:
            tensor = self.transform(image.convert("RGB"))
        targets = torch.full((len(self.heads),), IGNORE_INDEX, dtype=torch.long)
        for position, head in enumerate(self.heads):
            value = row["labels"].get(head)
            if value is not None:
                targets[position] = self.taxonomy.index(head, value)
        return tensor, targets


def label_counts(rows: list[dict], taxonomy: Taxonomy, heads: list[str]) -> dict[str, list[int]]:
    counts = {head: [0] * len(taxonomy.values[head]) for head in heads}
    for row in rows:
        for head in heads:
            value = row["labels"].get(head)
            if value is not None:
                counts[head][taxonomy.index(head, value)] += 1
    return counts


def usable_heads(rows: list[dict], taxonomy: Taxonomy, min_per_class: int = 20, min_classes: int = 2) -> list[str]:
    """Cabezas con al menos `min_classes` clases con >= `min_per_class` ejemplos."""
    counts = label_counts(rows, taxonomy, taxonomy.heads)
    return [
        head for head in taxonomy.heads
        if sum(1 for n in counts[head] if n >= min_per_class) >= min_classes
    ]


def describe(rows: list[dict]) -> Counter:
    return Counter(row.get("source", "?") for row in rows)
