// @vitest-environment node
// Node Blobs: jsdom ones do not survive the structured clone of fake-indexeddb with their contents.
import { afterEach, describe, expect, it } from 'vitest'
import { blobBytes, createZip, crc32, readZip } from '../ml/zip'
import type { Garment, Outfit } from '../types/domain'
import { database } from './database'
import { garmentRepository } from './garmentRepository'
import { createWardrobeBackup, importWardrobeBackup, readWardrobeBackup } from './wardrobeBackup'

const makeGarment = (id: string, extras: Partial<Garment> = {}): Garment => ({
  id,
  name: `Prenda ${id}`,
  category: 'Parte superior',
  subcategory: 'Sudadera con capucha',
  colors: ['Gris'],
  seasons: ['Invierno'],
  styles: [],
  dressLevels: ['Diario'],
  role: 'Top',
  image: new Blob([`foto ${id}`], { type: 'image/jpeg' }),
  thumbnail: new Blob([`miniatura ${id}`], { type: 'image/jpeg' }),
  width: 640,
  height: 800,
  confirmedAttributes: [],
  suggestedAttributes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extras
})

const outfit = (id: string, garmentIds: string[]): Outfit => ({
  id, garmentIds, occasion: 'Diario', score: 80, createdAt: '2026-01-02T00:00:00.000Z', favorite: true
})

async function text(blob: Blob | undefined) {
  return new TextDecoder().decode(await blobBytes(blob!))
}

async function clearAll() {
  await Promise.all([database.garments, database.garmentCodeCounters, database.outfits, database.preferences,
    database.outfitFeedback, database.trendPacks].map((table) => table.clear()))
}

afterEach(clearAll)

describe('wardrobe backup', () => {
  it('restores garments with every photo, outfits, preferences and code counters', async () => {
    await garmentRepository.create(makeGarment('a', {
      additionalImages: [new Blob(['espalda'], { type: 'image/png' })],
      labelImage: new Blob(['etiqueta'], { type: 'image/webp' })
    }))
    await garmentRepository.create(makeGarment('b'))
    await garmentRepository.remove('b') // SDC-002 must never be given again
    await database.outfits.add(outfit('o1', ['a']))
    await database.preferences.put({ id: 'current', preferredColors: ['Gris'], preferredStyles: [], feedbackWeights: {}, updatedAt: '' })

    const archive = await createWardrobeBackup(new Date('2026-10-30T12:00:00Z'))
    await clearAll()
    const backup = await readWardrobeBackup(archive)
    expect(backup.exportedAt).toBe('2026-10-30T12:00:00.000Z')
    expect(await importWardrobeBackup(backup, 'replace')).toMatchObject({ added: 1, outfits: 1 })

    const restored = await database.garments.get('a')
    expect(restored).toMatchObject({ code: 'SDC-001', name: 'Prenda a', dressLevels: ['Diario'] })
    expect(await text(restored?.image)).toBe('foto a')
    expect(await text(restored?.thumbnail)).toBe('miniatura a')
    expect(await text(restored?.additionalImages?.[0])).toBe('espalda')
    expect(restored?.additionalImages?.[0]?.type).toBe('image/png')
    expect(await text(restored?.labelImage)).toBe('etiqueta')
    expect(await database.outfits.get('o1')).toMatchObject({ garmentIds: ['a'] })
    expect(await database.preferences.get('current')).toMatchObject({ preferredColors: ['Gris'] })
    await garmentRepository.create(makeGarment('c'))
    expect((await database.garments.get('c'))?.code).toBe('SDC-003')
  })

  it('merges keeping the newer version of each garment and giving a new code when one is taken', async () => {
    await garmentRepository.create(makeGarment('shared'))
    await garmentRepository.create(makeGarment('elsewhere'))
    const archive = await createWardrobeBackup()
    await clearAll()

    // On this device: an older copy of «shared» and a different garment that also got SDC-002.
    await garmentRepository.create(makeGarment('shared', { name: 'Antigua' }))
    await garmentRepository.create(makeGarment('local'))
    await garmentRepository.update({ ...makeGarment('shared'), name: 'Antigua', updatedAt: '2025-12-31T00:00:00.000Z' })
    const backup = await readWardrobeBackup(archive)
    backup.garments = backup.garments.map((garment) => garment.id === 'shared'
      ? { ...garment, name: 'Nueva', updatedAt: '2026-02-01T00:00:00.000Z' }
      : garment)
    backup.outfits = [outfit('o2', ['elsewhere'])]

    expect(await importWardrobeBackup(backup, 'merge')).toEqual({ added: 1, updated: 1, unchanged: 0, recoded: 1, outfits: 1 })
    expect(await database.garments.get('shared')).toMatchObject({ name: 'Nueva', code: 'SDC-001' })
    expect((await database.garments.get('local'))?.code).toBe('SDC-002')
    expect((await database.garments.get('elsewhere'))?.code).toBe('SDC-003')
    expect(await database.garments.count()).toBe(3)
    expect(await importWardrobeBackup(await readWardrobeBackup(archive), 'merge')).toMatchObject({ added: 0, unchanged: 2 })
  })

  it('rejects files that are not a backup or come from a newer app', async () => {
    await expect(readWardrobeBackup(new Blob(['hola']))).rejects.toThrow('no es una copia del armario')
    const encoder = new TextEncoder()
    const other = createZip([{ name: 'export.json', data: encoder.encode('{}') }])
    await expect(readWardrobeBackup(other)).rejects.toThrow('no es una copia del armario')
    const newer = createZip([{ name: 'backup.json', data: encoder.encode(JSON.stringify({
      format: 'vesta-wardrobe-backup', version: 99, databaseVersion: 1, garments: []
    })) }])
    await expect(readWardrobeBackup(newer)).rejects.toThrow('versión más reciente')
  })
})

describe('zip reader', () => {
  it('reads stored and deflated entries and checks their CRC', async () => {
    const data = new TextEncoder().encode('copia '.repeat(50))
    const stored = await readZip(createZip([{ name: 'a.txt', data }]))
    expect(new TextDecoder().decode(stored.get('a.txt'))).toBe('copia '.repeat(50))

    // A deflated entry, as written by the zip tools of the operating system.
    const deflated = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    const zip = new Uint8Array(await blobBytes(createZip([{ name: 'a.txt', data: deflated }])))
    const view = new DataView(zip.buffer)
    const centralOffset = view.getUint32(zip.length - 6, true)
    for (const header of [0, centralOffset]) {
      const field = header === 0 ? 8 : 10
      view.setUint16(header + field, 8, true) // method: deflate
      view.setUint32(header + field + 6, crc32(data), true)
      view.setUint32(header + field + 14, data.length, true) // uncompressed size
    }
    const read = await readZip(new Blob([zip]))
    expect(new TextDecoder().decode(read.get('a.txt'))).toBe('copia '.repeat(50))

    view.setUint32(centralOffset + 16, 1, true)
    await expect(readZip(new Blob([zip]))).rejects.toThrow('dañado')
  })
})
