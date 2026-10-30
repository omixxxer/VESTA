import { blobBytes, createZip, readZip, type ZipEntry } from '../ml/zip'
import type { Garment, Outfit, OutfitFeedback, TrendPack, UserPreferences } from '../types/domain'
import { database } from './database'
import { codeCounters, codePrefix, nextCode } from './garmentCodes'

// A full copy of the wardrobe in one ZIP: backup.json holds every record, with the photos replaced by paths to
// separate files, so the same layout can later be synced file by file (e.g. to the user's own Drive).

export const BACKUP_FORMAT = 'vesta-wardrobe-backup'
export const BACKUP_VERSION = 1
const MANIFEST = 'backup.json'

type PhotoField = 'image' | 'thumbnail' | 'labelImage'

interface PhotoReference {
  path: string
  type: string
}

/** A garment as stored in backup.json: the same fields, with each photo replaced by a reference to its file. */
export type GarmentRecord = Omit<Garment, PhotoField | 'additionalImages'> & {
  photos: {
    image: PhotoReference
    thumbnail: PhotoReference
    additionalImages?: PhotoReference[]
    labelImage?: PhotoReference
  }
}

interface BackupManifest {
  format: typeof BACKUP_FORMAT
  version: number
  /** Dexie schema version of the app that wrote it; a newer one cannot be read by an older app. */
  databaseVersion: number
  exportedAt: string
  garments: GarmentRecord[]
  outfits: Outfit[]
  preferences: UserPreferences[]
  outfitFeedback: OutfitFeedback[]
  trendPacks: TrendPack[]
  garmentCodeCounters: Array<{ prefix: string; last: number }>
}

export interface WardrobeBackup {
  exportedAt: string
  garments: Garment[]
  outfits: Outfit[]
  preferences: UserPreferences[]
  outfitFeedback: OutfitFeedback[]
  trendPacks: TrendPack[]
  garmentCodeCounters: Array<{ prefix: string; last: number }>
}

export type ImportMode = 'replace' | 'merge'

export interface ImportSummary {
  added: number
  updated: number
  /** Garments already in the wardrobe with the same or a newer version. */
  unchanged: number
  /** Garments whose code was already used by another garment here and got a new one. */
  recoded: number
  outfits: number
}

const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export async function createWardrobeBackup(exportedAt = new Date()): Promise<Blob> {
  const files: ZipEntry[] = []
  const garments: GarmentRecord[] = []
  async function addPhoto(garmentId: string, name: string, photo: Blob): Promise<PhotoReference> {
    const path = `photos/${garmentId}/${name}.${extensions[photo.type] ?? 'bin'}`
    files.push({ name: path, data: await blobBytes(photo) })
    return { path, type: photo.type }
  }

  // One garment at a time, so the whole wardrobe's photos are not read twice into memory.
  for (const id of await database.garments.toCollection().primaryKeys()) {
    const garment = await database.garments.get(id)
    if (!garment) continue
    const { image, thumbnail, additionalImages, labelImage, ...fields } = garment
    garments.push({
      ...fields,
      photos: {
        image: await addPhoto(id, 'photo-0', image),
        thumbnail: await addPhoto(id, 'thumbnail', thumbnail),
        ...(additionalImages?.length
          ? { additionalImages: await Promise.all(additionalImages.map((photo, index) => addPhoto(id, `photo-${index + 1}`, photo))) }
          : {}),
        ...(labelImage ? { labelImage: await addPhoto(id, 'label', labelImage) } : {})
      }
    })
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    databaseVersion: database.verno,
    exportedAt: exportedAt.toISOString(),
    garments,
    outfits: await database.outfits.toArray(),
    preferences: await database.preferences.toArray(),
    outfitFeedback: await database.outfitFeedback.toArray(),
    trendPacks: await database.trendPacks.toArray(),
    garmentCodeCounters: await database.garmentCodeCounters.toArray()
  }
  return createZip([{ name: MANIFEST, data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }, ...files])
}

/** Reads and checks a backup file; nothing is written until importWardrobeBackup. */
export async function readWardrobeBackup(file: Blob): Promise<WardrobeBackup> {
  let entries: Map<string, Uint8Array>
  try {
    entries = await readZip(file)
  } catch {
    throw new Error('El archivo no es una copia del armario de VESTA o está dañado.')
  }
  const manifestBytes = entries.get(MANIFEST)
  let manifest: BackupManifest
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as BackupManifest
  } catch {
    throw new Error('El archivo no es una copia del armario de VESTA o está dañado.')
  }
  if (!manifestBytes || manifest.format !== BACKUP_FORMAT || !Array.isArray(manifest.garments)) {
    throw new Error('El archivo no es una copia del armario de VESTA.')
  }
  if (manifest.version > BACKUP_VERSION || manifest.databaseVersion > database.verno) {
    throw new Error('La copia se hizo con una versión más reciente de VESTA. Actualiza la app para importarla.')
  }

  const photo = (reference: PhotoReference): Blob => {
    const data = entries.get(reference.path)
    if (!data) throw new Error(`Falta la foto ${reference.path} en la copia.`)
    return new Blob([data as BlobPart], { type: reference.type })
  }
  const garments = manifest.garments.map(({ photos, ...fields }): Garment => ({
    ...fields,
    image: photo(photos.image),
    thumbnail: photo(photos.thumbnail),
    ...(photos.additionalImages ? { additionalImages: photos.additionalImages.map(photo) } : {}),
    ...(photos.labelImage ? { labelImage: photo(photos.labelImage) } : {})
  }))
  return {
    exportedAt: manifest.exportedAt,
    garments,
    outfits: manifest.outfits ?? [],
    preferences: manifest.preferences ?? [],
    outfitFeedback: manifest.outfitFeedback ?? [],
    trendPacks: manifest.trendPacks ?? [],
    garmentCodeCounters: manifest.garmentCodeCounters ?? []
  }
}

