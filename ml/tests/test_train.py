import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from vesta_ml import features
from vesta_ml.features import EmbeddingCache, letterbox, preprocess
from vesta_ml.targets import MISSING, class_weights, encode, evaluate, head_specs
from vesta_ml.taxonomy import LABEL_HEADS, load_taxonomy

try:
    import torch
except ImportError:
    torch = None


def record(**labels):
    return {"labels": {**{head: None for head in LABEL_HEADS}, **labels}}


class PreprocessingTest(unittest.TestCase):
    def test_letterbox_keeps_whole_image_and_pads_with_mean(self):
        image = Image.new("RGB", (400, 100), (255, 0, 0))
        boxed = letterbox(image)
        self.assertEqual(boxed.size, (224, 224))
        self.assertEqual(boxed.getpixel((0, 0)), features.PAD_COLOR)
        self.assertEqual(boxed.getpixel((0, 112)), (255, 0, 0))
        array = preprocess(image)
        self.assertEqual(array.shape, (3, 224, 224))
        self.assertAlmostEqual(float(array[:, 0, 0].max()), 0.0, delta=0.01)

    def test_cache_roundtrip_and_missing_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = EmbeddingCache(Path(directory) / "cache")
            cache.check_config()
            rows = np.arange(2 * features.FEATURE_DIM, dtype=np.float32).reshape(2, -1) / 1000
            cache.write_shard(["a", "b"], rows)
            self.assertEqual(cache.known_ids(), {"a", "b"})
            np.testing.assert_allclose(cache.load(["b", "a"]), rows[::-1], atol=1e-3)
            with self.assertRaises(SystemExit):
                cache.load(["a", "c"])


class TargetsTest(unittest.TestCase):
    def setUp(self):
        self.taxonomy = load_taxonomy()
        self.train = [record(category="top", pattern="liso")] * 3 + [record(category="bottom", pattern="rayas")] * 3 \
            + [record(category="footwear", seasons=["verano"])]

    def test_specs_drop_rare_values_and_unlabeled_heads(self):
        specs = {spec.name: spec for spec in head_specs(self.taxonomy, self.train, min_examples=2)}
        self.assertEqual(specs["category"].values, ["top", "bottom"])
        self.assertEqual(specs["category"].dropped, ["footwear"])
        self.assertNotIn("seasons", specs)  # only one example
        self.assertNotIn("formality", specs)

    def test_encoding_marks_unknown_and_dropped_values_as_missing(self):
        spec = {spec.name: spec for spec in head_specs(self.taxonomy, self.train, 2)}["category"]
        encoded = encode([record(category="bottom"), record(), record(category="footwear")], spec)
        self.assertEqual(encoded.tolist(), [1, MISSING, MISSING])

    def test_multi_label_encoding(self):
        spec = head_specs(self.taxonomy, [record(seasons=["verano", "invierno"])] * 2, 2)[0]
        self.assertEqual(spec.name, "seasons")
        encoded = encode([record(seasons=["invierno"]), record(), record(seasons=["otono"])], spec)
        self.assertEqual(encoded[0].tolist(), [0.0, 1.0])
        self.assertTrue((encoded[1:] == MISSING).all())

    def test_class_weights_favour_rare_classes(self):
        weights = class_weights(np.array([0, 0, 0, 0, 1, MISSING]), 3)
        self.assertGreater(weights[1], weights[0])
        self.assertEqual(weights[2], 0)
        self.assertAlmostEqual(float(weights[:2].mean()), 1.0, places=5)

    def test_evaluate_reports_macro_f1_over_present_classes(self):
        spec = {spec.name: spec for spec in head_specs(self.taxonomy, self.train, 2)}["category"]
        targets = np.array([0, 0, 1, MISSING])
        logits = np.array([[2, 0], [0, 2], [0, 2], [2, 0]], dtype=np.float32)
        result = evaluate(spec, targets, logits)
        self.assertEqual(result["n"], 3)
        self.assertAlmostEqual(result["accuracy"], 2 / 3, places=3)
        self.assertEqual(result["topConfusions"][0], {"true": "top", "predicted": "bottom", "count": 1})


@unittest.skipUnless(torch, "torch no instalado")
class LossTest(unittest.TestCase):
    def test_loss_ignores_unlabeled_rows(self):
        from vesta_ml.targets import HeadSpec
        from vesta_ml.train import head_loss

        single = HeadSpec("category", False, ["top", "bottom"], [])
        logits = torch.tensor([[5.0, -5.0], [-5.0, 5.0]])
        self.assertIsNone(head_loss(single, logits, torch.tensor([MISSING, MISSING]), None, 0.0))
        only_first = head_loss(single, logits, torch.tensor([0, MISSING]), None, 0.0)
        self.assertLess(float(only_first), 1e-3)
        multi = HeadSpec("seasons", True, ["verano", "invierno"], [])
        targets = torch.tensor([[1.0, 0.0], [MISSING, MISSING]])
        self.assertLess(float(head_loss(multi, logits, targets, None, 0.0)), 1e-2)


if __name__ == "__main__":
    unittest.main()
