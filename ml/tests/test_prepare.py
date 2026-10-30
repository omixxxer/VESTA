import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image

from vesta_ml.common import assign_split
from vesta_ml.sources import clothing_dataset, fashionpedia, open_images, photo_folders, vesta_export
from vesta_ml.taxonomy import LABEL_HEADS, load_source_mappings, load_taxonomy


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

    def test_matches_plurals_and_new_synonyms(self):
        self.assertEqual(self.taxonomy.match("colors", "Azules"), "azul")
        self.assertEqual(self.taxonomy.match("colors", "grises"), "gris")
        self.assertEqual(self.taxonomy.match("subcategory", "Pantalones cortos"), "pantalon-corto")
        self.assertEqual(self.taxonomy.match("subcategory", "Zuecos"), "zuecos")
        self.assertEqual(self.taxonomy.match("subcategory", "Chanclas de piscina"), "chanclas")
        self.assertEqual(self.taxonomy.match("subcategory", "Quarter zip"), "sudadera")

    def test_relabel_rematches_raw_text_without_dropping_app_labels(self):
        labels = {"category": "footwear", "subcategory": None, "sleeve": None, "pattern": None, "formality": "casual",
                  "seasons": None, "colors": None}
        raw = {"category": "Calzado", "subcategory": "Zuecos", "colors": ["Azules", "raro"], "seasons": [], "formality": "Casual"}
        relabeled = vesta_export.relabel(labels, raw, self.taxonomy)
        self.assertEqual(relabeled["subcategory"], "zuecos")
        self.assertEqual(relabeled["colors"], ["azul"])
        self.assertEqual(relabeled["formality"], ["diario"])
        newer = vesta_export.relabel({**labels, "formality": ["diario", "arreglado"]},
                                     {**raw, "dressLevels": ["Diario", "Arreglado"]}, self.taxonomy)
        self.assertEqual(newer["formality"], ["diario", "arreglado"])
        self.assertIsNone(relabeled["seasons"])

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
        candidates += [{"fit": value} for value in [*mappings["fashionpedia"]["fits"].values(),
                                                    *mappings["fashionpedia"]["fitPriority"]]]
        candidates += [{"subcategory": value} for value in mappings["open-images"]["classes"].values()]
        for labels in candidates:
            with self.subTest(labels=labels):
                self.taxonomy.validate_labels(labels)

    def test_fit_applies_to_trousers_only(self):
        self.assertTrue(self.taxonomy.applies("fit", "bottom", "vaqueros"))
        self.assertTrue(self.taxonomy.applies("fit", "bottom", None))
        self.assertFalse(self.taxonomy.applies("fit", "bottom", "falda"))
        self.assertFalse(self.taxonomy.applies("fit", "top", None))
        self.assertTrue(self.taxonomy.applies("pattern", "footwear", "botas"))
        self.assertEqual(self.taxonomy.match("fit", "Vaqueros baggy"), "ancho")

    def test_validate_rejects_inconsistent_category(self):
        with self.assertRaises(ValueError):
            self.taxonomy.validate_labels({"category": "bottom", "subcategory": "jersey"})


class MergeTest(unittest.TestCase):
    def test_values_removed_from_the_taxonomy_become_unknown(self):
        from vesta_ml.prepare import drop_removed_values

        records = [{"labels": {**{head: None for head in LABEL_HEADS}, "category": "top", "subcategory": "tunica",
                               "colors": ["azul", "fucsia-viejo"]}}]
        removed = drop_removed_values(records, load_taxonomy())
        self.assertEqual(records[0]["labels"]["subcategory"], None)
        self.assertEqual(records[0]["labels"]["category"], "top")
        self.assertEqual(records[0]["labels"]["colors"], ["azul"])
        self.assertEqual(dict(removed), {"tunica": 1, "fucsia-viejo": 1})
        self.assertEqual(records[0]["meta"]["removedLabels"], {"subcategory": "tunica", "colors": ["fucsia-viejo"]})


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

    def test_trouser_fit_prefers_the_leg_shape(self):
        mapping = load_source_mappings()["fashionpedia"]
        self.assertEqual(fashionpedia.fit_from("pants", ["regular (fit)", "bootcut", "jeans"], mapping), "campana")
        self.assertEqual(fashionpedia.fit_from("pants", ["tight (fit)", "straight"], mapping), "ajustado")
        self.assertEqual(fashionpedia.fit_from("pants", ["baggy"], mapping), "ancho")
        self.assertIsNone(fashionpedia.fit_from("pants", ["peg"], mapping))
        self.assertIsNone(fashionpedia.fit_from("skirt", ["tight (fit)"], mapping))


def open_images_box(image_id, label="/m/watch", x_min=0.1, y_min=0.1, size=0.3, group="0", depiction="0"):
    return {"ImageID": image_id, "LabelName": label, "XMin": str(x_min), "YMin": str(y_min), "XMax": str(x_min + size),
            "YMax": str(y_min + size), "IsGroupOf": group, "IsDepiction": depiction}


