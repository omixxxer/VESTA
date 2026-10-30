# VESTA — Armario virtual

Armario virtual local-first para catalogar prendas, generar y guardar outfits, y preparar una propuesta de maleta a partir del inventario propio. No requiere cuenta ni backend. Las prendas, outfits y fotografías se guardan en IndexedDB en el navegador.

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
- Catálogo Masonry con búsqueda, filtro, consulta, edición y eliminación de prendas. La galería muestra 40 prendas por tanda y permite cargar más.
- Pill Nav fijo en la parte inferior: Armario, Outfits y Maleta. La acción para añadir prendas está integrada en Armario.
- Outfits generados con prendas reales, preferencias y feedback; se pueden valorar con botones o swipe en móvil, guardar como favoritos y consultar después. También se pueden crear outfits manuales.
- Consulta opcional a Open-Meteo para usar el tiempo de mañana en el generador y planificar una maleta para una ciudad, fecha y duración de hasta 14 días. Los outfits diarios y una lista de prendas única se proponen localmente; la lista puede editarse.
- Las fotos originales y la miniatura de portada se procesan localmente y se almacenan en IndexedDB. Se pueden guardar hasta cuatro fotos por prenda; las miniaturas no exceden 640 px por lado.
- Catalogación visual automática al añadir o cambiar fotos, tanto al crear una prenda como al editarla. El modelo propio de VESTA combina las probabilidades de todas las fotos para proponer categoría, subcategoría y estampado, mostrar tres alternativas e informar de la manga o el corte del pantalón. El nombre se propone con subcategoría, hasta dos colores y marca (por ejemplo, «Camiseta blanca · Zara»), y se actualiza con esos campos mientras no se edite manualmente. El color se estima aparte con píxeles locales. El usuario puede elegir una alternativa, revisar y corregir los campos antes de guardar.
- IndexedDB versionada con tablas para prendas, outfits, preferencias y paquetes de tendencias.
- La PWA precachea recursos estáticos; no cachea solicitudes API ni datos personales. La consulta meteorológica envía el nombre de la ciudad a Open-Meteo y no envía el inventario ni las fotografías.

La interfaz usa los componentes React Bits instalados desde su registro. Masonry requiere React/React DOM 19 y Hugeicons; Pattern Waves usa OGL. Pill Nav no necesita GSAP ni otra librería de animación. El analizador utiliza `onnxruntime-web` (WebAssembly) para la inferencia ONNX en el navegador.

## Arquitectura y bases de datos

- `src/app/`: composición de pantallas, navegación y estado de la aplicación.
- `src/components/`: formularios, detalle de prendas, galería, generador de outfits y planificador de maleta.
- `src/db/`: base IndexedDB versionada con Dexie y procesamiento de miniaturas.
- `src/ai/`: clasificación local ONNX y estimación heurística de color.
- `src/outfits/`: generación determinista de combinaciones y puntuación heurística.
- `src/weather/`: cliente de geocodificación y previsión diaria de Open-Meteo.
- `src/types/`: tipos compartidos del dominio.

La base local se llama `vesta-wardrobe`. El esquema actual es la versión 4:

| Almacén | Índices | Contenido |
|---|---|---|
| `garments` | `id`, `category`, `name`, `updatedAt` | Prendas, atributos e imágenes originales, adicionales y miniaturas como `Blob`. |
| `outfits` | `id`, `createdAt`, `favorite`, `kind` | Outfits manuales y generados guardados, referencias a prendas e historial de uso. |
| `preferences` | `id` | Preferencias locales del generador. |
| `trendPacks` | `id`, `version`, `publishedAt` | Estructura preparada para paquetes de tendencias; la pantalla de tendencias aún no está implementada. |
| `outfitFeedback` | `id`, `type`, `createdAt` | Valoraciones y selecciones que alimentan futuras puntuaciones. |

Las migraciones preservan los datos existentes: v2 añade dimensiones ausentes a prendas antiguas; v3 incorpora feedback de outfits; v4 añade el índice `kind` para distinguir outfits manuales y generados. No se separan aún las imágenes del registro de prenda, por lo que la lectura inicial sigue recuperando los `Blob` aunque la galería limite cuántas miniaturas muestra.

