# VESTA — Armario virtual

Armario virtual local-first para catalogar prendas y, en una siguiente etapa, crear outfits con el inventario propio. La aplicación no requiere cuenta ni backend. Las prendas, originales y miniaturas de sus fotografías se guardan en IndexedDB en el navegador.

## Requisitos

- Node.js 20.19+ o 22.12+
- npm

## Instalación y desarrollo

```sh
npm install
npm run dev
```

Vite muestra la dirección local al iniciar. Para generar y previsualizar una compilación:

```sh
npm run build
npm run preview
```

Para ejecutar las pruebas:

```sh
npm test
```

## Funcionalidad disponible

- Fondo animado Pattern Waves, con animación desactivada si el sistema prefiere movimiento reducido.
- Catálogo Masonry con búsqueda, filtro, consulta, edición y eliminación de prendas.
- Pill Nav fijo en la parte inferior: Armario, Añadir y Outfits.
- Las fotos originales y la miniatura de portada se procesan localmente y se almacenan en IndexedDB. Se pueden guardar hasta cuatro fotos por prenda; las miniaturas no exceden 640 px por lado.
- Catalogación visual automática al añadir o cambiar fotos, tanto al crear una prenda como al editarla. Combina puntuaciones de Wargon Clothing Classifier a través de las fotos para proponer categoría/subcategoría y mostrar tres clases alternativas. El nombre se propone con subcategoría, hasta dos colores y marca (por ejemplo, «Camiseta blanca · Zara»), y se actualiza con esos campos mientras no se edite manualmente. El color se estima aparte con píxeles locales. El usuario puede elegir una alternativa, revisar y corregir los campos antes de guardar.
- IndexedDB versionada con tablas para prendas, outfits, preferencias y paquetes de tendencias.
- La PWA precachea recursos estáticos; no cachea solicitudes API ni datos personales.

La interfaz usa los componentes React Bits instalados desde su registro. Masonry requiere React/React DOM 19 y Hugeicons; Pattern Waves usa OGL. Pill Nav no necesita GSAP ni otra librería de animación. El analizador utiliza `@huggingface/transformers` para inferencia ONNX en el navegador.

## Catalogación local y evaluación de modelos

