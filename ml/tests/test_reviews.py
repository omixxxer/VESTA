import tempfile
import unittest
from pathlib import Path

from vesta_ml.reviews import append_decisions, apply_decisions, load_decisions
from vesta_ml.taxonomy import LABEL_HEADS


def record(record_id, **labels):
    return {"id": record_id, "labels": {**{head: None for head in LABEL_HEADS}, **labels}, "meta": {}}


class ReviewsTest(unittest.TestCase):
    def test_last_decision_wins_and_invalid_ones_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "decisions.jsonl"
            append_decisions([{"id": "a", "status": "unknown", "subcategory": None}], path)
            append_decisions([{"id": "a", "status": "labeled", "subcategory": "botas"}], path)
            self.assertEqual(load_decisions(path)["a"]["subcategory"], "botas")
            for invalid in ({"id": "b", "status": "labeled", "subcategory": None},
                            {"id": "b", "status": "unknown", "subcategory": "botas"},
                            {"id": "b", "status": "labeled", "subcategory": "kimono"},
                            {"id": "b", "status": "quizas", "subcategory": None}):
                with self.assertRaises(ValueError):
                    append_decisions([invalid], path)

    def test_apply_fills_drops_and_never_overrides_source_labels(self):
        records = [record("shoe", category="footwear"), record("bad", category="footwear"),
                   record("tee", category="top", subcategory="camiseta"), record("wrong", category="top")]
        decisions = {
            "shoe": {"status": "labeled", "subcategory": "botas"},
            "bad": {"status": "rejected", "subcategory": None},
            "tee": {"status": "labeled", "subcategory": "polo"},
            "wrong": {"status": "labeled", "subcategory": "botas"},  # another category: ignored
        }
        output = {item["id"]: item for item in apply_decisions(records, decisions)}
        self.assertNotIn("bad", output)
        self.assertEqual(output["shoe"]["labels"]["subcategory"], "botas")
        self.assertEqual(output["shoe"]["meta"]["subcategorySource"], "review")
        self.assertEqual(output["tee"]["labels"]["subcategory"], "camiseta")
        self.assertIsNone(output["wrong"]["labels"]["subcategory"])

    def test_relabel_decisions_replace_source_labels(self):
        records = [record("heel", category="footwear", subcategory="sandalias"),
                   record("odd", category="footwear", subcategory="sandalias"),
                   record("tunic", category="top", sleeve="larga"),
                   record("skirt", category="bottom", subcategory="pantalon", fit="ancho")]
        decisions = {
            "heel": {"status": "labeled", "subcategory": "tacones", "relabel": True},
            "odd": {"status": "unknown", "subcategory": None, "relabel": True},
            "tunic": {"status": "labeled", "subcategory": "vestido", "relabel": True},
            "skirt": {"status": "labeled", "subcategory": "falda", "relabel": True},
        }
        output = {item["id"]: item["labels"] for item in apply_decisions(records, decisions)}
        self.assertEqual(output["heel"]["subcategory"], "tacones")
        self.assertIsNone(output["odd"]["subcategory"])
        self.assertEqual(output["odd"]["category"], "footwear")
        self.assertEqual((output["tunic"]["category"], output["tunic"]["subcategory"], output["tunic"]["sleeve"]),
                         ("one-piece", "vestido", "larga"))
        self.assertIsNone(output["skirt"]["fit"])  # a skirt has no trouser fit


if __name__ == "__main__":
    unittest.main()
