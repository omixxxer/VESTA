import Dexie, { type EntityTable } from 'dexie'
import type { DressLevel, Garment, LegacyFormality, Outfit, OutfitFeedback, TrendPack, UserPreferences } from '../types/domain'
import { assignMissingCodes, codeCounters } from './garmentCodes'

const levelOfFormality: Record<LegacyFormality, DressLevel> = { Casual: 'Diario', 'Smart casual': 'Arreglado', Formal: 'Formal' }
const occasionOfFormality: Record<string, string> = { Casual: 'Diario', 'Smart casual': 'Arreglado' }

export class WardrobeDatabase extends Dexie {
  garments!: EntityTable<Garment, 'id'>
  outfits!: EntityTable<Outfit, 'id'>
  preferences!: EntityTable<UserPreferences, 'id'>
  trendPacks!: EntityTable<TrendPack, 'id'>
  outfitFeedback!: EntityTable<OutfitFeedback, 'id'>
  /** Highest number given per code prefix, so a deleted garment's code is never given to another one. */
  garmentCodeCounters!: EntityTable<{ prefix: string; last: number }, 'prefix'>

  constructor() {
    super('vesta-wardrobe')
    this.version(1).stores({
      garments: 'id, category, name, updatedAt',
      outfits: 'id, createdAt, favorite',
      preferences: 'id',
      trendPacks: 'id, version, publishedAt'
    })
    this.version(2)
      .stores({
        garments: 'id, category, name, updatedAt',
        outfits: 'id, createdAt, favorite',
        preferences: 'id',
        trendPacks: 'id, version, publishedAt'
      })
      .upgrade(async (transaction) => {
        await transaction.table('garments').toCollection().modify((garment: Partial<Garment>) => {
          garment.width ??= 0
          garment.height ??= 0
        })
      })
    this.version(3).stores({
      garments: 'id, category, name, updatedAt',
      outfits: 'id, createdAt, favorite',
      preferences: 'id',
      trendPacks: 'id, version, publishedAt',
      outfitFeedback: 'id, type, createdAt'
    })
    this.version(4).stores({
      garments: 'id, category, name, updatedAt',
      outfits: 'id, createdAt, favorite, kind',
      preferences: 'id',
      trendPacks: 'id, version, publishedAt',
      outfitFeedback: 'id, type, createdAt'
    })
    this.version(5)
      .stores({
        garments: 'id, category, name, updatedAt, &code',
        outfits: 'id, createdAt, favorite, kind',
        preferences: 'id',
        trendPacks: 'id, version, publishedAt',
        outfitFeedback: 'id, type, createdAt',
        garmentCodeCounters: 'prefix'
      })
      .upgrade(async (transaction) => {
        // Two streaming passes, so the photos of every garment are not held in memory at once.
        const table = transaction.table('garments')
        const summaries: Array<Pick<Garment, 'id' | 'category' | 'subcategory' | 'createdAt'> & { code?: string }> = []
        await table.each((garment: Garment) => {
          summaries.push({ id: garment.id, category: garment.category, subcategory: garment.subcategory, createdAt: garment.createdAt, code: garment.code })
        })
        const codes = assignMissingCodes(summaries)
        await table.toCollection().modify((garment: Garment) => {
          const code = codes.get(garment.id)
          if (code) garment.code = code
        })
        await transaction.table('garmentCodeCounters').bulkPut(codeCounters(codes.values()))
      })
    // The single formality (Casual / Smart casual / Formal) becomes a list of dress levels.
    this.version(6)
      .stores({
        garments: 'id, category, name, updatedAt, &code',
        outfits: 'id, createdAt, favorite, kind',
        preferences: 'id',
        trendPacks: 'id, version, publishedAt',
        outfitFeedback: 'id, type, createdAt',
        garmentCodeCounters: 'prefix'
      })
      .upgrade(async (transaction) => {
        await transaction.table('garments').toCollection().modify((garment: Garment & { formality?: LegacyFormality }) => {
          const level = garment.formality && levelOfFormality[garment.formality]
          garment.dressLevels ??= level ? [level] : []
          delete garment.formality
        })
        await transaction.table('preferences').toCollection().modify((preferences: UserPreferences & { preferredFormality?: LegacyFormality }) => {
          const level = preferences.preferredFormality && levelOfFormality[preferences.preferredFormality]
          if (level) preferences.preferredDressLevel = level
          delete preferences.preferredFormality
        })
        await transaction.table('outfits').toCollection().modify((outfit: Outfit) => {
          outfit.occasion = occasionOfFormality[outfit.occasion] ?? outfit.occasion
        })
      })
  }
}

export const database = new WardrobeDatabase()
