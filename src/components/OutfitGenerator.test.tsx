import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { database } from '../db/database'
import type { Garment } from '../types/domain'
import OutfitGenerator from './OutfitGenerator'

function makeGarment(id: string, role: Garment['role']): Garment {
  return {
    id,
    name: id,
    category: role === 'Top' ? 'Parte superior' : 'Parte inferior',
    subcategory: '',
    colors: ['Azul'],
    seasons: [],
    styles: [],
    dressLevels: ['Diario'],
    role,
    image: new Blob(['photo'], { type: 'image/png' }),
    thumbnail: new Blob(['thumbnail'], { type: 'image/png' }),
    width: 100,
    height: 100,
    confirmedAttributes: [],
    suggestedAttributes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

afterEach(async () => {
  await database.open()
  await Promise.all([
    database.garments.clear(),
    database.outfits.clear(),
    database.preferences.clear(),
    database.outfitFeedback.clear()
  ])
})

describe('OutfitGenerator', () => {
  it('generates only wardrobe photos and persists saved outfits and feedback locally', async () => {
    await database.open()
    const garments = [makeGarment('shirt', 'Top'), makeGarment('trousers', 'Bottom')]
    await database.garments.bulkAdd(garments)
    const user = userEvent.setup()
    const props = { garments, onAvailabilityChange: vi.fn().mockResolvedValue(undefined) }
    const rendered = render(<OutfitGenerator {...props} />)

    await user.click(screen.getByRole('button', { name: 'Generar outfits' }))
    // The score (a rolling Counter) uses the Spanish decimal comma.
    expect(await screen.findByRole('heading', { name: /Diario · \d+(?:,\d+)?\s?\/100/ })).toBeInTheDocument()
    expect((await screen.findAllByRole('img')).map((image) => image.getAttribute('alt'))).toEqual(['shirt', 'trousers'])

    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(async () => {
      expect(await database.outfits.toArray()).toEqual([
        expect.objectContaining({ garmentIds: ['shirt', 'trousers'], favorite: true })
      ])
      expect(await database.outfitFeedback.toArray()).toEqual([
        expect.objectContaining({ type: 'saved', garmentIds: ['shirt', 'trousers'] })
      ])
    })
    expect((await database.outfits.toArray()).filter((outfit) => outfit.favorite)).toHaveLength(1)
    await user.click(screen.getByRole('tab', { name: 'Guardados' }))
    expect(screen.getByRole('heading', { name: 'Outfits guardados' })).toBeInTheDocument()
    expect(screen.getByText(/GENERADO Y GUARDADO · \d+(?:\.\d+)?\/100/)).toBeInTheDocument()
    rendered.unmount()
    render(<OutfitGenerator {...props} />)
    await user.click(await screen.findByRole('tab', { name: 'Guardados' }))
    expect(await screen.findByRole('heading', { name: 'Outfits guardados' })).toBeInTheDocument()
  })

  it('creates a personal outfit from selected garments and persists it', async () => {
    await database.open()
    const garments = [makeGarment('shirt', 'Top'), makeGarment('trousers', 'Bottom')]
    const user = userEvent.setup()
    render(<OutfitGenerator garments={garments} onAvailabilityChange={vi.fn().mockResolvedValue(undefined)} />)

    await user.click(screen.getByRole('tab', { name: 'Crear outfit' }))
    await user.type(screen.getByLabelText('Nombre del outfit'), 'Mi conjunto')
    await user.click(screen.getByLabelText('shirt'))
    await user.click(screen.getByLabelText('trousers'))
    await user.click(screen.getByRole('button', { name: 'Guardar outfit' }))

    await waitFor(async () => expect(await database.outfits.toArray()).toEqual([
      expect.objectContaining({ name: 'Mi conjunto', kind: 'manual', garmentIds: ['shirt', 'trousers'] })
    ]))
    expect(screen.getByRole('heading', { name: 'Outfits guardados' })).toBeInTheDocument()
    expect(screen.getByText('Mi conjunto')).toBeInTheDocument()
  })

  it('persists and resets personal preference settings', async () => {
    await database.open()
    const user = userEvent.setup()
    render(<OutfitGenerator garments={[]} onAvailabilityChange={vi.fn().mockResolvedValue(undefined)} />)
    await user.click(screen.getByText('Preferencias personales'))
    await user.type(screen.getByLabelText('Colores preferidos (separados por coma)'), 'Verde')
    await user.click(screen.getByRole('button', { name: 'Guardar preferencias' }))
    await waitFor(async () => expect(await database.preferences.get('current')).toMatchObject({ preferredColors: ['Verde'] }))

    await user.click(screen.getByRole('button', { name: 'Restablecer' }))
    await waitFor(async () => expect(await database.preferences.get('current')).toMatchObject({ preferredColors: [], preferredStyles: [] }))
  })
})