El modelo integrado es [`wargoninnovation/wargon-clothing-classifier`](https://huggingface.co/wargoninnovation/wargon-clothing-classifier), ViT-Base/16 de 27 clases. El model card declara licencia Apache-2.0, informa 73 % de exactitud en su propia partición de validación y advierte que está optimizado para fotos limpias con fondos mínimos. La revisión usada es `972befbd9a82cda03352239d813ff4959d2ccb4d`. El repositorio upstream publica solo pesos PyTorch `.safetensors` (343.300.876 bytes), así que se convirtió a ONNX y se aplicó cuantización dinámica int8 por canal. El archivo ONNX cuantizado ocupa 89.192.017 bytes (~89,2 MB) y se incluye en `public/models/wargoninnovation/wargon-clothing-classifier/onnx/model_quantized.onnx`; se carga bajo demanda con Transformers.js y ONNX Runtime Web, no durante el precache PWA. El preprocesado conserva el del modelo: RGB, 224×224, escala `1/255` y media/desviación `[0.5, 0.5, 0.5]`. Se usa `class_mappings.json` para relacionar el índice de salida con la clase; no se infieren nombres a partir de `LABEL_n`.

La cuantización se contrastó contra el checkpoint PyTorch original en las cuatro fotos locales de `public/test-photos`: las cuatro predicciones de clase superior coincidieron. Esto comprueba la conversión en esa muestra, no constituye una validación general del modelo ni de su rendimiento en navegador. El clasificador devuelve puntuaciones softmax entre sus 27 clases; no están calibradas como probabilidades fiables y siempre son sugerencias editables. Solo predice una clase por imagen y puede fallar con prendas múltiples, personas, oclusiones y fondos complejos. No infiere color, estampado, manga, cuello, corte, estilo, formalidad ni temporada.

La aplicación sirve el ONNX desde su propio origen y no necesita contactar con Hugging Face para ejecutar el análisis. La selección de fotos inicia la carga bajo demanda del modelo; las siguientes cargas pueden reutilizar la caché del navegador. Las imágenes se decodifican y procesan localmente: no se envían las fotos, las predicciones ni el inventario. El Service Worker no precachea el ONNX ni los datos personales.

El formulario acepta hasta cuatro fotos JPG, PNG o WebP, de hasta 8 MB cada una. Se guardan con la prenda y se pueden consultar desde su detalle; la primera es la portada y se puede cambiar al editar. Para el análisis, el sistema promedia las puntuaciones de clase de todas las fotos y ofrece las tres siguientes como alternativas seleccionables. Son vistas de una misma prenda: varias fotos pueden mejorar la evidencia visual, pero no añaden capacidades nuevas de detección. La estimación de color muestrea píxeles locales de cada foto, reduce bordes y descuenta el color de fondo más común en el perímetro; propone hasta tres colores por frecuencia. Es una heurística, no segmentación de prendas; fondos complejos pueden alterarla. Las correcciones y el identificador/revisión del modelo, puntuaciones, sugerencias y atributos no detectados se guardan junto con la prenda en IndexedDB.

**Evaluación histórica de CLIP (20-10-2026; ya no es el modelo integrado):** en una foto de una persona vistiendo un conjunto deportivo de dos piezas, CLIP propuso `Prenda deportiva` y el estimador de color devolvió `Naranja`, incorrecto para las prendas gris/malva. La imagen también contenía pantalón corto y CLIP solo devolvió una etiqueta. Esta evaluación motivó la comparación con el clasificador de ropa; el color sigue siendo una heurística independiente y no fiable para imágenes con personas.

La repetición con pesos en caché tardó aproximadamente 1,7–2,4 s en este navegador. La recarga con acceso a Hugging Face bloqueado completó desde la caché local del modelo; no equivale a una prueba offline completa del sitio ni a una medición fría de descarga. Los recursos del modelo almacenados eran GET a Hugging Face (incluido el ONNX de 153.695.702 bytes); la imagen se pasó localmente desde `Blob` a `RawImage`, sin incluirse en esas peticiones.

**Comparación local de clasificadores (4 fotos etiquetadas en `public/test-photos`, 20-10-2026):** se ejecutó Wargon con Transformers/PyTorch en CPU y se comparó con la evaluación histórica de CLIP en navegador:

| Foto / etiqueta esperada | CLIP en la app | Wargon |
|---|---|---|
| Camiseta blanca | Camisa (37,2 %) | T-shirt (39,3 %) |
| Chaqueta azul | Chaqueta (38,8 %) | Jacket (91,6 %) |
| Chaqueta verde | Chaqueta (16,3 %) | Hoodie (31,7 %) |
| Sudadera verde | Jersey (28,3 %) | Hoodie (72,2 %) |

En esta pequeña muestra de fotos de producto, Wargon acierta 3/4 subcategorías exactas y CLIP 2/4; ambos aciertan la categoría general en 4/4. Wargon confunde la chaqueta verde con una sudadera. Las puntuaciones no son comparables entre modelos: CLIP normaliza la similitud entre sus descripciones candidatas y Wargon aplica softmax a sus 27 clases; ninguna cifra se ha calibrado como probabilidad fiable. La carga inicial de Wargon y sus pesos tardó aproximadamente 21,5 s en CPU en este equipo; la inferencia por imagen, 0,6–1,6 s. La exportación ONNX cuantizada conservó las cuatro clases superiores, pero no se ha medido todavía su latencia ni memoria en navegador.

Wargon solo clasifica prendas: no estima color. El estimador de píxeles produjo Gris claro para la camiseta blanca, Azul para la chaqueta azul, Gris para la chaqueta verde y Verde para la sudadera verde (2/4 colores exactos), independientemente del clasificador de categoría.

**Límites de evaluación:** las cuatro fotos son una muestra pequeña de producto y no permiten estimar calidad general. No se han probado prendas sobre cama, prendas colgadas, baja iluminación, oclusiones, personas vistiendo prendas ni fondos complejos en esta comparación, y no se ha medido memoria en dispositivos reales. No se declaran tasas de calidad ni umbrales calibrados. La siguiente validación debe ampliar el conjunto local etiquetado y representativo, registrar matriz de confusión/precisión por clase, rendimiento y memoria en móviles y escritorio, y mejorar la estimación de color para imágenes vestidas o con fondos complejos.

## Almacenamiento y privacidad

Los datos se guardan en IndexedDB del perfil del navegador y las imágenes permanecen como `Blob` local. Los object URLs de miniaturas y previsualizaciones se revocan al actualizar o desmontar sus vistas. La aplicación no incorpora backend, inicio de sesión, analítica ni servicios de análisis remotos. Pattern Waves usa WebGL local; los componentes Masonry y Pill Nav no envían datos. El análisis utiliza el modelo ONNX servido desde el mismo origen, sin enviar la fotografía. La configuración PWA precachea recursos estáticos de la aplicación, pero no el modelo ni los datos personales. Esto describe el diseño del código; no constituye una auditoría de tráfico ni una prueba de red completa.

Limpiar los datos del sitio o usar otro navegador/perfil elimina o separa el inventario. IndexedDB no implica cifrado en reposo. La solicitud de almacenamiento persistente es opcional y depende del soporte y decisión del navegador.

## Pruebas

```sh
npm test
npm run build
```

## Próximo hito

Validar el analizador con fotografías locales representativas y medir precisión, latencia y memoria antes de ajustar la experiencia de sugerencias. Después, implementar el motor determinista de generación de outfits basado en prendas reales, reglas de compatibilidad y puntuación, junto con pruebas unitarias independientes de React. También se podrán añadir exportación/importación y servicios meteorológicos o de tendencias opcionales.
