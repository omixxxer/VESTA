// Minimal ZIP writer (stored, no compression): photos are already compressed and this
// avoids a dependency for a single export feature.

export interface ZipEntry {
  name: string
  data: Uint8Array
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** The bytes of a blob; FileReader where Blob.arrayBuffer is missing (older WebViews, jsdom). */
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

export function createZip(entries: ZipEntry[]): Blob {
  const dosDate = (1 << 5) | 1 // 1980-01-01: entries carry no meaningful timestamps
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const checksum = crc32(entry.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(12, dosDate, true)
    local.setUint32(14, checksum, true)
    local.setUint32(18, entry.data.length, true)
    local.setUint32(22, entry.data.length, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, entry.data)

    const central = new DataView(new ArrayBuffer(46))
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)
    central.setUint16(6, 20, true)
    central.setUint16(8, 0x0800, true)
    central.setUint16(14, dosDate, true)
    central.setUint32(16, checksum, true)
    central.setUint32(20, entry.data.length, true)
    central.setUint32(24, entry.data.length, true)
    central.setUint16(28, name.length, true)
    central.setUint32(42, offset, true)
    directory.push(new Uint8Array(central.buffer), name)
    offset += 30 + name.length + entry.data.length
  }

  const directorySize = directory.reduce((total, part) => total + part.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, directorySize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...directory, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' })
}

/**
 * Reads the entries of a ZIP file. Handles stored entries (as written by createZip) and deflated ones (as written
 * by most zip tools, through the browser's DecompressionStream); checks each entry's CRC.
 */
export async function readZip(archive: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = await blobBytes(archive)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  // The end-of-central-directory record is the last 22 bytes, plus an optional comment of up to 64 KB.
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset
      break
    }
  }
  if (end < 0) throw new Error('El archivo no es un ZIP válido.')
  const count = view.getUint16(end + 10, true)
  let pointer = view.getUint32(end + 16, true)
  const decoder = new TextDecoder()
  const entries = new Map<string, Uint8Array>()
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error('El índice del ZIP está dañado.')
    const method = view.getUint16(pointer + 10, true)
    const checksum = view.getUint32(pointer + 16, true)
    const compressedSize = view.getUint32(pointer + 20, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    const localOffset = view.getUint32(pointer + 42, true)
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength))
    pointer += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue

    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true)
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
    let data: Uint8Array
    if (method === 0) {
      data = compressed
    } else if (method === 8) {
      const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      data = new Uint8Array(await new Response(stream).arrayBuffer())
    } else {
      throw new Error(`El ZIP usa un método de compresión no admitido en ${name}.`)
    }
    if (crc32(data) !== checksum) throw new Error(`El archivo ${name} del ZIP está dañado.`)
    entries.set(name, data)
  }
  return entries
}
