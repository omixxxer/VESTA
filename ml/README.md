# Modelo propio de VESTA

Objetivo: sustituir Wargon por un clasificador propio que use la taxonomía de la app (incluidos calzado y accesorios) y que además prediga atributos útiles para el generador de outfits. Todo con datos y pesos que permitan uso comercial.

## Diseño

- **Backbone:** DINOv2 ViT-S/14 (Apache-2.0) congelado. Los embeddings se calculan una vez y se reutilizan, lo que permite entrenar en CPU.
- **Cabezas:** `category`, `subcategory`, `sleeve`, `fit` (corte del pantalón), `pattern`, `formality`, `seasons` (multietiqueta) y `colors` (multietiqueta). Cada imagen entrena solo las cabezas que tiene etiquetadas (pérdida enmascarada); `null` significa «desconocido», no «ninguno».
- **Exportación:** un único ONNX (backbone + cabezas) cuantizado int8 para ONNX Runtime Web.

## Estado

| Fase | Estado |
|---|---|
| 1. Taxonomía, preparación de datos y exportación desde la app | Hecha |
| 2. Embeddings y entrenamiento de cabezas | Hecha |
| 3. Evaluación por clase sobre fotos propias | Hecha (heads-v4; pocas fotos propias todavía) |
| 4. ONNX, cuantización e integración en `clothingAnalyzer.ts` | Hecha (heads-v4, sustituye a Wargon) |

### Por hacer más adelante

- **Corte del pantalón (`fit`):** en heads-v4 recto (F1 0,71) y ajustado (0,65) funcionan, ancho va justo (0,50) y campana no se aprende (0,00; solo 67 ejemplos, todos de Fashionpedia). Para mejorarlo: que `photo-folders` lea el corte de una subcarpeta (`VAQUEROS/CAMPANA/`, `PANTALON/ANCHO/`) y descargar ~100-150 fotos de Pexels/Unsplash de campana y de ancho.
- **Fotos propias:** formalidad, temporadas y color solo tienen 29 fotos; hacen falta más exportaciones desde la app.

## Taxonomía

[`taxonomy.json`](taxonomy.json) es la fuente única. La usan la app ([`src/ml/taxonomy.ts`](../src/ml/taxonomy.ts)) y Python ([`vesta_ml/taxonomy.py`](vesta_ml/taxonomy.py)). El texto libre se normaliza (minúsculas, sin acentos) y gana la frase más larga que coincida: «Sudadera con capucha gris» → `sudadera-capucha`. Cada palabra admite su plural («Azules» → `azul`). Al importar una exportación se vuelve a interpretar el texto original con la taxonomía actual, así que los sinónimos nuevos se aprovechan sin reexportar. Si cambias ids o valores, sube `version`: las exportaciones guardan la versión; el importador acepta las de versiones anteriores (las reinterpreta) y rechaza las más nuevas que `ml/`. La v2 añade `chanclas` y `zuecos` al calzado; la v3 quita `tunica`; la v4 añade el atributo `fit` (corte: ajustado, recto, ancho, campana), solo para pantalones, vaqueros, chándal y leggings. `merge` deja como desconocidas las etiquetas de valores retirados, así que no hace falta volver a preparar las fuentes.

Cambios frente a Wargon: jersey y sudaderas son `top` (rol `Top`), no capa; se añaden calzado y accesorios; «Chaqueta de invierno» pasa a `plumifero`.

## Fuentes de datos

