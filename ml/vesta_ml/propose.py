"""Propuestas automáticas de subcategoría para revisar: python -m vesta_ml.propose [--categories footwear top].

Un modelo de imagen y texto (SigLIP 2, Apache-2.0) puntúa cada imagen sin subcategoría contra las subcategorías de
su categoría. Las propuestas no se usan para entrenar hasta que alguien las revisa con vesta_ml.review.
Reanudable: solo procesa imágenes sin propuesta.

Con --relabel se revisan imágenes que ya tienen etiqueta y la decisión la sustituye, categoría incluida:
  python -m vesta_ml.propose --relabel sandalias --source open-images --categories footwear
  python -m vesta_ml.propose --relabel tunica --categories top one-piece outerwear
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import torch
from PIL import Image
from torch.utils.data import DataLoader, Dataset

from .common import data_dir, read_jsonl
from .reviews import load_decisions, proposals_path
from .taxonomy import load_taxonomy

ZERO_SHOT_MODEL = "google/siglip2-base-patch16-224"  # Apache-2.0
TEMPLATES = ("a photo of {}.", "a product photo of {}.", "a photo of a person wearing {}.")
# English descriptions per subcategory; several phrasings are averaged.
PROMPTS = {
    "camiseta": ["a short-sleeve t-shirt"],
    "camiseta-manga-larga": ["a long-sleeve t-shirt"],
    "camiseta-tirantes": ["a tank top", "a sleeveless top"],
    "polo": ["a polo shirt"],
    "camisa": ["a button-up shirt", "a dress shirt"],
    "blusa": ["a blouse", "a women's blouse"],
    "top": ["a crop top", "a fitted women's top"],
    "jersey": ["a knitted sweater", "a wool jumper"],
    "sudadera": ["a crewneck sweatshirt without a hood", "a quarter-zip sweatshirt"],
    "sudadera-capucha": ["a hoodie", "a hooded sweatshirt"],
    "prenda-deportiva": ["a sports jersey", "an athletic training top"],
    "pantalon": ["long trousers", "chino pants"],
    "vaqueros": ["blue jeans", "denim jeans"],
    "pantalon-corto": ["shorts", "bermuda shorts"],
    "pantalon-chandal": ["sweatpants", "jogger pants"],
    "leggings": ["leggings"],
    "falda": ["a skirt"],
    "medias": ["tights", "pantyhose"],
    "vestido": ["a dress"],
    "mono": ["a jumpsuit", "overalls"],
    "chaqueta": ["a casual jacket", "a bomber jacket", "an overshirt"],
    "blazer": ["a blazer", "a suit jacket"],
    "abrigo": ["a long coat", "a trench coat"],
    "plumifero": ["a puffer jacket", "a down jacket"],
    "chubasquero": ["a raincoat", "a rain jacket"],
    "cardigan": ["a cardigan"],
    "chaleco": ["a vest", "a gilet"],
    "zapatillas": ["sneakers", "trainers"],
    "zapatos": ["leather shoes", "loafers", "flat shoes"],
    "botas": ["boots", "ankle boots"],
    "sandalias": ["strappy sandals", "sandals with straps"],
    "chanclas": ["flip-flops", "pool slides", "slide sandals"],
    "zuecos": ["clogs", "crocs"],
    "tacones": ["high heels", "high-heeled shoes"],
    "gorro": ["a hat", "a cap", "a beanie"],
    "bolso": ["a handbag", "a backpack"],
    "cinturon": ["a belt"],
    "bufanda": ["a scarf"],
    "gafas": ["glasses", "sunglasses"],
    "corbata": ["a necktie", "a bow tie"],
    "reloj": ["a wristwatch"],
}
DEFAULT_CATEGORIES = ("footwear", "top", "bottom", "outerwear")
RELABEL = "relabel"


class ImageDataset(Dataset):
    def __init__(self, root: Path, records: list[dict], processor):
        self.root, self.records, self.processor = root, records, processor

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int):
        with Image.open(self.root / self.records[index]["image"]) as image:
            pixels = self.processor(images=image.convert("RGB"), return_tensors="pt")["pixel_values"][0]
        return index, pixels


def candidate_values(category: str) -> list[str]:
    taxonomy = load_taxonomy()
    return [value for value, entry in taxonomy.subcategories.items() if entry["category"] == category]


def as_tensor(features) -> torch.Tensor:
    """Recent transformers return a model output instead of a tensor from get_*_features."""
    return features if isinstance(features, torch.Tensor) else features.pooler_output


@torch.inference_mode()
def text_embeddings(model, tokenizer, values: list[str]) -> torch.Tensor:
    rows = []
    for value in values:
        texts = [template.format(prompt) for prompt in PROMPTS[value] for template in TEMPLATES]
        tokens = tokenizer(texts, padding="max_length", max_length=64, return_tensors="pt")
        embedded = torch.nn.functional.normalize(as_tensor(model.get_text_features(**tokens)), dim=-1).mean(dim=0)
        rows.append(torch.nn.functional.normalize(embedded, dim=0))
    return torch.stack(rows)


def keep_proposals(path: Path, decisions: dict, refresh: tuple | list) -> list[dict]:
    """Rewrites the proposals file without unreviewed ones in `refresh` categories and without a cut-off last line."""
    if not path.exists():
        return []
    kept = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            proposal = json.loads(line)
        except json.JSONDecodeError:
            continue  # An interrupted run can leave a partial line.
        if proposal["category"] in refresh and proposal["id"] not in decisions:
            continue
        kept.append(proposal)
    path.write_text("".join(json.dumps(proposal, ensure_ascii=False) + "\n" for proposal in kept), encoding="utf-8")
    return kept


def main() -> None:
    from transformers import AutoImageProcessor, AutoModel, AutoTokenizer

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--categories", nargs="+", default=list(DEFAULT_CATEGORIES))
    parser.add_argument("--limit", type=int)
    parser.add_argument("--refresh", action="store_true",
                        help="Recalcula las propuestas sin revisar de esas categorías (p. ej. tras cambiar la taxonomía)")
    parser.add_argument("--relabel", metavar="SUBCATEGORIA",
                        help="Vuelve a proponer las imágenes que ya tienen esa subcategoría (o la tenían antes de "
                             "retirarla de la taxonomía) entre las subcategorías de --categories")
    parser.add_argument("--source", help="Con --relabel, solo las imágenes de esta fuente")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1))
    arguments = parser.parse_args()

    root = data_dir()
    output = proposals_path(root)
    decisions = load_decisions()
    kept = keep_proposals(output, decisions, arguments.categories if arguments.refresh else ())
    done = {proposal["id"] for proposal in kept} | set(decisions)
    records = [record for record in read_jsonl(root / "manifest.jsonl") if record["id"] not in done]
    if arguments.relabel:
        pending = [record for record in records
                   if arguments.relabel in (record["labels"]["subcategory"],
                                            record["meta"].get("removedLabels", {}).get("subcategory"))
                   and (not arguments.source or record["source"] == arguments.source)]
        print(f"{len(pending)} imágenes con {arguments.relabel} sin propuesta, a elegir entre {', '.join(arguments.categories)}")
    else:
        pending = [record for record in records
                   if record["labels"]["subcategory"] is None and record["labels"]["category"] in arguments.categories]
        print(f"{len(pending)} imágenes sin subcategoría ni propuesta en {', '.join(arguments.categories)}")
    if arguments.limit:
        pending = pending[: arguments.limit]
    if not pending:
        return

    torch.set_num_threads(max(1, (os.cpu_count() or 2) // 2))
    model = AutoModel.from_pretrained(ZERO_SHOT_MODEL).eval()
    tokenizer = AutoTokenizer.from_pretrained(ZERO_SHOT_MODEL)
    processor = AutoImageProcessor.from_pretrained(ZERO_SHOT_MODEL)
    # Normal proposals choose within the image's category; relabel proposals among all the given categories.
    values = {category: candidate_values(category) for category in arguments.categories}
    if arguments.relabel:
        values = {RELABEL: [value for category in arguments.categories for value in values[category]]}
    texts = {key: text_embeddings(model, tokenizer, choices) for key, choices in values.items()}
    scale = model.logit_scale.exp().item()
    taxonomy = load_taxonomy()

    loader = DataLoader(ImageDataset(root, pending, processor), batch_size=arguments.batch_size, num_workers=arguments.workers)
    output.parent.mkdir(parents=True, exist_ok=True)
    started, count = time.monotonic(), 0
    with output.open("a", encoding="utf-8") as lines:
        for indices, pixels in loader:
            with torch.inference_mode():
                images = torch.nn.functional.normalize(as_tensor(model.get_image_features(pixel_values=pixels)), dim=-1)
            for row, index in enumerate(indices.tolist()):
                record = pending[index]
                key = RELABEL if arguments.relabel else record["labels"]["category"]
                probabilities = (scale * images[row] @ texts[key].T).softmax(dim=0).tolist()
                ranked = sorted(zip(values[key], probabilities), key=lambda pair: -pair[1])
                proposal = {
                    "id": record["id"], "image": record["image"], "source": record["source"],
                    "category": taxonomy.category_of(ranked[0][0]),
                    "candidates": [{"value": value, "p": round(p, 4)} for value, p in ranked],
                }
                if arguments.relabel:
                    proposal["relabel"] = True
                lines.write(json.dumps(proposal, ensure_ascii=False) + "\n")
            lines.flush()
            count += len(indices)
            rate = count / (time.monotonic() - started)
            print(f"\r  {count}/{len(pending)}, {rate:.1f}/s, quedan ~{(len(pending) - count) / rate / 60:.0f} min",
                  end="", file=sys.stderr)
    print(f"\nPropuestas en {output}. Revísalas con: python -m vesta_ml.review")


if __name__ == "__main__":
    main()
