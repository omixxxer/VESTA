import { database } from './database'
import type { Garment } from '../types/domain'

export const garmentRepository = {
  list: () => database.garments.orderBy('updatedAt').reverse().toArray(),
  get: (id: string) => database.garments.get(id),
  create: (garment: Garment) => database.garments.add(garment),
  update: (garment: Garment) => database.garments.put(garment),
  remove: (id: string) => database.garments.delete(id),
  count: () => database.garments.count()
}
