"""Página local para revisar propuestas: python -m vesta_ml.review [--port 8765], y abre http://127.0.0.1:8765.

Cada página muestra imágenes con la misma subcategoría propuesta; corriges las que estén mal y guardas el resto
como correctas. Las decisiones se añaden a ml/reviews/decisions.jsonl.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import time
from collections import Counter
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .common import data_dir, read_jsonl
from .reviews import append_decisions, load_decisions, proposals_path
from .taxonomy import load_taxonomy

PAGE = Path(__file__).with_name("review.html")


class ReviewState:
    def __init__(self, root: Path):
        self.root = root
        self.sources = (root / "sources").resolve()
        self.path = proposals_path(root)
        self.mtime = 0.0
        self.proposals: dict[str, dict] = {}
        self.decisions = load_decisions()
        # Groups for subcategories with the fewest labelled images come first: they gain the most from review.
        self.existing = Counter(record["labels"]["subcategory"] for record in read_jsonl(root / "manifest.jsonl"))

    def refresh(self) -> None:
        """Proposals may still be generated while reviewing; reload when the file changes."""
        if self.path.exists() and self.path.stat().st_mtime != self.mtime:
            self.mtime = self.path.stat().st_mtime
            self.proposals = {proposal["id"]: proposal for proposal in read_jsonl(self.path)}

    def pending(self) -> list[dict]:
        """Undecided proposals, plus those newer than their decision (vesta_ml.disagree re-proposes reviewed images)."""
        self.refresh()
        return [proposal for proposal in self.proposals.values()
                if proposal["id"] not in self.decisions or proposal.get("at", "") > self.decisions[proposal["id"]]["at"]]

    def summary(self) -> dict:
        taxonomy = load_taxonomy()
        groups = Counter((proposal["category"], proposal["candidates"][0]["value"]) for proposal in self.pending())
        statuses = Counter(decision["status"] for decision in self.decisions.values())
        return {
            "groups": [{"category": category, "categoryLabel": taxonomy.categories[category]["label"], "value": value,
                        "label": taxonomy.subcategories[value]["label"], "pending": count,
                        "existing": self.existing[value]}
                       for (category, value), count in sorted(groups.items(), key=lambda item: (self.existing[item[0][1]], -item[1]))],
            "pending": sum(groups.values()),
            "reviewed": dict(statuses),
            "labeledBySubcategory": dict(Counter(decision["subcategory"] for decision in self.decisions.values()
                                                 if decision["status"] == "labeled")),
        }

    def items(self, category: str, value: str, limit: int) -> list[dict]:
        taxonomy = load_taxonomy()
        matching = [proposal for proposal in self.pending()
                    if proposal["category"] == category and proposal["candidates"][0]["value"] == value]
        matching.sort(key=lambda proposal: -proposal["candidates"][0]["p"])
        return [{
            "id": proposal["id"],
            "image": "/image?path=" + proposal["image"],
            "source": proposal["source"] + (f" · {proposal['model']} propone otra etiqueta" if "model" in proposal else ""),
            "candidates": [{"value": candidate["value"], "label": taxonomy.subcategories[candidate["value"]]["label"],
                            "p": candidate["p"]} for candidate in proposal["candidates"]],
        } for proposal in matching[:limit]]

    def decide(self, decisions: list[dict]) -> int:
        now = time.strftime("%Y-%m-%dT%H:%M:%S")
        clean = [{"id": decision["id"], "status": decision["status"], "subcategory": decision.get("subcategory"), "at": now,
                  **({"relabel": True} if self.proposals[decision["id"]].get("relabel") else {})}
                 for decision in decisions if decision["id"] in self.proposals]
        append_decisions(clean)
        self.decisions.update({decision["id"]: decision for decision in clean})
        return len(clean)

    def image(self, relative: str) -> Path | None:
        path = (self.root / relative).resolve()
        return path if path.is_relative_to(self.sources) and path.is_file() else None


def handler_for(state: ReviewState):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args) -> None:
            pass

        def send(self, body: bytes, content_type: str, status: HTTPStatus = HTTPStatus.OK) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def send_json(self, data, status: HTTPStatus = HTTPStatus.OK) -> None:
            self.send(json.dumps(data, ensure_ascii=False).encode(), "application/json; charset=utf-8", status)

        def do_GET(self) -> None:
            url = urlparse(self.path)
            query = {key: values[0] for key, values in parse_qs(url.query).items()}
            if url.path == "/":
                self.send(PAGE.read_bytes(), "text/html; charset=utf-8")
            elif url.path == "/api/summary":
                self.send_json(state.summary())
            elif url.path == "/api/items":
                self.send_json(state.items(query.get("category", ""), query.get("value", ""), int(query.get("limit", 24))))
            elif url.path == "/image" and (path := state.image(query.get("path", ""))):
                self.send(path.read_bytes(), mimetypes.guess_type(path.name)[0] or "image/jpeg")
            else:
                self.send_json({"error": "no encontrado"}, HTTPStatus.NOT_FOUND)

        def do_POST(self) -> None:
            if urlparse(self.path).path != "/api/decisions":
                self.send_json({"error": "no encontrado"}, HTTPStatus.NOT_FOUND)
                return
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                self.send_json({"saved": state.decide(body)})
            except (ValueError, KeyError) as error:
                self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    arguments = parser.parse_args()
    state = ReviewState(data_dir())
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), handler_for(state))
    print(f"Revisión en http://127.0.0.1:{arguments.port} (Ctrl+C para salir)", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
