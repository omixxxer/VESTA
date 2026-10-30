import { database } from './database'
import { codePrefix, nextCode } from './garmentCodes'
import type { Garment } from '../types/domain'

/** The next code for the garment's type; call inside a transaction over garments and garmentCodeCounters. */
async function newCode(garment: Garment): Promise<string> {
  const prefix = codePrefix(garment)
  // The unique index lists the codes without loading the garments and their photos.
  const codes = await database.garments.where('code').startsWith(`${prefix}-`).keys()
  const counter = await database.garmentCodeCounters.get(prefix)
  const code = nextCode(prefix, codes as string[], counter?.last)
  await database.garmentCodeCounters.put({ prefix, last: Number(code.slice(prefix.length + 1)) })
  return code
}

export const garmentRepository = {
  list: () => database.garments.orderBy('updatedAt').reverse().toArray(),
  get: (id: string) => database.garments.get(id),
  /** Gives the garment its code (e.g. SUD-002) in the same transaction, so two saves cannot take the same one. */
  create: (garment: Garment) => database.transaction('rw', database.garments, database.garmentCodeCounters, async () => {
    const code = await newCode(garment)
    await database.garments.add({ ...garment, code })
    return code
  }),
  /** A garment keeps its code when edited, even if its type changes. */
  update: (garment: Garment) => database.transaction('rw', database.garments, database.garmentCodeCounters, async () => {
    const code = garment.code ?? (await database.garments.get(garment.id))?.code ?? await newCode(garment)
    return database.garments.put({ ...garment, code })
  }),
  remove: (id: string) => database.garments.delete(id),
  count: () => database.garments.count()
}
