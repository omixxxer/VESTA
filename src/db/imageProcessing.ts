const MAX_THUMBNAIL_EDGE = 640
const THUMBNAIL_QUALITY = 0.84
// Photos are stored reduced: a phone photo (~3 MB) becomes ~0.3–0.5 MB, which keeps a large wardrobe and its
// backup manageable. 2048 px is far above what the classifier (224 px) and the label reader (960 px) use.
const MAX_PHOTO_EDGE = 2048
const PHOTO_QUALITY = 0.85
const KEEP_PHOTOS_UNDER_BYTES = 1024 * 1024

interface ImageSize {
  width: number
  height: number
}

function loadImage(blob: Blob): Promise<{ image: CanvasImageSource; size: ImageSize; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob).then((bitmap) => ({
      image: bitmap,
      size: { width: bitmap.width, height: bitmap.height },
      close: () => bitmap.close()
    }))
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({
        image,
        size: { width: image.naturalWidth, height: image.naturalHeight },
        close: () => undefined
      })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la fotografía.'))
    }
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('No se pudo procesar la fotografía.'))
    }, 'image/jpeg', quality)
  })
}

/** Draws the image scaled into a new canvas; transparent areas become white, as JPEG has no transparency. */
function drawScaled(image: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('El navegador no permite procesar la fotografía.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  return canvas
}

/** The size a photo is stored at, or undefined when the original file is kept (small enough already). */
export function reducedSize(width: number, height: number, bytes: number): ImageSize | undefined {
  const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(width, height))
  if (scale === 1 && bytes <= KEEP_PHOTOS_UNDER_BYTES) return undefined
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** The photo as it is stored: at most 2048 px per side, re-encoded as JPEG unless it is already small. */
export async function reducePhoto(blob: Blob): Promise<Blob> {
  const decoded = await loadImage(blob)
  try {
    const target = reducedSize(decoded.size.width, decoded.size.height, blob.size)
    if (!target) return blob
    const reduced = await canvasToBlob(drawScaled(decoded.image, target.width, target.height), PHOTO_QUALITY)
    // A photo within the size limit is only re-encoded if that makes it lighter.
    const resized = target.width !== decoded.size.width || target.height !== decoded.size.height
    return resized || reduced.size < blob.size ? reduced : blob
  } finally {
    decoded.close()
  }
}

export async function createThumbnail(blob: Blob): Promise<ImageSize & { thumbnail: Blob }> {
  const decoded = await loadImage(blob)
  try {
    const { width, height } = decoded.size
    if (!width || !height) throw new Error('La fotografía no tiene dimensiones válidas.')

    const scale = Math.min(1, MAX_THUMBNAIL_EDGE / Math.max(width, height))
    const canvas = drawScaled(decoded.image, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
    return { thumbnail: await canvasToBlob(canvas, THUMBNAIL_QUALITY), width, height }
  } finally {
    decoded.close()
  }
}
