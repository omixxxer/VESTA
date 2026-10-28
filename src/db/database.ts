import Dexie, { type EntityTable } from 'dexie'
import type { Garment, Outfit, OutfitFeedback, TrendPack, UserPreferences } from '../types/domain'

export class WardrobeDatabase extends Dexie {
  garments!: EntityTable<Garment, 'id'>
  outfits!: EntityTable<Outfit, 'id'>
  preferences!: EntityTable<UserPreferences, 'id'>
  trendPacks!: EntityTable<TrendPack, 'id'>
  outfitFeedback!: EntityTable<OutfitFeedback, 'id'>

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
  }
}

export const database = new WardrobeDatabase()