`npm run build` ejecuta primero la comprobación de TypeScript y después Vite. `npm test` ejecuta Vitest en jsdom con IndexedDB simulado mediante `fake-indexeddb`. La PWA precachea recursos de interfaz y usa caché de tiempo de ejecución para los módulos WebAssembly; no precachea el modelo de ropa ni las respuestas meteorológicas.

## Catalogación local y evaluación de modelos

El modelo integrado es el propio de VESTA, entrenado en [`ml/`](ml/README.md): DINOv2 ViT-S/14 (Apache-2.0) congelado más cabezas de categoría, subcategoría, manga, corte de pantalón y estampado, con la taxonomía de la app (incluidos calzado y accesorios). Se exporta con `python -m vesta_ml.export` a un único ONNX cuantizado int8 de ~25,6 MB en `public/models/vesta/model_quantized.onnx`, junto a `vesta-model.json`, que describe salidas, preprocesado y reglas, y `NOTICE.md` con licencias y fuentes. Se carga bajo demanda con ONNX Runtime Web (WebAssembly), no durante el precache PWA, y se guarda en Cache Storage para funcionar sin conexión después de la primera descarga. El preprocesado replica el de entrenamiento: la imagen entera encajada en 224×224 sobre el color medio (letterbox) y normalización ImageNet.

El analizador promedia las probabilidades de todas las fotos de la prenda, elige la categoría y busca la subcategoría solo entre las de esa categoría; las alternativas se ordenan por P(categoría) × P(subcategoría | categoría). Rellena categoría, subcategoría y estampado, y muestra como información la manga (prendas superiores, vestidos y abrigos) y el corte (pantalones, vaqueros, chándal y leggings), que la prenda no guarda como campos. Las reglas salen de `ml/taxonomy.json`, las mismas que usa el entrenamiento; la app rechaza un modelo exportado con otra versión de taxonomía. Las puntuaciones no están calibradas y siempre son sugerencias editables. Formalidad, temporadas y color no se predicen todavía: el color sigue saliendo del muestreo de píxeles.

**Calidad (heads-v4, test de 2.987 imágenes de las fuentes de entrenamiento):** categoría 92,8 %, subcategoría 80,3 % (macro-F1 0,73), manga 88,1 %, estampado 85,3 %, corte 63,4 %. La cuantización int8 pierde como mucho ~1,5 puntos frente a fp32. El detalle por clase y las clases flojas están en [`ml/README.md`](ml/README.md). Con las cuatro fotos de `public/test-photos`, en el navegador: camiseta blanca → Camiseta, chaqueta azul → Chaqueta, chaqueta verde → Chaqueta, sudadera verde → Sudadera con capucha (Wargon, el modelo anterior, confundía la chaqueta verde con una sudadera). La primera foto tardó ~9,6 s, incluida la descarga y la carga del modelo; las siguientes, 0,6–1 s cada una en este equipo. No se ha medido en móviles.

La aplicación sirve el ONNX desde su propio origen. Las imágenes se decodifican y procesan localmente: no se envían las fotos, las predicciones ni el inventario.

El formulario acepta hasta cuatro fotos JPG, PNG o WebP, de hasta 8 MB cada una. Se guardan con la prenda y se pueden consultar desde su detalle; la primera es la portada y se puede cambiar al editar. Son vistas de una misma prenda: varias fotos pueden mejorar la evidencia visual, pero no añaden capacidades nuevas de detección. La estimación de color muestrea píxeles locales de cada foto, reduce bordes y descuenta el color de fondo más común en el perímetro; propone hasta tres colores por frecuencia. Es una heurística, no segmentación de prendas; fondos complejos pueden alterarla. Las correcciones y el identificador/versión del modelo, puntuaciones, sugerencias y atributos no detectados se guardan junto con la prenda en IndexedDB. Las prendas analizadas con versiones anteriores (Wargon, CLIP) conservan su procedencia.

