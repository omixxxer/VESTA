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
- Las imágenes originales y miniaturas se procesan localmente y se almacenan en IndexedDB. Las miniaturas no exceden 640 px por lado.
- Catalogación visual opcional al pulsar «Analizar foto en este dispositivo»: usa un único modelo de visión, CLIP zero-shot, para proponer categoría/subcategoría; el color se estima con una heurística local de píxeles (no es otro modelo). El nombre se rellena con la subcategoría sugerida y sigue siendo editable. El usuario debe revisar y guardar las sugerencias.
- IndexedDB versionada con tablas para prendas, outfits, preferencias y paquetes de tendencias.
- La PWA precachea recursos estáticos; no cachea solicitudes API ni datos personales.

La interfaz usa los componentes React Bits instalados desde su registro. Masonry requiere React/React DOM 19 y Hugeicons; Pattern Waves usa OGL. Pill Nav no necesita GSAP ni otra librería de animación. El analizador utiliza `@huggingface/transformers` para inferencia ONNX en el navegador.

## Catalogación local y evaluación de modelos

Se evaluó primero [`wargoninnovation/wargon-clothing-classifier`](https://huggingface.co/wargoninnovation/wargon-clothing-classifier): ViT-Base/16, 27 clases y licencia Apache-2.0 declarada, pero solo publica pesos PyTorch `.safetensors` de 343.300.876 bytes; no ofrece ONNX para Transformers.js. El preprocesador declara redimensionado a 224×224, escala `1/255` y normalización con media/desviación `[0.5, 0.5, 0.5]`. `config.json` etiqueta las salidas como `LABEL_0`…`LABEL_26`; la correspondencia legible está en `class_mappings.json` (el mapa de 27 clases se debe usar, no asumir nombres inferidos del índice). Su ficha informa 73 % de exactitud sobre una partición de validación propia y advierte que está optimizado para fotos limpias con fondos mínimos. No se integró ni se asumió compatibilidad web.

La opción seleccionada es [`Xenova/clip-vit-base-patch32`](https://huggingface.co/Xenova/clip-vit-base-patch32), ViT-B/32 de CLIP con ONNX compatible con la tarea zero-shot de Transformers.js. Se fija la revisión `d15189d7028b43f1d3e65039190477f6af591c2a` y se solicita la variante `q8` (archivo de pesos de 153.695.702 bytes, aproximadamente 153,7 MB). Su procesador convierte a RGB, redimensiona el borde corto a 224 px, aplica recorte central 224×224, reescala por `1/255` y normaliza con media `[0.48145466, 0.4578275, 0.40821073]` y desviación `[0.26862954, 0.26130258, 0.27577711]`; Transformers.js aplica este preprocesamiento. El runtime WASM incluido por la dependencia añade un recurso de hasta 26,9 MB sin comprimir y su módulo JS se sirven desde el mismo origen; ambos se cachean bajo demanda por el Service Worker, evitando la descarga del runtime desde CDN y la necesidad de ejecutar módulos de script `blob:`. El coste inicial es por tanto significativo. El modelo compara descripciones controladas de prendas y mapea la etiqueta ganadora a la taxonomía de Vesta. No está especializado en ropa y puede confundir clases, oclusiones, varias prendas y fondos complejos. La puntuación es relativa a las etiquetas candidatas, no una probabilidad calibrada ni un umbral de aceptación: siempre se presenta como sugerencia editable. No se infieren estampado, manga, cuello, corte, estilo, formalidad ni temporada.

El repositorio Xenova no declara una licencia de pesos en su ficha, y la ficha de los pesos base de OpenAI tampoco identifica una licencia de distribución explícita. Por ello Vesta no redistribuye los pesos: el navegador los solicita a Hugging Face solo cuando el usuario inicia el análisis. Antes de redistribuirlos o usar esta selección en una publicación comercial, hay que verificar las condiciones de licencia aplicables.

En el primer análisis se descargan los pesos (unos 153,7 MB) desde Hugging Face; la biblioteca los guarda en su caché del navegador para posteriores usos, incluso sin conexión cuando la caché siga disponible. Solo se solicita esa conexión tras una acción explícita. Las imágenes se decodifican, normalizan, convierten a `Blob` local y pasan directamente a `RawImage`; no se construyen URLs remotas con imágenes ni se transmiten la foto, las predicciones o el inventario. La CSP permite los dominios de descarga de pesos y la compilación WASM necesarios. El Service Worker no precachea el modelo y almacena el runtime WASM y su módulo JS solo cuando se solicitan.

La estimación de color muestrea píxeles locales, reduce bordes y descuenta el color de fondo más común en el perímetro. Es una heurística, no segmentación de prendas; fondos complejos pueden alterarla. Las correcciones y el identificador/revisión del modelo, puntuaciones, sugerencias y atributos no detectados se guardan junto con la prenda en IndexedDB.

**Validación manual inicial (una imagen, 20-10-2026):** se probó en navegador una foto de una persona vistiendo un conjunto deportivo de dos piezas, con fondo uniforme. Tras fijar la revisión en todas las rutas del modelo, tres análisis en caliente y una recarga con las solicitudes a Hugging Face bloqueadas produjeron de forma estable `Prenda deportiva`, puntuación zero-shot 26,8 %, y color `Naranja`. La categoría amplia es plausible para la parte superior, pero la foto contiene también pantalón corto y el clasificador devuelve una sola etiqueta. El color naranja es incorrecto: la imagen muestra prendas gris/malva y la estimación parece estar dominada por los tonos de piel. Este caso confirma que el color actual no es fiable cuando hay una persona en la foto; hay que corregirlo antes de usarlo como valor sugerido por defecto.

La repetición con pesos en caché tardó aproximadamente 1,7–2,4 s en este navegador. La recarga con acceso a Hugging Face bloqueado completó desde la caché local del modelo; no equivale a una prueba offline completa del sitio ni a una medición fría de descarga. Los recursos del modelo almacenados eran GET a Hugging Face (incluido el ONNX de 153.695.702 bytes); la imagen se pasó localmente desde `Blob` a `RawImage`, sin incluirse en esas peticiones.

**Comparación local de clasificadores (4 fotos etiquetadas en `public/test-photos`, 20-10-2026):** se ejecutó Wargon con Transformers/PyTorch en CPU, descargando sus pesos y procesando las fotos localmente; las imágenes no se enviaron a Hugging Face. Se compararon las etiquetas de subcategoría con el análisis CLIP en el navegador:

| Foto / etiqueta esperada | CLIP en la app | Wargon |
|---|---|---|
| Camiseta blanca | Camisa (37,2 %) | T-shirt (39,3 %) |
| Chaqueta azul | Chaqueta (38,8 %) | Jacket (91,6 %) |
| Chaqueta verde | Chaqueta (16,3 %) | Hoodie (31,7 %) |
| Sudadera verde | Jersey (28,3 %) | Hoodie (72,2 %) |

En esta pequeña muestra de fotos de producto, Wargon acierta 3/4 subcategorías exactas y CLIP 2/4; ambos aciertan la categoría general en 4/4. Wargon confunde la chaqueta verde con una sudadera. Las puntuaciones no son comparables entre modelos: CLIP normaliza la similitud entre sus descripciones candidatas y Wargon aplica softmax a sus 27 clases; ninguna cifra se ha calibrado como probabilidad fiable. La carga inicial de Wargon y sus pesos tardó aproximadamente 21,5 s en este equipo; la inferencia por imagen en CPU, 0,6–1,6 s. Esto no mide rendimiento en navegador.

Wargon solo clasifica prendas: no estima color. El estimador de píxeles usado por la app produjo Gris claro para la camiseta blanca, Azul para la chaqueta azul, Gris para la chaqueta verde y Verde para la sudadera verde (2/4 colores exactos). Sus resultados son idénticos independientemente del clasificador de categoría. Por tanto, Wargon parece prometedor para subcategorías, pero esta muestra no basta para sustituir CLIP ni demuestra mejoría general; no se ha integrado en la aplicación porque el repositorio publica `.safetensors`, no un ONNX listo para Transformers.js.

**Límites de evaluación:** las cuatro fotos son una muestra pequeña de producto y no permiten estimar calidad general. No se han probado prendas sobre cama, prendas colgadas, baja iluminación, oclusiones, personas vistiendo prendas ni fondos complejos en esta comparación, y no se ha medido memoria en dispositivos reales. No se declaran tasas de calidad ni umbrales calibrados. La siguiente validación debe ampliar el conjunto local etiquetado y representativo, registrar matriz de confusión/precisión por clase, rendimiento y memoria en móviles y escritorio, y mejorar la estimación de color para imágenes vestidas o con fondos complejos.

## Almacenamiento y privacidad

Los datos se guardan en IndexedDB del perfil del navegador y las imágenes permanecen como `Blob` local. Los object URLs de miniaturas y previsualizaciones se revocan al actualizar o desmontar sus vistas. La aplicación no incorpora backend, inicio de sesión, analítica ni servicios de análisis remotos. Pattern Waves usa WebGL local; los componentes Masonry y Pill Nav no envían datos. Solo la descarga explícita del modelo contacta con Hugging Face, sin enviar la fotografía. La configuración PWA precachea los recursos estáticos producidos por Vite y no los datos personales. Esto describe el diseño del código; no constituye una auditoría de tráfico ni una prueba de red completa.

Limpiar los datos del sitio o usar otro navegador/perfil elimina o separa el inventario. IndexedDB no implica cifrado en reposo. La solicitud de almacenamiento persistente es opcional y depende del soporte y decisión del navegador.

## Pruebas

```sh
npm test
npm run build
```

## Próximo hito

Validar el analizador con fotografías locales representativas y medir precisión, latencia y memoria antes de ajustar la experiencia de sugerencias. Después, implementar el motor determinista de generación de outfits basado en prendas reales, reglas de compatibilidad y puntuación, junto con pruebas unitarias independientes de React. También se podrán añadir exportación/importación y servicios meteorológicos o de tendencias opcionales.
