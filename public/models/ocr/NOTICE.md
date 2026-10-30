# Lector de texto (OCR)

Modelos de [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-OCRv5 mobile, licencia Apache-2.0, en las exportaciones ONNX oficiales de PaddlePaddle, sin modificar:

- `det.onnx`: [PaddlePaddle/PP-OCRv5_mobile_det_onnx](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx) (`inference.onnx`).
- `rec.onnx`: [PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx](https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx) (`inference.onnx`).

`ocr-model.json` recoge el preprocesado y el diccionario de caracteres de sus `inference.yml`. La app los usa para leer marcas escritas en las fotos (`src/ai/textReader.ts` y `src/ai/brands.ts`).
