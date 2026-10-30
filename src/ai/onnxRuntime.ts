import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'

// Shared by the garment classifier and the text reader: one WebAssembly runtime, one model cache.
const MODEL_CACHE = 'vesta-model'

export type Ort = typeof import('onnxruntime-web/wasm')

let ortPromise: Promise<Ort> | undefined

export function loadOrt(): Promise<Ort> {
  ortPromise ??= import('onnxruntime-web/wasm').then((ort) => {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl }
    return ort
  }).catch((error: unknown) => {
    ortPromise = undefined
    throw error
  })
  return ortPromise
}

async function openCache(): Promise<Cache | undefined> {
  return typeof caches === 'undefined' ? undefined : caches.open(MODEL_CACHE).catch(() => undefined)
}

/** Model files are cached by URL (include a version in it), so they work offline after the first download. */
export async function fetchModelFile(url: string): Promise<ArrayBuffer> {
  const cache = await openCache()
  const cached = await cache?.match(url)
  if (cached) return cached.arrayBuffer()
  const response = await fetch(url)
  if (!response.ok) throw new Error(`No se pudo descargar el modelo (${response.status}).`)
  await cache?.put(url, response.clone()).catch(() => undefined)
  return response.arrayBuffer()
}

/** Small descriptions are fetched fresh when possible, so a new export is noticed; the cache covers offline use. */
export async function fetchDescription<T>(url: string): Promise<T> {
  const cache = await openCache()
  let response: Response | undefined
  try {
    response = await fetch(url, { cache: 'no-cache' })
    if (response.ok) await cache?.put(url, response.clone()).catch(() => undefined)
  } catch {
    response = undefined
  }
  if (!response?.ok) response = await cache?.match(url)
  if (!response?.ok) throw new Error('No se pudo cargar la descripción del modelo.')
  return response.json() as Promise<T>
}