const tables = () => [
  database.garments,
  database.garmentCodeCounters,
  database.outfits,
  database.preferences,
  database.outfitFeedback,
  database.trendPacks
]

/**
 * replace: the wardrobe becomes exactly the backup. merge: garments, outfits and feedback missing here are added;
 * a garment present in both keeps the newer version (updatedAt) and its code here; local preferences stay.
 */
export async function importWardrobeBackup(backup: WardrobeBackup, mode: ImportMode): Promise<ImportSummary> {
  return database.transaction('rw', tables(), async () => {
    const summary: ImportSummary = { added: 0, updated: 0, unchanged: 0, recoded: 0, outfits: 0 }
    if (mode === 'replace') {
      await Promise.all(tables().map((table) => table.clear()))
      await database.garments.bulkAdd(backup.garments)
      await database.outfits.bulkAdd(backup.outfits)
      await database.preferences.bulkAdd(backup.preferences)
      await database.outfitFeedback.bulkAdd(backup.outfitFeedback)
      await database.trendPacks.bulkAdd(backup.trendPacks)
      await database.garmentCodeCounters.bulkPut(mergeCounters(backup.garmentCodeCounters, backup.garments.flatMap((garment) => garment.code ?? [])))
      return { ...summary, added: backup.garments.length, outfits: backup.outfits.length }
    }

    const backupCodes = backup.garments.flatMap((garment) => garment.code ?? [])
    for (const garment of backup.garments) {
      const existing = await database.garments.get(garment.id)
      if (existing) {
        if (garment.updatedAt > existing.updatedAt) {
          await database.garments.put({ ...garment, code: existing.code })
          summary.updated += 1
        } else {
          summary.unchanged += 1
        }
        continue
      }
      // A code is unique: if another garment here already has it (two devices both made a SDC-002), give a new one.
      const taken = garment.code ? await database.garments.where('code').equals(garment.code).count() : 1
      let code = garment.code
      if (taken) {
        const prefix = codePrefix(garment)
        const codes = await database.garments.where('code').startsWith(`${prefix}-`).keys()
        const counter = await database.garmentCodeCounters.get(prefix)
        // Codes of the backup's other garments count too, so a new code does not clash with one imported later.
        code = nextCode(prefix, [...codes as string[], ...backupCodes], counter?.last)
        if (garment.code) summary.recoded += 1
      }
      await database.garments.add({ ...garment, code })
      summary.added += 1
      const [counter] = codeCounters(code ? [code] : [])
      const current = counter && await database.garmentCodeCounters.get(counter.prefix)
      if (counter && (!current || current.last < counter.last)) await database.garmentCodeCounters.put(counter)
    }
    await database.garmentCodeCounters.bulkPut(mergeCounters(
      [...await database.garmentCodeCounters.toArray(), ...backup.garmentCodeCounters], []
    ))

    const knownOutfits = new Set(await database.outfits.toCollection().primaryKeys())
    const newOutfits = backup.outfits.filter((outfit) => !knownOutfits.has(outfit.id))
    await database.outfits.bulkAdd(newOutfits)
    summary.outfits = newOutfits.length
    const knownFeedback = new Set(await database.outfitFeedback.toCollection().primaryKeys())
    await database.outfitFeedback.bulkAdd(backup.outfitFeedback.filter((entry) => !knownFeedback.has(entry.id)))
    if (!(await database.preferences.count())) await database.preferences.bulkAdd(backup.preferences)
    const knownPacks = new Set(await database.trendPacks.toCollection().primaryKeys())
    await database.trendPacks.bulkAdd(backup.trendPacks.filter((pack) => !knownPacks.has(pack.id)))
    return summary
  })
}

/** The highest number per prefix among counter rows and codes, so no code is ever given twice. */
function mergeCounters(counters: Array<{ prefix: string; last: number }>, codes: string[]): Array<{ prefix: string; last: number }> {
  const last = new Map<string, number>()
  for (const counter of [...counters, ...codeCounters(codes)]) {
    last.set(counter.prefix, Math.max(last.get(counter.prefix) ?? 0, counter.last))
  }
  return [...last].map(([prefix, value]) => ({ prefix, last: value }))
}