| Fuente | Licencia | Aporta | Notas |
|---|---|---|---|
| [Clothing Dataset](https://github.com/alexeygrigorev/clothing-dataset) | CC0 | categoría, subcategoría, manga (camisetas) | Prendas sueltas fotografiadas en casa, cerca del uso real. `Pants`, `Outwear`, `Shoes` y `Undershirt` solo dan categoría. |
| [Fashionpedia](https://fashionpedia.github.io/home/) | Anotaciones CC BY 4.0; cada foto tiene su propia licencia | categoría, subcategoría, estampado, manga, corte de pantalón | Prendas recortadas de fotos de personas. **Solo se usan fotos CC BY, dominio público, Unsplash, Pexels, Freestocks y Burst** (`commercialLicenseIds` en [`source_mappings.json`](source_mappings.json)); en la validación son ~22 % de las fotos. CC BY-SA es opcional con `--include-share-alike`. Las NC, ND y sin licencia se descartan. Cita: Jia et al., ECCV 2020. |
| [Open Images V7](https://storage.googleapis.com/openimages/web/index.html) | Cajas CC BY 4.0; fotos de Flickr, solo **CC BY 2.0** | subcategoría (reloj, corbata, gafas, sandalias, botas, bufanda, cinturón) | Recortes de objetos de fotos reales. Las clases y el máximo por subcategoría están en [`source_mappings.json`](source_mappings.json). Algunas clases son amplias (Watch incluye relojes de bolsillo). |
| Unsplash y Pexels (descargadas a mano) | Unsplash License / Pexels License | categoría y subcategoría (por carpeta) | Para las subcategorías que no cubre ninguna otra fuente. Solo se aceptan archivos con el nombre de descarga de esas webs, del que salen autor y URL. |
| Fotos propias (exportadas desde la app) | Del usuario | todas las cabezas excepto manga | La mitad de las prendas se reserva para test. |

Las licencias CC BY exigen atribución: cada registro guarda la URL original y la licencia en `manifest.jsonl`. Revisa las condiciones de cada fuente antes de un uso comercial; esto no es asesoramiento legal.

El corte sale de las siluetas de Fashionpedia (`fits` en [`source_mappings.json`](source_mappings.json)); si un pantalón tiene varias, gana la forma de la pierna (campana, ancho) sobre el ajuste genérico, y «peg» (tapered) no se usa. Formalidad, temporadas y color solo tienen etiquetas de las fotos propias. La formalidad vale `Casual` por defecto en el formulario, así que puede no reflejar una decisión real (la exportación la marca como `manual`).

## Preparación de datos

Requisitos: Python 3.10+ y Pillow. Los datos se guardan en `%LOCALAPPDATA%\vesta-ml` (Windows) o `~/.local/share/vesta-ml`, o donde indique `VESTA_ML_DATA`, **fuera del repositorio y fuera de OneDrive**.

```sh
cd ml
python -m pip install -r requirements.txt
python -m vesta_ml.prepare clothing-dataset
python -m vesta_ml.prepare fashionpedia --split val
python -m vesta_ml.prepare open-images
python -m vesta_ml.prepare photo-folders ruta/carpetas-unsplash-pexels
python -m vesta_ml.prepare vesta-export ruta/vesta-dataset-AAAA-MM-DD.zip
python -m vesta_ml.prepare merge
```

- `fashionpedia --split train` descarga ~3,9 GB y necesita varios GB de RAM para leer las anotaciones.
- `open-images` lee ~3 GB de CSV en streaming (solo guarda las filas de las clases elegidas) y descarga solo las fotos necesarias para unos miles de recortes; es reanudable.
- `photo-folders` usa el nombre de cada carpeta como etiqueta (`chanclas/`, `Calzado/zuecos/`; vale en plural o un sinónimo) y rechaza los archivos que no tengan el nombre de descarga de Unsplash (`autor-<id>-unsplash.jpg`) o Pexels (`pexels-autor-<número>.jpg`). Las subcarpetas (`zuecos/verdes/`) solo sirven para organizar: cada foto se reparte por separado entre train, val y test. Se pueden guardar varios recortes de una misma foto conservando el nombre de descarga con otro sufijo (`pexels-autor-123456 (2).jpg`): van al mismo split, y solo se descartan las copias idénticas. Cada ejecución sustituye a la anterior: pasa siempre la carpeta raíz completa.
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
- **Reglas de coherencia** (`targets.apply_rules`, también en `heads.json` → `rules`): la subcategoría se elige solo entre las de la categoría predicha y queda vacía si esa categoría no tiene subcategorías entrenadas (hoy, calzado); cada atributo solo se muestra donde aplica (`appliesTo` por categoría y, si existe, `appliesToSubcategories`; p. ej. el corte no se muestra en faldas ni pantalones cortos). Las métricas se calculan ya con estas reglas y la app debe aplicarlas igual.
- `python -m vesta_ml.evaluate <modelo> [--source vesta] [--split test] [--details]` evalúa un modelo guardado; por defecto, sobre todas tus fotos (un modelo entrenado antes de importarlas no las ha visto) y con `--details` muestra la predicción de cada foto.
- `python -m vesta_ml.evaluate <modelo> --folder <ruta>` prueba el modelo con una carpeta de imágenes etiquetadas por el nombre de sus carpetas (`botas/`, `Calzado/zuecos/`; vale el nombre en español, en plural o un sinónimo). Sirve para imágenes **sin licencia para entrenar**, como las de Google Imágenes o webs de marcas: no se copian, no se cachean y nunca entran en el manifiesto. Muestra las métricas y la lista de fotos falladas.
- `metrics.json` guarda, para val y test, exactitud, macro-F1, precisión/recall/F1 por clase, confusiones más frecuentes y el desglose por fuente. La fuente `clothing-dataset` (y en el futuro `vesta`) es la más parecida al uso real.

## Exportación a la app

```sh
python -m vesta_ml.calibrate heads-v4   # temperaturas por cabeza en validación
python -m vesta_ml.export heads-v4      # escribe public/models/vesta/
```

- [`export.py`](vesta_ml/export.py) exporta backbone y cabezas como un único ONNX (entrada: imagen ya preprocesada, 1×3×224×224; una salida de logits por cabeza entrenada), lo cuantiza a int8 (~26 MB) y escribe `vesta-model.json` con los valores de cada cabeza, el preprocesado y las reglas. Con `--check N` (300 por defecto) compara PyTorch, ONNX fp32 e int8 en imágenes de test.
- [`calibrate.py`](vesta_ml/calibrate.py) ajusta una temperatura por cabeza de valor único (*temperature scaling*) minimizando la log-verosimilitud en validación, muestra el error de calibración (ECE) antes y después en validación y test, la guarda en `models/<nombre>/calibration.json` y la añade a `vesta-model.json` si describe ese modelo; `export.py` la incluye al exportar. No cambia qué valor gana. En heads-v4 (test): categoría 6,4 % → 0,6 %, subcategoría 11,3 % → 2,8 %, manga 14,6 % → 3,3 %, estampado 26,2 % → 2,0 %; el corte queda igual (5,8 % → 6,5 %, pocas fotos). Las temperaturas son menores que 1: el modelo era demasiado prudente (pesos por clase y dropout).
- Con heads-v4, int8 pierde como mucho ~1,5 puntos frente a fp32 (categoría 93,5 → 92,0 %, subcategoría 78,5 → 78,0 % en 400 imágenes de test). fp16 no pierde nada pero ocupa 46 MB y el runtime web no garantiza sus operaciones en WebAssembly.
- La app ([`src/ai/clothingAnalyzer.ts`](../src/ai/clothingAnalyzer.ts)) usa onnxruntime-web (WebAssembly), replica el letterbox en un canvas, promedia las probabilidades de todas las fotos y aplica las mismas reglas que `targets.apply_rules`, leídas de `taxonomy.json`. Rechaza un modelo exportado con otra versión de taxonomía. El modelo se guarda en Cache Storage con su nombre y tamaño, así que una exportación nueva se descarga de nuevo y después funciona sin conexión.
- Rellena categoría, subcategoría y estampado; la manga y el corte se muestran como información (la prenda no tiene esos campos). Formalidad, temporadas y color no se entrenan todavía: el color sigue saliendo del muestreo de píxeles.

## Propuestas y revisión de subcategorías

Muchas imágenes tienen categoría pero no subcategoría (todo el calzado, los `Pants` de Clothing Dataset, las camisas y sudaderas genéricas de Fashionpedia). Para etiquetarlas sin hacerlo una a una:

```sh
python -m vesta_ml.propose   # SigLIP 2 (Apache-2.0) propone una subcategoría; reanudable
python -m vesta_ml.review    # abre http://127.0.0.1:8765
python -m vesta_ml.prepare merge
```

- [`propose.py`](vesta_ml/propose.py) compara cada imagen con descripciones en inglés de las subcategorías de su categoría (sin entrenar nada) y guarda las probabilidades en `review/proposals.jsonl`, en el directorio de datos.
- [`review.py`](vesta_ml/review.py) agrupa las propuestas por subcategoría propuesta, primero las que menos ejemplos tienen. Cada página llega con la propuesta marcada: se corrigen las erróneas («Ninguna» si no encaja ninguna, «Descartar» si la imagen no sirve) y se guarda la página entera.
- Las decisiones se guardan en [`reviews/decisions.jsonl`](reviews/decisions.jsonl), **dentro del repositorio**, porque son trabajo manual. `merge` las aplica: rellena la subcategoría (nunca sustituye una etiqueta de la fuente) y quita las imágenes descartadas.
- Las propuestas sin revisar no se usan para entrenar.
- `python -m vesta_ml.disagree <modelo> [--min-confidence 0.5] [--max-label 0.2]` propone revisar las imágenes en las que un modelo entrenado contradice la subcategoría con seguridad (suelen ser etiquetas erróneas de las fuentes). Llegan marcadas con la etiqueta actual, así que guardar sin tocar la confirma; la decisión sustituye la etiqueta como en `--relabel`. Incluye imágenes que ya revisaste al rellenar subcategorías, pero no las ya reetiquetadas ni las fotos propias.
- `propose --relabel <subcategoría> [--source <fuente>] --categories …` vuelve a proponer imágenes que ya tienen esa subcategoría, o la tenían antes de retirarla (`merge` la guarda en `meta.removedLabels`), entre las subcategorías de esas categorías. Esas decisiones sí sustituyen la etiqueta de la fuente, categoría incluida, y «Ninguna» la deja sin subcategoría. Se usó para las sandalias de Open Images (`--relabel sandalias --source open-images --categories footwear`), que mezclan tacones y chanclas, y para las túnicas (`--relabel tunica --categories top one-piece outerwear`).

## Exportación desde la app

En **Armario → Exportar datos de entrenamiento** se descarga un ZIP generado en el navegador con `export.json`, `labels.jsonl` (una línea por prenda) e `images/`. Incluye solo etiquetas normalizadas, el texto original de esas etiquetas y cómo se obtuvo cada una (`corrected`, `accepted-suggestion` o `manual`); no incluye nombre, marca, talla ni notas.

## Pruebas

```sh
cd ml
python -m unittest discover -s tests -t .
```
