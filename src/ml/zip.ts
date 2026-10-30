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