**Límites:** el test procede de las mismas fuentes que el entrenamiento (sobre todo recortes de personas de Fashionpedia y fotos de producto); con fotos propias solo hay 29 de referencia. Solo se predice una prenda por imagen; prendas múltiples, oclusiones y fondos complejos pueden fallar. La siguiente validación debe ampliar el conjunto de fotos propias y medir rendimiento y memoria en móviles.

## Modelo propio

[`ml/`](ml/README.md) contiene todo el proceso del modelo: taxonomía compartida con la app ([`ml/taxonomy.json`](ml/taxonomy.json)), preparación de datos con licencia comercial (Clothing Dataset, Fashionpedia, Open Images, Unsplash/Pexels y fotos propias), revisión de etiquetas, entrenamiento, evaluación y exportación. El botón **Exportar datos de entrenamiento** del Armario genera en el navegador un ZIP con las fotos y sus etiquetas normalizadas, sin nombre, marca, talla ni notas.

## Almacenamiento y privacidad

Los datos se guardan en IndexedDB del perfil del navegador y las imágenes permanecen como `Blob` local. Los object URLs de miniaturas y previsualizaciones se revocan al actualizar o desmontar sus vistas. La aplicación no incorpora backend, inicio de sesión ni analítica. Pattern Waves usa WebGL local; los componentes Masonry y Pill Nav no envían datos. El análisis utiliza el modelo ONNX servido desde el mismo origen, sin enviar la fotografía. La función meteorológica es opcional: al usarla, el nombre de la ciudad y las coordenadas resueltas se consultan a Open-Meteo; el inventario, las preferencias y las fotografías no se incluyen en esas solicitudes. La política CSP permite conexiones únicamente al origen propio, y a los hosts de Open-Meteo usados por el pronóstico; el modelo se sirve desde el propio origen. La configuración PWA precachea recursos estáticos de la aplicación, pero no el modelo ni los datos personales. Esto describe el diseño del código; no constituye una auditoría de tráfico ni una prueba de red completa.

Limpiar los datos del sitio o usar otro navegador/perfil elimina o separa el inventario. IndexedDB no implica cifrado en reposo. La solicitud de almacenamiento persistente es opcional y depende del soporte y decisión del navegador.

La planificación de maleta requiere conexión para consultar la previsión de Open-Meteo. El pronóstico disponible depende del destino y de las fechas que cubra el proveedor; las combinaciones son sugerencias heurísticas, no una predicción de uso real. Las selecciones de la lista se mantienen en la pantalla actual y no se sincronizan ni se envían.

## Pruebas

```sh
npm test
npm run build
```

## TODOs y revisión del proyecto

### Completado

- [x] Navegación principal Armario, Outfits y Maleta; el alta de prendas está dentro de Armario.
- [x] Outfits manuales y generados, guardados locales y feedback.
- [x] Consulta de Open-Meteo para outfits de mañana y planificación de maleta.
- [x] Swipe en móvil con botones alternativos accesibles.
- [x] Galería incremental de 40 prendas por tanda.
- [x] CSP con permisos explícitos para las APIs de geocodificación y previsión de Open-Meteo.

### Pendiente

- [ ] Completar la optimización del inventario: separar metadatos e imágenes en IndexedDB, cargar las miniaturas bajo demanda y medir el rendimiento con armarios grandes.
- [ ] Guardar los planes de viaje y sus listas de maleta en IndexedDB para poder consultarlos después.
- [ ] Definir una fuente fiable y una política de actualización para las tendencias antes de crear esa pantalla; indicar siempre la fuente y la fecha de los datos.
- [ ] Validar el planificador meteorológico y las recomendaciones con más destinos, fechas, tamaños de armario y prendas sin atributos completos.
- [ ] Revisar la distribución responsive y la navegación con pruebas de usabilidad en móvil y escritorio.
- [ ] Analizar la división de los paquetes JavaScript de inferencia; la compilación advierte un chunk de Transformers superior a 500 kB.
