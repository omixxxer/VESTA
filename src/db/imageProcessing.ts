const MAX_THUMBNAIL_EDGE = 640
const THUMBNAIL_QUALITY = 0.84

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

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('No se pudo generar la miniatura.'))
    }, 'image/jpeg', THUMBNAIL_QUALITY)
  })
}

export async function createThumbnail(blob: Blob): Promise<ImageSize & { thumbnail: Blob }> {
  const decoded = await loadImage(blob)
  try {
    const { width, height } = decoded.size
    if (!width || !height) throw new Error('La fotografía no tiene dimensiones válidas.')

    const scale = Math.min(1, MAX_THUMBNAIL_EDGE / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('El navegador no permite procesar la miniatura.')

    context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height)
    return { thumbnail: await canvasToBlob(canvas), width, height }
  } finally {
    decoded.close()
  }
}
