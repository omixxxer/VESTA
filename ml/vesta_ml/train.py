"""Entrena las cabezas sobre embeddings: python -m vesta_ml.train [--name NOMBRE].

Lee manifest.jsonl y la caché de vesta_ml.embed. Guarda pesos, metadatos y métricas en models/<nombre>/.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from .common import data_dir, read_jsonl
from .embed import cache_dir
from .features import FEATURE_DIM, PREPROCESSING, EmbeddingCache
from .targets import MISSING, HeadSpec, apply_rules, class_weights, encode, evaluate, head_specs
from .taxonomy import LABEL_HEADS, load_taxonomy

SPLITS = ("train", "val", "test")


class MultiHead(nn.Module):
    """Standardise → shared hidden layer → one linear output per head."""

    def __init__(self, specs: list[HeadSpec], mean: np.ndarray, std: np.ndarray, hidden: int, dropout: float):
        super().__init__()
        self.register_buffer("mean", torch.from_numpy(mean))
        self.register_buffer("std", torch.from_numpy(std))
        self.shared = nn.Sequential(nn.Dropout(dropout / 2), nn.Linear(FEATURE_DIM, hidden), nn.GELU(), nn.Dropout(dropout))
        self.heads = nn.ModuleDict({spec.name: nn.Linear(hidden, len(spec.values)) for spec in specs})

    def forward(self, features: torch.Tensor) -> dict[str, torch.Tensor]:
        shared = self.shared((features - self.mean) / self.std)
        return {name: head(shared) for name, head in self.heads.items()}


def head_loss(spec: HeadSpec, logits: torch.Tensor, targets: torch.Tensor, weights: torch.Tensor | None,
              smoothing: float) -> torch.Tensor | None:
    """Mean loss over the labelled rows of the batch; None when the batch has none."""
    if spec.multi_label:
        mask = targets[:, 0] != MISSING
        if not mask.any():
            return None
        return F.binary_cross_entropy_with_logits(logits[mask], targets[mask])
    if not (targets != MISSING).any():
        return None
    return F.cross_entropy(logits, targets, weight=weights, ignore_index=MISSING, label_smoothing=smoothing)


def predict(model: MultiHead, features: torch.Tensor) -> dict[str, np.ndarray]:
    model.eval()
    with torch.inference_mode():
        outputs = [model(batch) for batch in features.split(4096)]
    return {name: torch.cat([output[name] for output in outputs]).numpy() for name in model.heads}


def score(specs: list[HeadSpec], targets: dict[str, np.ndarray], outputs: dict[str, np.ndarray]) -> tuple[float, dict]:
    """Mean macro-F1 over heads that have labels in this split, after the category consistency rules."""
    logits, active = apply_rules(specs, outputs, load_taxonomy())
    report = {spec.name: evaluate(spec, targets[spec.name], logits[spec.name], active[spec.name]) for spec in specs}
    values = [entry["macroF1"] for entry in report.values() if entry]
    return (float(np.mean(values)) if values else 0.0), report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default=time.strftime("heads-%Y%m%d-%H%M%S"))
    parser.add_argument("--min-examples", type=int, default=20, help="Valores con menos ejemplos de train se descartan")
    parser.add_argument("--hidden", type=int, default=512)
    parser.add_argument("--dropout", type=float, default=0.3)
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=0.05)
    parser.add_argument("--smoothing", type=float, default=0.05)
    parser.add_argument("--seed", type=int, default=0)
    arguments = parser.parse_args()

    torch.manual_seed(arguments.seed)
    generator = torch.Generator().manual_seed(arguments.seed)
    root = data_dir()
    taxonomy = load_taxonomy()
    records = list(read_jsonl(root / "manifest.jsonl"))
    cache = EmbeddingCache(cache_dir(root))
    cache.check_config()
    features = cache.load([record["id"] for record in records])

    by_split = {split: [index for index, record in enumerate(records) if record["split"] == split] for split in SPLITS}
    split_records = {split: [records[index] for index in indices] for split, indices in by_split.items()}
    split_features = {split: torch.from_numpy(features[indices]) for split, indices in by_split.items()}
    specs = head_specs(taxonomy, split_records["train"], arguments.min_examples)
    targets = {split: {spec.name: encode(split_records[split], spec) for spec in specs} for split in SPLITS}
    skipped = [head for head in LABEL_HEADS if head not in {spec.name for spec in specs}]
    print(f"{len(records)} imágenes; cabezas: {', '.join(spec.name for spec in specs)}"
          + (f"; sin datos suficientes: {', '.join(skipped)}" if skipped else ""))
    for spec in specs:
        if spec.dropped:
            print(f"  {spec.name}: descartados por pocos ejemplos: {', '.join(spec.dropped)}")

    train_features = split_features["train"]
    mean = train_features.mean(dim=0).numpy()
    std = train_features.std(dim=0).clamp_min(1e-6).numpy()
    model = MultiHead(specs, mean, std, arguments.hidden, arguments.dropout)
    weights = {spec.name: None if spec.multi_label else torch.from_numpy(class_weights(targets["train"][spec.name], len(spec.values)))
               for spec in specs}
    train_targets = {name: torch.from_numpy(values) for name, values in targets["train"].items()}
    optimizer = torch.optim.AdamW(model.parameters(), lr=arguments.lr, weight_decay=arguments.weight_decay)
    steps_per_epoch = math.ceil(len(train_features) / arguments.batch_size)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=arguments.lr, epochs=arguments.epochs,
                                                    steps_per_epoch=steps_per_epoch)

    best_score, best_epoch, best_state = -1.0, 0, None
    for epoch in range(1, arguments.epochs + 1):
        model.train()
        total = 0.0
        for batch in torch.randperm(len(train_features), generator=generator).split(arguments.batch_size):
            outputs = model(train_features[batch])
            losses = [head_loss(spec, outputs[spec.name], train_targets[spec.name][batch], weights[spec.name], arguments.smoothing)
                      for spec in specs]
            loss = sum(item for item in losses if item is not None)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            scheduler.step()
            total += loss.item()
        val_score, _ = score(specs, targets["val"], predict(model, split_features["val"]))
        improved = val_score > best_score
        if improved:
            best_score, best_epoch = val_score, epoch
            best_state = {key: value.clone() for key, value in model.state_dict().items()}
        print(f"época {epoch:3d}  pérdida {total / steps_per_epoch:.4f}  val macro-F1 {val_score:.4f}{'  *' if improved else ''}")
        if epoch - best_epoch >= arguments.patience:
            break

    model.load_state_dict(best_state)
    metrics = {}
    for split in ("val", "test"):
        outputs = predict(model, split_features[split])
        overall, report = score(specs, targets[split], outputs)
        by_source = {}
        for source in sorted({record["source"] for record in split_records[split]}):
            rows = np.array([record["source"] == source for record in split_records[split]])
            _, source_report = score(specs, {name: values[rows] for name, values in targets[split].items()},
                                     {name: values[rows] for name, values in outputs.items()})
            by_source[source] = {head: {key: entry[key] for key in ("n", "accuracy", "macroF1")}
                                 for head, entry in source_report.items() if entry}
        metrics[split] = {"meanMacroF1": round(overall, 4), "heads": report, "bySource": by_source}

    output = root / "models" / arguments.name
    output.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), output / "heads.pt")
    metadata = {
        "format": "vesta-heads",
        "taxonomyVersion": taxonomy.version,
        "preprocessing": PREPROCESSING,
        "heads": [{"name": spec.name, "multiLabel": spec.multi_label, "values": spec.values, "dropped": spec.dropped}
                  for spec in specs],
        "untrainedHeads": skipped,
        # Applied after the model (see targets.apply_rules); the app must do the same.
        "rules": {"subcategoryWithinCategory": True, "attributesApplyTo": {
            head: {key: attribute[key] for key in ("appliesTo", "appliesToSubcategories") if key in attribute}
            for head, attribute in taxonomy.attributes.items() if "appliesTo" in attribute}},
        "training": {**vars(arguments), "bestEpoch": best_epoch, "examples": {split: len(by_split[split]) for split in SPLITS}},
    }
    (output / "heads.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    (output / "metrics.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\nMejor época {best_epoch}. Modelo en {output}")
    for split in ("val", "test"):
        print(f"\n[{split}] media macro-F1 {metrics[split]['meanMacroF1']:.4f}")
        for head, entry in metrics[split]["heads"].items():
            if not entry:
                continue
            weakest = sorted(((value, item["f1"]) for value, item in entry["perClass"].items() if item["support"]),
                             key=lambda pair: pair[1])[:3]
            print(f"  {head:12s} n={entry['n']:5d}  acc {entry['accuracy']:.3f}  macro-F1 {entry['macroF1']:.3f}"
                  f"  peores: {', '.join(f'{value} {f1:.2f}' for value, f1 in weakest)}")
        for source, heads in metrics[split]["bySource"].items():
            summary = ", ".join(f"{head} {entry['accuracy']:.3f}" for head, entry in heads.items())
            print(f"  · {source}: acc {summary}")


if __name__ == "__main__":
    main()
