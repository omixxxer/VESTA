# Modelo propio de VESTA

Objetivo: sustituir Wargon por un clasificador propio que use la taxonomía de la app (incluidos calzado y accesorios) y que además prediga atributos útiles para el generador de outfits. Todo con datos y pesos que permitan uso comercial.

## Diseño

- **Backbone:** DINOv2 ViT-S/14 (Apache-2.0) congelado. Los embeddings se calculan una vez y se reutilizan, lo que permite entrenar en CPU.
- **Cabezas:** `category`, `subcategory`, `sleeve`, `pattern`, `formality`, `seasons` (multietiqueta) y `colors` (multietiqueta). Cada imagen entrena solo las cabezas que tiene etiquetadas (pérdida enmascarada); `null` significa «desconocido», no «ninguno».
- **Exportación:** un único ONNX (backbone + cabezas) cuantizado int8 para Transformers.js/ONNX Runtime Web.

## Estado

| Fase | Estado |
|---|---|
| 1. Taxonomía, preparación de datos y exportación desde la app | Hecha |
| 2. Embeddings y entrenamiento de cabezas | Hecha |
| 3. Evaluación por clase sobre fotos propias | Pendiente |
| 4. ONNX, cuantización e integración en `clothingAnalyzer.ts` | Pendiente |

## Taxonomía

[`taxonomy.json`](taxonomy.json) es la fuente única. La usan la app ([`src/ml/taxonomy.ts`](../src/ml/taxonomy.ts)) y Python ([`vesta_ml/taxonomy.py`](vesta_ml/taxonomy.py)). El texto libre se normaliza (minúsculas, sin acentos) y gana la frase más larga que coincida: «Sudadera con capucha gris» → `sudadera-capucha`. Si cambias ids o valores, sube `version`: las exportaciones de la app guardan la versión y el importador rechaza las que no coinciden.

Cambios frente a Wargon: jersey y sudaderas son `top` (rol `Top`), no capa; se añaden calzado y accesorios; «Chaqueta de invierno» pasa a `plumifero`.

## Fuentes de datos

| Fuente | Licencia | Aporta | Notas |
|---|---|---|---|
| [Clothing Dataset](https://github.com/alexeygrigorev/clothing-dataset) | CC0 | categoría, subcategoría, manga (camisetas) | Prendas sueltas fotografiadas en casa, cerca del uso real. `Pants`, `Outwear`, `Shoes` y `Undershirt` solo dan categoría. |
| [Fashionpedia](https://fashionpedia.github.io/home/) | Anotaciones CC BY 4.0; cada foto tiene su propia licencia | categoría, subcategoría, estampado, manga | Prendas recortadas de fotos de personas. **Solo se usan fotos CC BY, dominio público, Unsplash, Pexels, Freestocks y Burst** (`commercialLicenseIds` en [`source_mappings.json`](source_mappings.json)); en la validación son ~22 % de las fotos. CC BY-SA es opcional con `--include-share-alike`. Las NC, ND y sin licencia se descartan. Cita: Jia et al., ECCV 2020. |
| Fotos propias (exportadas desde la app) | Del usuario | todas las cabezas excepto manga | La mitad de las prendas se reserva para test. |

Las licencias CC BY exigen atribución: cada registro guarda la URL original y la licencia en `manifest.jsonl`. Revisa las condiciones de cada fuente antes de un uso comercial; esto no es asesoramiento legal.

Formalidad, temporadas y color solo tienen etiquetas de las fotos propias. La formalidad vale `Casual` por defecto en el formulario, así que puede no reflejar una decisión real (la exportación la marca como `manual`).

## Preparación de datos

Requisitos: Python 3.10+ y Pillow. Los datos se guardan en `%LOCALAPPDATA%\vesta-ml` (Windows) o `~/.local/share/vesta-ml`, o donde indique `VESTA_ML_DATA`, **fuera del repositorio y fuera de OneDrive**.

```sh
cd ml
python -m pip install -r requirements.txt
python -m vesta_ml.prepare clothing-dataset
python -m vesta_ml.prepare fashionpedia --split val
python -m vesta_ml.prepare vesta-export ruta/vesta-dataset-AAAA-MM-DD.zip
python -m vesta_ml.prepare merge
```

- `fashionpedia --split train` descarga ~3,9 GB y necesita varios GB de RAM para leer las anotaciones.
- `merge` une las fuentes en `manifest.jsonl`, asigna `train`/`val`/`test` por grupo (todas las fotos de una prenda, de un remitente o los recortes de una misma foto van al mismo split) y muestra la cobertura por cabeza.

Cada línea de `manifest.jsonl`:

```json
{"id": "fashionpedia:13297:0", "source": "fashionpedia", "image": "sources/fashionpedia-val/images/13297-0.jpg",
 "group": "fashionpedia:13297", "split": "train", "license": {"name": "…", "url": "…"}, "attribution": "http://…",
 "labels": {"category": "top", "subcategory": "camiseta", "sleeve": "corta", "pattern": "rayas",
            "formality": null, "seasons": null, "colors": null}, "meta": {}}
```

Las imágenes se guardan como JPEG RGB de 512 px como máximo.

## Entrenamiento

Requisitos: un entorno con torch para CPU, recomendado fuera de OneDrive.

```sh
python -m venv %LOCALAPPDATA%\vesta-ml\venv
%LOCALAPPDATA%\vesta-ml\venv\Scripts\activate
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r requirements-train.txt
python -m vesta_ml.embed     # embeddings DINOv2; reanudable
python -m vesta_ml.train     # cabezas; guarda en models/<nombre>/
```

- **Preprocesado** ([`features.py`](vesta_ml/features.py)): la imagen entera se encaja en 224×224 sin recortar (letterbox bilineal, relleno con el color medio de ImageNet) y se normaliza con la media y desviación de ImageNet. La app tendrá que replicarlo igual.
- **Embedding:** token CLS + media de los tokens de parche de la última capa (768 valores). Se guarda en float16 en `embeddings/dinov2-small-224/`; solo se calculan las imágenes nuevas.
- **Cabezas** ([`train.py`](vesta_ml/train.py)): estandarización, una capa oculta compartida de 512 y una salida lineal por cabeza. Entropía cruzada con pesos por clase (frecuencia inversa suavizada) y pérdida enmascarada. Se detiene por la media de macro-F1 en val.
- Los valores con menos de `--min-examples` (20) ejemplos de train se descartan y sus etiquetas cuentan como desconocidas. Las cabezas sin datos (de momento formalidad, temporadas y color) no se entrenan. Ambos casos quedan en `heads.json`.
- `metrics.json` guarda, para val y test, exactitud, macro-F1, precisión/recall/F1 por clase, confusiones más frecuentes y el desglose por fuente. La fuente `clothing-dataset` (y en el futuro `vesta`) es la más parecida al uso real.

## Exportación desde la app

En **Armario → Exportar datos de entrenamiento** se descarga un ZIP generado en el navegador con `export.json`, `labels.jsonl` (una línea por prenda) e `images/`. Incluye solo etiquetas normalizadas, el texto original de esas etiquetas y cómo se obtuvo cada una (`corrected`, `accepted-suggestion` o `manual`); no incluye nombre, marca, talla ni notas.

## Pruebas

```sh
cd ml
python -m unittest discover -s tests -t .
```
