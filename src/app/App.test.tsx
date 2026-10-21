import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { database } from '../db/database'
import { analyzeGarmentImage } from '../ai/clothingAnalyzer'

vi.mock('../ai/clothingAnalyzer', () => ({
  analyzeGarmentImage: vi.fn(),
  MODEL_DOWNLOAD_SIZE: 'test model'
}))

vi.mock('../components/Masonry.jsx', () => ({
  default: ({
    items,
    onItemClick
  }: {
    items: Array<{ id: string; img: string; title: string }>
    onItemClick: (item: { id: string; img: string; title: string }) => void
  }) => (
    <div role="list">
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => onItemClick(item)}>{item.title}</button>
      ))}
    </div>
  )
}))

vi.mock('../components/PatternWaves.jsx', () => ({ default: () => null }))

vi.mock('../db/imageProcessing', () => ({
  createThumbnail: async () => ({
    thumbnail: new Blob(['thumbnail'], { type: 'image/jpeg' }),
    width: 120,
    height: 180
  })
}))

afterEach(async () => {
  await database.garments.clear()
  vi.mocked(analyzeGarmentImage).mockReset()
  vi.restoreAllMocks()
})

describe('wardrobe flow', () => {
  it('fills the optional garment name from the local analysis suggestion and saves it', async () => {
    vi.mocked(analyzeGarmentImage).mockResolvedValue({
      category: 'Parte superior',
      subcategory: 'Prenda deportiva',
      colors: ['Gris'],
      confidenceByAttribute: { category: 0.6, subcategory: 0.6, colors: 0.5 },
      unknownAttributes: ['pattern', 'sleeveType', 'neckline', 'fit', 'style', 'formality', 'season'],
      modelId: 'Xenova/clip-vit-base-patch32',
      modelVersion: 'test-revision',
      analyzedAt: '2026-10-20T12:00:00.000Z'
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /añadir prenda/i }))
    await user.upload(
      screen.getByLabelText('Seleccionar fotografía de la prenda'),
      new File(['image-bytes'], 'sportswear.png', { type: 'image/png' })
    )
    await user.click(screen.getByRole('button', { name: 'Analizar foto en este dispositivo' }))

    const nameInput = screen.getByPlaceholderText('p. ej. Camisa de lino')
    await waitFor(() => expect(nameInput).toHaveValue('Prenda deportiva'))
    expect(analyzeGarmentImage).toHaveBeenCalledTimes(1)
    await user.clear(nameInput)
    await user.type(nameInput, 'Top de entrenamiento')

    await user.click(screen.getByRole('button', { name: /guardar prenda/i }))
    expect(await screen.findByRole('button', { name: 'Top de entrenamiento' })).toBeInTheDocument()
    expect(await database.garments.toArray()).toEqual([
      expect.objectContaining({ name: 'Top de entrenamiento', subcategory: 'Prenda deportiva' })
    ])
  })

  it('creates, consults, edits and deletes a garment through the interface', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /añadir prenda/i }))
    await user.type(screen.getByPlaceholderText('p. ej. Camisa de lino'), 'Camisa favorita')
    const upload = screen.getByLabelText('Seleccionar fotografía de la prenda')
    const image = new File(['image-bytes'], 'camisa.png', { type: 'image/png' })
    await user.upload(upload, image)
    await user.click(screen.getByRole('button', { name: /guardar prenda/i }))

    expect(await screen.findByRole('button', { name: 'Camisa favorita' })).toBeInTheDocument()
    expect(await database.garments.count()).toBe(1)
    const [savedGarment] = await database.garments.toArray()
    expect(savedGarment).toMatchObject({
      width: 120,
      height: 180
    })

    await user.click(screen.getByRole('button', { name: 'Camisa favorita' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Categoría')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Editar' }))
    const editInput = screen.getByPlaceholderText('p. ej. Camisa de lino')
    await user.clear(editInput)
    await user.type(editInput, 'Camisa actualizada')
    await user.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(await screen.findByRole('heading', { name: 'Camisa actualizada' })).toBeInTheDocument()
    expect(await database.garments.count()).toBe(1)

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await database.garments.count()).toBe(0)
    expect(screen.getByText('Tu armario empieza aquí.')).toBeInTheDocument()
    expect(window.confirm).toHaveBeenCalledWith('¿Eliminar esta prenda? No se puede deshacer')
  })

  it('filters the visible catalogue by category', async () => {
    await database.garments.add({
      id: 'top-1',
      name: 'Camisa',
      category: 'Parte superior',
      subcategory: '',
      colors: [],
      thumbnail: new Blob(['thumbnail']),
      width: 120,
      height: 180,
      seasons: [],
      styles: [],
      formality: 'Casual',
      role: 'Top',
      image: new Blob(['image']),
      confirmedAttributes: [],
      suggestedAttributes: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: 'Camisa' })
    await user.selectOptions(screen.getByLabelText('Filtrar por categoría'), 'Parte inferior')
    expect(screen.getByText('No encontramos esa prenda.')).toBeInTheDocument()
  })
})
