import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image

from vesta_ml.common import assign_split
from vesta_ml.sources import clothing_dataset, fashionpedia, vesta_export
from vesta_ml.taxonomy import load_source_mappings, load_taxonomy


class TaxonomyTest(unittest.TestCase):
    def setUp(self):
        self.taxonomy = load_taxonomy()

    def test_longest_phrase_wins(self):
        self.assertEqual(self.taxonomy.match("subcategory", "Camiseta de tirantes"), "camiseta-tirantes")
        self.assertEqual(self.taxonomy.match("subcategory", "Sudadera con capucha gris"), "sudadera-capucha")
        self.assertEqual(self.taxonomy.match("subcategory", "Pantalón corto"), "pantalon-corto")
        self.assertEqual(self.taxonomy.match("colors", "Azul marino"), "azul-marino")

    def test_ignores_accents_and_case(self):
        self.assertEqual(self.taxonomy.match("subcategory", "CÁRDIGAN"), "cardigan")
        self.assertEqual(self.taxonomy.match("seasons", "otoño"), "otono")
        self.assertIsNone(self.taxonomy.match("subcategory", "algo raro"))

    def test_wargon_labels_from_existing_garments_still_map(self):
        self.assertEqual(self.taxonomy.match("subcategory", "Chaqueta de invierno"), "plumifero")
        self.assertEqual(self.taxonomy.match("subcategory", "Jersey"), "jersey")
        self.assertEqual(self.taxonomy.category_of("jersey"), "top")

    def test_every_source_mapping_uses_known_ids(self):
        mappings = load_source_mappings()
        candidates = [*mappings["clothing-dataset"]["labels"].values(), *mappings["fashionpedia"]["categories"].values()]
        candidates += [{"subcategory": value} for value in mappings["fashionpedia"]["nicknames"].values()]
        candidates += [{"pattern": value} for value in mappings["fashionpedia"]["patterns"].values()]
        candidates += [{"sleeve": value} for value in mappings["fashionpedia"]["sleeveLengths"].values()]
        for labels in candidates:
            with self.subTest(labels=labels):
                self.taxonomy.validate_labels(labels)

    def test_validate_rejects_inconsistent_category(self):
        with self.assertRaises(ValueError):
            self.taxonomy.validate_labels({"category": "bottom", "subcategory": "jersey"})


class SplitTest(unittest.TestCase):
    def test_split_is_deterministic_and_respects_ratios(self):
        self.assertEqual(assign_split("vesta:abc", (0.5, 0, 0.5)), assign_split("vesta:abc", (0.5, 0, 0.5)))
        splits = [assign_split(f"group-{index}", (0.8, 0.1, 0.1)) for index in range(2000)]
        self.assertAlmostEqual(splits.count("train") / len(splits), 0.8, delta=0.04)
        self.assertNotIn("val", {assign_split(f"g{index}", (0.5, 0.0, 0.5)) for index in range(200)})


class ClothingDatasetTest(unittest.TestCase):
    def test_maps_labels_and_ignores_unusable_rows(self):
        self.assertEqual(clothing_dataset.labels_for({"label": "Longsleeve"}),
                         {"category": "top", "subcategory": "camiseta-manga-larga", "sleeve": "larga"})
        self.assertIsNone(clothing_dataset.labels_for({"label": "Not sure"}))


def fashionpedia_fixture(license_id=0):
    return {
        "categories": [{"id": 0, "name": "top, t-shirt, sweatshirt"}, {"id": 1, "name": "sleeve"}, {"id": 2, "name": "shoe"}, {"id": 3, "name": "neckline"}],
        "attributes": [
            {"id": 0, "name": "classic (t-shirt)"}, {"id": 1, "name": "stripe"},
            {"id": 2, "name": "short (length)"}, {"id": 3, "name": "wrist-length"}, {"id": 4, "name": "sleeveless"},
        ],
        "licenses": [
            {"id": 0, "name": "Attribution License", "url": "https://creativecommons.org/licenses/by/2.0/"},
            {"id": 4, "name": "Attribution-NonCommercial-NoDerivatives License", "url": ""},
        ],
        "images": [{"id": 10, "width": 600, "height": 800, "file_name": "a.jpg", "license": license_id, "original_url": "http://example/a.jpg"}],
        "annotations": [
            {"id": 1, "image_id": 10, "category_id": 0, "attribute_ids": [0, 1, 2], "bbox": [100, 100, 300, 300]},
            {"id": 2, "image_id": 10, "category_id": 1, "attribute_ids": [3], "bbox": [120, 150, 60, 200]},
            {"id": 3, "image_id": 10, "category_id": 2, "attribute_ids": [], "bbox": [200, 700, 40, 40]},
            {"id": 4, "image_id": 10, "category_id": 3, "attribute_ids": [], "bbox": [200, 100, 100, 100]},
        ],
    }


class FashionpediaTest(unittest.TestCase):
    def test_labels_crop_with_nickname_pattern_and_sleeve_part(self):
        [crop] = fashionpedia.garment_records(fashionpedia_fixture())
        # "short (length)" on the garment is its length, not its sleeves; the sleeve part says wrist-length.
        self.assertEqual(crop["labels"], {"category": "top", "subcategory": "camiseta", "pattern": "rayas", "sleeve": "larga"})
        self.assertEqual(crop["group"], "fashionpedia:10")
        self.assertEqual(crop["box"], (76, 76, 424, 424))

    def test_skips_small_objects_and_parts(self):
        crops = fashionpedia.garment_records(fashionpedia_fixture())
        self.assertEqual([crop["meta"]["fashionpediaCategory"] for crop in crops], ["top, t-shirt, sweatshirt"])

    def test_drops_photos_without_commercial_license(self):
        self.assertEqual(fashionpedia.garment_records(fashionpedia_fixture(license_id=4)), [])

    def test_sleeveless_garment_attribute(self):
        fixture = fashionpedia_fixture()
        fixture["annotations"][0]["attribute_ids"] = [4]
        [crop] = fashionpedia.garment_records(fixture)
        self.assertEqual(crop["labels"]["sleeve"], "sin-mangas")


class VestaExportTest(unittest.TestCase):
    def test_imports_app_export(self):
        image = io.BytesIO()
        Image.new("RGB", (40, 30), "navy").save(image, "PNG")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "export.zip"
            labels = {"category": "top", "subcategory": "jersey", "sleeve": None, "pattern": "liso",
                      "formality": "casual", "seasons": ["otono", "invierno"], "colors": ["azul-marino"]}
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("export.json", json.dumps({"format": "vesta-training-export", "taxonomyVersion": 1}))
                bundle.writestr("labels.jsonl", json.dumps({
                    "garmentId": "g1", "images": ["images/g1-0.png"], "labels": labels,
                    "review": {"subcategory": "corrected"}, "raw": {"subcategory": "Jersey"},
                }) + "\n")
                bundle.writestr("images/g1-0.png", image.getvalue())
            manifest = vesta_export.prepare(root, archive)
            [record] = [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(record["labels"], labels)
            self.assertEqual(record["group"], "vesta:g1")
            self.assertTrue((root / record["image"]).exists())


if __name__ == "__main__":
    unittest.main()
