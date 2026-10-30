# Componentes de terceros

VESTA es software propietario (ver [LICENSE](LICENSE)). Los componentes de esta lista no son de VESTA, no están cubiertos por su licencia y conservan la suya. Este archivo recoge sus avisos y atribuciones.

## Modelos incluidos en la app

| Componente | Archivos | Licencia | Fuente |
|---|---|---|---|
| DINOv2 ViT-S/14 (Meta) | `public/models/vesta/model_quantized.onnx` (backbone, pesos sin modificar, cuantizados a int8) | Apache-2.0 | [facebook/dinov2-small](https://huggingface.co/facebook/dinov2-small) |
| PaddleOCR PP-OCRv5 mobile, detector (PaddlePaddle) | `public/models/ocr/det.onnx` | Apache-2.0 | [PaddlePaddle/PP-OCRv5_mobile_det_onnx](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx) |
| PaddleOCR PP-OCRv5 mobile, reconocedor latino (PaddlePaddle) | `public/models/ocr/rec.onnx` | Apache-2.0 | [PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx](https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx) |

Las cabezas de clasificación que acompañan a DINOv2 en `model_quantized.onnx` son de VESTA. Cada carpeta de modelos tiene además su `NOTICE.md`.

## Datos de entrenamiento de las cabezas

Las cabezas se entrenaron solo con datos cuya licencia permite uso comercial. Los datos no se distribuyen con la app; la atribución de cada imagen se conserva en el manifiesto de entrenamiento (fuera del repositorio).

| Fuente | Licencia |
|---|---|
| [Clothing Dataset](https://github.com/alexeygrigorev/clothing-dataset) (Alexey Grigorev) | CC0 1.0 |
| [Fashionpedia](https://fashionpedia.github.io/home/) | Anotaciones CC BY 4.0; solo fotos con licencia que permite uso comercial |
| [Open Images V7](https://storage.googleapis.com/openimages/web/index.html) (Google) | Anotaciones CC BY 4.0; fotos CC BY 2.0 de sus autores en Flickr |
| Fotos de [Unsplash](https://unsplash.com/license) y [Pexels](https://www.pexels.com/license/) | Licencias de Unsplash y Pexels |
| Fotos propias del titular | Del titular |

## Bibliotecas incluidas en la app

| Biblioteca | Licencia |
|---|---|
| [React](https://github.com/facebook/react) y React DOM | MIT |
| [Dexie.js](https://github.com/dexie/Dexie.js) | Apache-2.0 |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (Microsoft) | MIT |
| [OGL](https://github.com/oframe/ogl) | Unlicense |
| [Hugeicons](https://hugeicons.com) (`@hugeicons/core-free-icons`, `@hugeicons/react`) | MIT |
| [Workbox](https://github.com/GoogleChrome/workbox) (vía `vite-plugin-pwa`) | MIT |

Las herramientas de desarrollo y pruebas (Vite, TypeScript, Vitest, Testing Library…) y las de entrenamiento en `ml/` (PyTorch, Transformers, ONNX, Pillow, NumPy) no se distribuyen con la app; cada una tiene su licencia.

## Servicios externos

- [Open-Meteo](https://open-meteo.com): previsión y geocodificación, solo cuando el usuario consulta el tiempo. Datos bajo CC BY 4.0, atribución a Open-Meteo.com.
- [Google Drive API](https://developers.google.com/drive) e inicio de sesión de Google: solo si el usuario guarda o restaura su copia en su propio Drive. Sujeto a las condiciones de Google; la app no incluye código de Google.

## Licencia Apache-2.0

DINOv2, los modelos de PaddleOCR y Dexie.js se distribuyen bajo la Licencia Apache, versión 2.0, cuyo texto completo está en [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt).
