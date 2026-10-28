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
| 2. Embeddings y entrenamiento de cabezas | Pendiente |
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

## Exportación desde la app

En **Armario → Exportar datos de entrenamiento** se descarga un ZIP generado en el navegador con `export.json`, `labels.jsonl` (una línea por prenda) e `images/`. Incluye solo etiquetas normalizadas, el texto original de esas etiquetas y cómo se obtuvo cada una (`corrected`, `accepted-suggestion` o `manual`); no incluye nombre, marca, talla ni notas.

## Pruebas

```sh
cd ml
python -m unittest discover -s tests -t .
```
