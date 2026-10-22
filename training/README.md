# Clasificador propio de VESTA (multi-cabeza)

Pipeline para ajustar un modelo ligero preentrenado y exportarlo a ONNX int8 para que corra en el
navegador. Predice, con una cabeza por atributo: `category`, `subtype`, `pattern`, `neckline`,
`sleeve_length`, `fit`, `formality` y `season` (ver `taxonomy.json`). El color sigue calculándose en
la app con análisis de píxeles.

## Estado real (léelo antes de entrenar)

| Pieza | Estado |
|---|---|
| Scripts de datos, entrenamiento, exportación y evaluación | Escritos y **probados de extremo a extremo con datos sintéticos** (`smoke_test.py`) |
| Adaptador TypeScript (`src/ai/vestaClassifier.ts`) | Parte pura con tests y `tsc` limpio. **La parte de navegador (canvas + onnxruntime-web) no se ha ejecutado**; hay que probarla con un modelo real |
| `attribute_mapping.json` | **Propuesta sin validar**: los nombres de supercategorías/atributos de Fashionpedia son suposiciones. Ejecuta `inspect_ontology.py` con el JSON real y ajústalo |
| Modelo entrenado | **No existe.** No se ha descargado ningún dataset ni entrenado nada; eso requiere GPU |
| Conexión con la app | **No hecha.** `clothingAnalyzer.ts` sigue usando Wargon |

## Datos y licencias

- **Fashionpedia** (tipo de prenda, estampado, cuello, manga, ajuste). Anotaciones CC BY 4.0; las
  imágenes no son de Fashionpedia: siguen los términos de Flickr, Unsplash, Pexels, etc. y el uso
  comercial depende de cada fuente. Revisa <https://fashionpedia.github.io/home/data_license.html>.
  Descarga: <https://github.com/cvdfoundation/fashionpedia> (`train2020.zip`, `val_test2020.zip`,
  `instances_attributes_*2020.json`).
- **Myntra / Fashion Product Images** (solo para `formality` y `season`): **no pude verificar su
  licencia**. Compruébala en Kaggle antes de usarlo y sobre todo antes de distribuir un modelo
  entrenado con él. El script lo exige con `--i-accept-license-risk`. Sin él, esas dos cabezas se
  excluyen solas (no hay datos suficientes) y el modelo sale sin formalidad/temporada.
- **DeepFashion**: descartado, es solo para investigación no comercial y no redistribuible.

## Uso

```bash
cd training
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1) Descargar Fashionpedia en data/raw/fashionpedia/ y revisar el mapeo
python inspect_ontology.py --annotations data/raw/fashionpedia/instances_attributes_val2020.json

# 2) Preparar recortes y manifiestos
python prepare_fashionpedia.py --annotations data/raw/fashionpedia/instances_attributes_train2020.json \
    --images-dir data/raw/fashionpedia/train --out data/prepared --split train
python prepare_fashionpedia.py --annotations data/raw/fashionpedia/instances_attributes_val2020.json \
    --images-dir data/raw/fashionpedia/test --out data/prepared --split val
# (opcional) python prepare_myntra.py ... --i-accept-license-risk

# 3) Entrenar (GPU recomendada; en Colab: !pip install -r requirements.txt y los mismos comandos)
python train.py --manifests data/prepared/manifest_train.jsonl \
    --val-manifests data/prepared/manifest_val.jsonl \
    --backbone mobilenetv3_large_100 --epochs 15 --balance-subtype --out runs/vesta-v1

# 4) Exportar y comparar fp32 vs int8
python export_onnx.py --checkpoint runs/vesta-v1/best.pt --out dist/vesta-garment-classifier
python eval_onnx.py --model-dir dist/vesta-garment-classifier --manifests data/prepared/manifest_val.jsonl
```

Prueba rápida del pipeline (CPU, sin red ni datos): `python smoke_test.py --workdir /tmp/vesta-smoke`.

## Cosas a vigilar

1. **Cuantización int8**: en la prueba sintética los logits int8 se desvían mucho más que los fp32
   (diff máx ~3 con un modelo sin entrenar). No dice nada de un modelo real, pero compara siempre con
   `eval_onnx.py`: si la precisión equilibrada de `subtype` cae más de ~2 puntos, usa fp32 o
   cuantización estática con calibración.
2. **Dominio**: Fashionpedia son fotos con personas; la app cataloga fotos de prendas sueltas. Espera
   una caída de precisión. Mitigación: añadir tus propias fotos etiquetadas (ajuste fino posterior).
3. **Métrica**: mira la precisión *equilibrada* por cabeza, no la global (las clases están
   desbalanceadas). Las cabezas con etiquetas ambiguas se ignoran en la pérdida a propósito.
4. **Preprocesado idéntico**: resize directo a `image_size`×`image_size` + normalización ImageNet,
   tanto en `dataset.py` como en `vestaClassifier.ts` (`pixelsToTensor`). Si lo cambias en uno, cámbialo en el otro.

## Integrar en la app (pendiente)

1. Copiar `dist/vesta-garment-classifier/{vesta_model.json,onnx/model_quantized.onnx}` a
   `public/models/vesta-garment-classifier/` (no hace falta commitear los `.onnx`; considera Git LFS
   o servirlos desde una release).
2. Añadir `'vesta-model'` a `sourcesByAttribute` en `src/types/domain.ts` y usar
   `loadVestaClassifier()` desde `clothingAnalyzer.ts` en lugar del modelo Wargon.
3. `onnxruntime-web` llega hoy como dependencia transitiva de `@huggingface/transformers`; si usas el
   adaptador directamente, declárala en `package.json`.
