# Modelo de prendas de VESTA

`model_quantized.onnx` se genera con `python -m vesta_ml.export` (ver `ml/README.md`). `vesta-model.json` describe sus salidas.

- **Backbone:** [DINOv2 ViT-S/14](https://huggingface.co/facebook/dinov2-small) (Meta), licencia Apache-2.0. Pesos sin modificar, cuantizados a int8.
- **Cabezas:** entrenadas por VESTA sobre Clothing Dataset (CC0), Fashionpedia (anotaciones CC BY 4.0; solo fotos con licencia comercial), Open Images V7 (cajas CC BY 4.0; fotos CC BY 2.0), fotos de Unsplash y Pexels (licencias de esas webs) y fotos propias. La atribución de cada imagen está en el manifiesto de entrenamiento.