def open_images_image(image_id, license_url="https://creativecommons.org/licenses/by/2.0/", rotation="0.0"):
    return {"ImageID": image_id, "Subset": "train", "License": license_url, "Rotation": rotation, "Author": "Autor",
            "OriginalLandingURL": f"https://flickr.com/{image_id}"}


class OpenImagesTest(unittest.TestCase):
    LICENSES = {"https://creativecommons.org/licenses/by/2.0/"}

    def test_keeps_only_cc_by_photos_without_rotation(self):
        self.assertTrue(open_images.usable_image(open_images_image("a"), self.LICENSES))
        self.assertFalse(open_images.usable_image(open_images_image("a", "https://creativecommons.org/licenses/by-nc/2.0/"), self.LICENSES))
        self.assertFalse(open_images.usable_image(open_images_image("a", rotation="90.0"), self.LICENSES))

    def test_selects_usable_boxes_with_a_cap_per_subcategory_and_per_image(self):
        boxes = [open_images_box("a", x_min=0.0), open_images_box("a", x_min=0.3), open_images_box("a", x_min=0.6),
                 open_images_box("b", size=0.01), open_images_box("c", group="1"), open_images_box("d", depiction="1"),
                 open_images_box("e"), open_images_box("e", size=0.2),  # same corner: same crop id, kept once
                 open_images_box("f", label="/m/other"), open_images_box("unlicensed")]
        images = {image_id: open_images_image(image_id) for image_id in "abcdef"}
        crops = open_images.select_crops(boxes, images, {"/m/watch": "reloj"}, max_per_subcategory=10)
        self.assertEqual(sorted(crop["image_id"] for crop in crops), ["a", "a", "e"])
        self.assertEqual({crop["group"] for crop in crops}, {"open-images:a", "open-images:e"})
        self.assertEqual(len({crop["id"] for crop in crops}), 3)
        self.assertEqual(len(open_images.select_crops(boxes, images, {"/m/watch": "reloj"}, max_per_subcategory=1)), 1)

    def test_pixel_box_adds_padding_inside_the_image(self):
        self.assertEqual(open_images.pixel_box((0.0, 0.5, 0.5, 1.0), 1000, 800), (0, 360, 550, 800))


class PhotoFoldersTest(unittest.TestCase):
    def test_reads_author_and_id_from_download_names(self):
        self.assertEqual(photo_folders.photo_origin("jane-doe-AbC_dEf-123-unsplash"), ("unsplash", "AbC_dEf-123", "jane doe"))
        self.assertEqual(photo_folders.photo_origin("pexels-juan-perez-1234567 (1)"), ("pexels", "1234567", "juan perez"))
        self.assertEqual(photo_folders.photo_origin("pexels-photo-1234567"), ("pexels", "1234567", ""))
        self.assertIsNone(photo_folders.photo_origin("images (3)"))
        self.assertIsNone(photo_folders.photo_origin("02893309712-e2"))

    def test_scan_labels_by_folder_and_rejects_other_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in ("Chanclas/ana-lopez-AbCdEfGhIjK-unsplash.jpg", "Chanclas/images (3).jfif",
                             "Zuecos/verdes/pexels-ana-111111.jpg", "Zuecos/verdes/pexels-ana-222222.jpg",
                             "Varios/pexels-ana-333333.jpg", "Zuecos/pexels-ana-111111 (1).jpg"):
                (root / relative).parent.mkdir(parents=True, exist_ok=True)
                Image.new("RGB", (8, 8)).save(root / relative, "JPEG")
            Image.new("RGB", (8, 8), "red").save(root / "Zuecos/verdes/pexels-ana-222222 (2).jpg", "JPEG")
            photos, rejected = photo_folders.scan(root, load_taxonomy())
            self.assertEqual([(photo["photo_id"], photo["crop"], photo["labels"]["subcategory"], photo["group"])
                              for photo in photos], [
                ("AbCdEfGhIjK", 1, "chanclas", "photo-folders:unsplash:AbCdEfGhIjK"),
                ("111111", 1, "zuecos", "photo-folders:pexels:111111"),  # the identical copy in verdes/ is a repeat
                ("222222", 1, "zuecos", "photo-folders:pexels:222222"),  # subfolders only organize
                ("222222", 2, "zuecos", "photo-folders:pexels:222222"),  # another crop of the same photo
            ])
            self.assertEqual(len(rejected), 3)


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
            # A v1 export has no fit head, and its single formality becomes a list of dress levels.
            self.assertEqual(record["labels"], {**labels, "fit": None, "formality": ["diario"]})
            self.assertEqual(record["group"], "vesta:g1")
            self.assertTrue((root / record["image"]).exists())


if __name__ == "__main__":
    unittest.main()
