"""Backbone ligero (timm) + una cabeza lineal por atributo."""
from __future__ import annotations

import timm
import torch
from torch import nn


class MultiHeadClassifier(nn.Module):
    def __init__(self, backbone: str, head_sizes: dict[str, int], pretrained: bool = True, dropout: float = 0.2):
        super().__init__()
        self.backbone_name = backbone
        self.backbone = timm.create_model(backbone, pretrained=pretrained, num_classes=0)
        # No usar backbone.num_features: en MobileNetV3 y similares no coincide con la salida real
        # (hay una conv_head tras el pooling). Medimos la dimensión con una pasada de prueba.
        was_training = self.backbone.training
        self.backbone.eval()
        with torch.no_grad():
            features = self.backbone(torch.zeros(1, 3, 64, 64)).shape[-1]
        self.backbone.train(was_training)
        self.head_names = list(head_sizes.keys())
        self.dropout = nn.Dropout(dropout)
        self.heads = nn.ModuleDict({name: nn.Linear(features, size) for name, size in head_sizes.items()})

    def forward(self, pixel_values: torch.Tensor) -> tuple[torch.Tensor, ...]:
        features = self.dropout(self.backbone(pixel_values))
        return tuple(self.heads[name](features) for name in self.head_names)


def masked_multihead_loss(
    outputs: tuple[torch.Tensor, ...],
    targets: torch.Tensor,
    weights: list[torch.Tensor | None],
    head_weights: list[float],
    label_smoothing: float = 0.05,
) -> torch.Tensor:
    """Suma ponderada de entropías cruzadas; ignora las posiciones sin etiqueta (-1)."""
    total = outputs[0].new_zeros(())
    for position, logits in enumerate(outputs):
        target = targets[:, position]
        if not (target >= 0).any():
            continue
        loss = nn.functional.cross_entropy(
            logits, target, weight=weights[position], ignore_index=-1, label_smoothing=label_smoothing,
        )
        total = total + head_weights[position] * loss
    return total
