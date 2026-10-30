# VESTA — Armario virtual

Armario virtual *local-first*: catalogas tus prendas con una foto, generas outfits según la ocasión y el tiempo, y preparas la maleta de un viaje. No hay cuenta, servidor ni analítica: prendas, fotos y outfits se guardan en el navegador (IndexedDB), y el análisis de las fotos se hace en el propio dispositivo con un modelo de IA propio.

> **Licencia:** software propietario, todos los derechos reservados. Ver [LICENSE](LICENSE) y [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Funcionalidades

### Armario
- Galería tipo *masonry* con búsqueda (nombre, código, categoría, color…) y filtro por categoría; carga 40 prendas por tanda.
- Hasta 4 fotos por prenda (JPG, PNG o WebP de hasta 8 MB), con portada elegible y miniaturas locales de 640 px como máximo.
- **Código único por prenda** según su tipo, como `SDC-002` (sudadera con capucha nº 2) o `VAQ-001`, para distinguir prendas parecidas. No cambia al editar la prenda y no se reutiliza al borrarla.
- Detalle de cada prenda con sus fotos, la foto de la etiqueta, los atributos y la procedencia del análisis; edición y borrado.

### Catalogación automática
Al añadir o cambiar fotos, la app propone los campos y marca cada uno como **Sugerido** hasta que lo revisas:
- **Categoría, subcategoría y estampado** con el modelo propio de VESTA, combinando todas las fotos de la prenda, más tres alternativas para elegir con un toque. Informa también de la manga y del corte del pantalón.
- **Confianza calibrada:** un 80 % acierta aproximadamente 8 de cada 10 veces.
- **Color** por análisis de píxeles (hasta tres colores).
- **Marca** si aparece escrita en la prenda (lengüeta, talón, pecho).
- **Foto de la etiqueta** en un campo propio: de ella se leen marca, talla y composición. Solo pasa por el lector de texto, así que no altera la clasificación de la prenda.
- **Temporadas, estilo y estética** sugeridos por reglas según el tipo de prenda, la manga y la composición.
- **Nombre** propuesto con subcategoría, colores y marca (p. ej. «Camiseta blanca · Zara»).

El **estilo** es el nivel de vestir en cuatro niveles (Deportivo, Diario, Arreglado y Formal), y cada prenda marca todos los que le encajan: una camisa blanca vale de Diario a Formal y unos vaqueros, de Diario a Arreglado. La **estética** (Minimalista, Clásico, Urbano, Vintage…) es libre y opcional.

### Outfits
- Generador con prendas reales, que puntúa cada combinación según la ocasión (Diario, Arreglado, Formal, Deportivo, Frío y capas, Calor y pocas capas), el tiempo, los colores y estampados, tus preferencias, el feedback y la rotación.
- Tiempo de mañana opcional desde Open-Meteo por ciudad.
- Valoración con botones o deslizando en el móvil, favoritos, historial de «usado» y outfits creados a mano.
- Prendas marcadas como no disponibles (por ejemplo, en la lavadora) excluidas de las propuestas.
- Preferencias de colores, estéticas y estilo.

### Maleta
- Plan de hasta 14 días para una ciudad y una fecha: un outfit por día según la previsión y una lista de equipaje única y editable. Los planes aún no se guardan.

### Datos para entrenar el modelo
- El botón **Exportar datos de entrenamiento** genera en el navegador un ZIP con las fotos y sus etiquetas normalizadas, sin nombre, marca, talla, notas ni foto de la etiqueta.

## Privacidad

- Prendas, fotos, outfits y preferencias se guardan solo en IndexedDB, en tu navegador. No hay backend, inicio de sesión ni analítica.
- Los modelos (clasificador y lector de texto) se sirven desde el propio origen y se ejecutan en el dispositivo con WebAssembly: **las fotos y las predicciones no salen del navegador**.
- La única conexión externa es Open-Meteo, cuando consultas el tiempo: recibe el nombre de la ciudad y sus coordenadas, nunca el inventario ni las fotos.
- La política CSP solo permite conexiones al propio origen y a Open-Meteo.
- La PWA precachea la interfaz, pero no los modelos ni los datos personales. Los modelos se guardan en Cache Storage tras la primera descarga, para funcionar sin conexión.

Esto describe el diseño del código; no es una auditoría de tráfico.

**Pérdida de datos:** limpiar los datos del sitio, usar otro navegador o perfil, o la purga automática de algunos navegadores (Safari) borra o separa el armario. IndexedDB no cifra los datos. Todavía no hay copia de seguridad ni exportación completa del armario (está en la hoja de ruta).

## Puesta en marcha

Requisitos: Node.js 20.19+ o 22.12+, y npm.

```sh
npm install
npm run dev        # servidor de desarrollo
npm test           # pruebas (Vitest, jsdom, fake-indexeddb)
npm run build      # comprobación de TypeScript y compilación con Vite
npm run preview    # previsualizar la compilación
```

## Arquitectura

React 19, TypeScript y Vite; Dexie sobre IndexedDB; PWA con `vite-plugin-pwa`; inferencia con `onnxruntime-web` (WebAssembly). La interfaz usa componentes de React Bits (Masonry, Pill Nav y el fondo Pattern Waves con OGL, que se detiene si el sistema prefiere movimiento reducido) e iconos de Hugeicons.

| Carpeta | Contenido |
|---|---|
| `src/app/` | Pantallas, navegación y estado |
| `src/components/` | Formulario y detalle de prenda, galería, generador de outfits, maleta |
| `src/ai/` | Clasificador ONNX, lector de texto (OCR), marcas, talla y composición, reglas de uso, color |
| `src/db/` | Base de datos Dexie, repositorio de prendas, códigos y miniaturas |
| `src/outfits/` | Generación y puntuación de outfits |
| `src/weather/` | Cliente de Open-Meteo |
| `src/ml/` | Taxonomía compartida con el entrenamiento y exportación de datos |
| `ml/` | Entrenamiento, evaluación y exportación del modelo propio (Python) |
| `public/models/` | Modelos ONNX del clasificador y del OCR, con sus avisos de licencia |

### Base de datos

La base local se llama `vesta-wardrobe` y está en la versión 6:

| Almacén | Índices | Contenido |
|---|---|---|
| `garments` | `id`, `category`, `name`, `updatedAt`, `&code` | Prendas con atributos, código, fotos, foto de la etiqueta y miniatura (`Blob`) |
| `garmentCodeCounters` | `prefix` | Último número dado a cada prefijo de código |
| `outfits` | `id`, `createdAt`, `favorite`, `kind` | Outfits generados y manuales guardados, con historial de uso |
| `preferences` | `id` | Preferencias del generador |
| `outfitFeedback` | `id`, `type`, `createdAt` | Valoraciones que ajustan las puntuaciones |
| `trendPacks` | `id`, `version`, `publishedAt` | Reservado para tendencias (sin pantalla todavía) |

Las migraciones conservan los datos: v2 añade dimensiones a prendas antiguas; v3, el feedback; v4, el tipo de outfit; v5, los códigos de prenda (asignados por fecha de alta) y sus contadores; v6 convierte la formalidad anterior en niveles de estilo (Casual → Diario, Smart casual → Arreglado, Formal → Formal), también en las preferencias y en los outfits guardados. Las imágenes aún van dentro del registro de cada prenda, así que leer el armario carga todos los `Blob`.

## Modelos de IA

### Clasificador de prendas
- **Modelo:** propio de VESTA, entrenado en [`ml/`](ml/README.md). Es DINOv2 ViT-S/14 (Meta, Apache-2.0) congelado, más cabezas de categoría, subcategoría, manga, corte de pantalón y estampado, con la taxonomía de la app ([`ml/taxonomy.json`](ml/taxonomy.json)).
- **Datos:** solo con licencia que permite uso comercial (Clothing Dataset, Fashionpedia, Open Images, Unsplash, Pexels y fotos propias).
- **Formato:** un único ONNX int8 de ~25,6 MB en `public/models/vesta/`, con `vesta-model.json` (salidas, preprocesado, reglas y temperaturas de calibración).
- **Cómo combina las fotos:** promedia las probabilidades de todas las fotos, elige la categoría y busca la subcategoría solo dentro de ella; las alternativas se ordenan por P(categoría) × P(subcategoría | categoría). La app rechaza un modelo exportado con otra versión de taxonomía.
- **Calidad** (heads-v4, test de 2.987 imágenes de las fuentes de entrenamiento): categoría 92,8 %, subcategoría 80,3 % (macro-F1 0,73), manga 88,1 %, estampado 85,3 %, corte 63,4 %. El detalle por clase está en [`ml/README.md`](ml/README.md).
- **Velocidad** en el equipo de desarrollo: la primera foto tarda ~10 s (descarga y carga del modelo); las siguientes, 0,6–1 s. No se ha medido en móviles.

### Lector de texto (OCR)
- **Modelos:** PaddleOCR PP-OCRv5 mobile (Apache-2.0), con un detector de 4,8 MB y un reconocedor de alfabeto latino de 8 MB, en `public/models/ocr/`. Tarda 1–2 s por foto, en paralelo con el clasificador.
- **Marca:** [`src/ai/brands.ts`](src/ai/brands.ts) compara el texto con ~95 marcas. Admite letras separadas (N I K E) y una letra mal leída en nombres largos; los logos sin letras no se reconocen.
- **Talla y composición:** [`src/ai/labelParser.ts`](src/ai/labelParser.ts) extrae la talla en letras (XS–4XL), en número europeo (EUR 42, T. 38) o de vaquero (W32 L34), y elige según la categoría: número en calzado, letra en prendas superiores. También extrae la composición en varios idiomas, traducida al español («95 % algodón, 5 % elastano»). Las tallas US/UK no se convierten.
- **Requisito:** necesita una foto cercana, recta y con buena luz; si no, el campo se deja vacío.

### Reglas sin modelo
- **Color:** muestrea los píxeles del centro de cada foto, descuenta el color de fondo dominante en el borde y nombra el color más frecuente. Es una heurística, no segmentación: los fondos complejos, las sombras y las prendas de varios colores la confunden.
- **Uso:** [`src/ai/usageRules.ts`](src/ai/usageRules.ts) sugiere temporadas, estilo y estética según el tipo de prenda (plumífero → otoño e invierno; manga corta → primavera y verano; lana → sin verano; blazer → Arreglado y Formal…).

### Límites conocidos
- El test procede de las mismas fuentes que el entrenamiento; con fotos propias solo hay 29 de referencia.
- Una prenda por foto: varias prendas, oclusiones o fondos complejos pueden fallar.
- El corte de pantalón «campana» aún no se aprende.
- Faltan pruebas con etiquetas reales y en móviles.

## Hoja de ruta

- [ ] Exportar e importar el armario completo (JSON + imágenes), como copia de seguridad y para cambiar de dispositivo.
- [ ] Segmentación: añadir prendas desde una foto de cuerpo entero y guardar también el look; quitar el fondo de las fotos (con modelos de licencia comercial).
- [ ] «Me lo pongo hoy» con calendario, y estadísticas (coste por uso, prendas olvidadas, colores, marcas).
- [ ] Separar metadatos e imágenes en IndexedDB y cargar miniaturas bajo demanda.
- [ ] Copia de seguridad opcional en el Google Drive del propio usuario.
- [ ] Capa opcional de lenguaje natural para explicar y ordenar outfits, enviando solo texto.
- [ ] Guardar los planes de viaje.
- [ ] Tendencias, con una fuente fiable y fechada.
- [ ] Dividir el bloque principal de JavaScript (533 kB, que supera el aviso de 500 kB de Vite).
- [ ] Probar la usabilidad en móvil y escritorio, y validar el generador con armarios grandes e incompletos.

## Licencia

Copyright © 2026 Ximo Martínez. Todos los derechos reservados. Que el código sea visible no concede ninguna licencia de uso, copia, modificación ni distribución; ver [LICENSE](LICENSE). Los componentes de terceros (DINOv2, PaddleOCR, bibliotecas y datos de entrenamiento) conservan sus licencias, recogidas en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
