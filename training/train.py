"""Ajuste fino multi-cabeza. Funciona en CPU, CUDA o Apple MPS.

Ejemplo (GPU):
    python train.py --manifests data/prepared/manifest_train.jsonl data/prepared/manifest_train_myntra.jsonl \
        --val-manifests data/prepared/manifest_val.jsonl data/prepared/manifest_val_myntra.jsonl \
        --backbone mobilenetv3_large_100 --epochs 15 --batch-size 64 --out runs/vesta-v1

Humo en CPU con datos sintéticos: ver smoke_test.py
"""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import torch
from torch.utils.data import DataLoader, WeightedRandomSampler

from common import Taxonomy
from dataset import GarmentDataset, label_counts, read_manifests, usable_heads
from model import MultiHeadClassifier, masked_multihead_loss


def pick_device(requested: str) -> torch.device:
    if requested != "auto":
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


@torch.no_grad()
def evaluate(model, loader, device, heads) -> dict[str, dict[str, float]]:
    model.eval()
    correct = [0] * len(heads)
    total = [0] * len(heads)
    per_class_hits: list[dict[int, list[int]]] = [{} for _ in heads]
    for images, targets in loader:
        images, targets = images.to(device), targets.to(device)
        outputs = model(images)
        for position, logits in enumerate(outputs):
            target = targets[:, position]
            mask = target >= 0
            if not mask.any():
                continue
            predictions = logits.argmax(dim=1)
            hits = (predictions[mask] == target[mask])
            correct[position] += int(hits.sum())
            total[position] += int(mask.sum())
            for cls, hit in zip(target[mask].tolist(), hits.tolist()):
                stats = per_class_hits[position].setdefault(cls, [0, 0])
                stats[0] += int(hit)
                stats[1] += 1
    report: dict[str, dict[str, float]] = {}
    for position, head in enumerate(heads):
        if not total[position]:
            continue
        recalls = [h / n for h, n in per_class_hits[position].values() if n]
        report[head] = {
            "accuracy": correct[position] / total[position],
            "balanced_accuracy": sum(recalls) / len(recalls),
            "samples": total[position],
        }
    return report


def class_weights(counts: list[int], device) -> torch.Tensor | None:
    total = sum(counts)
    if not total:
        return None
    # Peso inverso a la raíz de la frecuencia: corrige desbalance sin disparar el ruido de clases raras.
    weights = [math.sqrt(total / max(1, n)) / len(counts) ** 0.5 if n else 0.0 for n in counts]
    mean = sum(w for w in weights if w) / max(1, sum(1 for w in weights if w))
    return torch.tensor([w / mean if w else 0.0 for w in weights], dtype=torch.float32, device=device)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifests", nargs="+", required=True, type=Path)
    parser.add_argument("--val-manifests", nargs="+", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--backbone", default="mobilenetv3_large_100")
    parser.add_argument("--no-pretrained", action="store_true", help="Solo para pruebas sin red.")
    parser.add_argument("--image-size", type=int, default=224)
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1e-3, help="LR de las cabezas; el backbone usa lr/10.")
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--min-per-class", type=int, default=20)
    parser.add_argument("--balance-subtype", action="store_true", help="Muestreo equilibrado por subtipo.")
    parser.add_argument("--taxonomy", type=Path, default=None)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--max-train", type=int, default=0, help="Limita muestras de entrenamiento (depuración).")
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    device = pick_device(args.device)
    taxonomy = Taxonomy.load(args.taxonomy)

    train_rows = read_manifests(args.manifests)
    val_rows = read_manifests(args.val_manifests)
    if args.max_train:
        train_rows = train_rows[: args.max_train]
    heads = usable_heads(train_rows, taxonomy, min_per_class=args.min_per_class)
    if "subtype" not in heads:
        raise SystemExit("No hay suficientes ejemplos de 'subtype'. Revisa los manifiestos.")
    print(f"Dispositivo: {device} | train={len(train_rows)} val={len(val_rows)} | cabezas: {heads}")

    counts = label_counts(train_rows, taxonomy, heads)
    sizes = {head: len(taxonomy.values[head]) for head in heads}
    model = MultiHeadClassifier(args.backbone, sizes, pretrained=not args.no_pretrained).to(device)
    weights = [class_weights(counts[head], device) for head in heads]
    head_weights = [1.5 if head == "subtype" else 1.0 for head in heads]

    train_set = GarmentDataset(train_rows, taxonomy, heads, args.image_size, train=True)
    val_set = GarmentDataset(val_rows, taxonomy, heads, args.image_size, train=False)
    sampler = None
    if args.balance_subtype:
        subtype_counts = counts["subtype"]
        sample_weights = [
            1.0 / max(1, subtype_counts[taxonomy.index("subtype", row["labels"]["subtype"])]) ** 0.5
            for row in train_rows
        ]
        sampler = WeightedRandomSampler(sample_weights, num_samples=len(train_rows), replacement=True)
    pin = device.type == "cuda"
    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=sampler is None, sampler=sampler,
                              num_workers=args.workers, pin_memory=pin, drop_last=len(train_set) > args.batch_size)
    val_loader = DataLoader(val_set, batch_size=args.batch_size, shuffle=False, num_workers=args.workers, pin_memory=pin)

    optimizer = torch.optim.AdamW([
        {"params": model.backbone.parameters(), "lr": args.lr / 10},
        {"params": list(model.heads.parameters()), "lr": args.lr},
    ], weight_decay=args.weight_decay)
    steps = max(1, args.epochs * len(train_loader))
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=[args.lr / 10, args.lr], total_steps=steps, pct_start=0.15,
    )
    use_amp = device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)

    args.out.mkdir(parents=True, exist_ok=True)
    best_score = -1.0
    history: list[dict] = []
    for epoch in range(1, args.epochs + 1):
        model.train()
        started = time.time()
        running = 0.0
        for images, targets in train_loader:
            images, targets = images.to(device), targets.to(device)
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device.type, enabled=use_amp):
                outputs = model(images)
                loss = masked_multihead_loss(outputs, targets, weights, head_weights)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            scheduler.step()
            running += loss.item()
        report = evaluate(model, val_loader, device, heads)
        score = sum(r["balanced_accuracy"] for r in report.values()) / max(1, len(report))
        summary = {h: round(r["balanced_accuracy"], 3) for h, r in report.items()}
        print(f"[{epoch:02d}/{args.epochs}] loss={running / max(1, len(train_loader)):.4f} "
              f"bal_acc_media={score:.3f} {summary} ({time.time() - started:.0f}s)")
        history.append({"epoch": epoch, "loss": running / max(1, len(train_loader)), "score": score, "report": report})
        if score > best_score:
            best_score = score
            torch.save({
                "state_dict": model.state_dict(),
                "backbone": args.backbone,
                "heads": heads,
                "head_sizes": sizes,
                "image_size": args.image_size,
                "taxonomy_version": taxonomy.version,
                "val_report": report,
            }, args.out / "best.pt")

    (args.out / "history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
    print(f"Mejor puntuación de validación: {best_score:.3f} -> {args.out / 'best.pt'}")


if __name__ == "__main__":
    main()
