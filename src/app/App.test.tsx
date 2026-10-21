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
      alternatives: [],
      confidenceByAttribute: { category: 0.6, subcategory: 0.6, colors: 0.5 },
      unknownAttributes: ['pattern', 'sleeveType', 'neckline', 'fit', 'style', 'formality', 'season'],
      modelId: 'wargoninnovation/wargon-clothing-classifier',
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

    const nameInput = screen.getByPlaceholderText('p. ej. Camiseta azul · Marca')
    await waitFor(() => expect(nameInput).toHaveValue('Prenda deportiva gris'))
    expect(analyzeGarmentImage).toHaveBeenCalledTimes(1)
    await user.type(screen.getByLabelText('Marca'), 'Nike')
    expect(nameInput).toHaveValue('Prenda deportiva gris · Nike')
    await user.clear(nameInput)
    await user.type(nameInput, 'Top de entrenamiento')
    await user.clear(screen.getByLabelText('Marca'))
    expect(nameInput).toHaveValue('Top de entrenamiento')

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
    await user.type(screen.getByPlaceholderText('p. ej. Camiseta azul · Marca'), 'Camisa favorita')
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
    const editInput = screen.getByPlaceholderText('p. ej. Camiseta azul · Marca')
    await user.clear(editInput)
    await user.type(editInput, 'Camisa actualizada')
    await user.upload(
      screen.getByLabelText('Seleccionar fotografía de la prenda'),
      new File(['replacement-image'], 'camisa-nueva.png', { type: 'image/png' })
    )
    await waitFor(() => expect(analyzeGarmentImage).toHaveBeenCalledTimes(2))
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

  it('combines multiple photos, applies a model alternative and persists the photo set', async () => {
    vi.mocked(analyzeGarmentImage).mockResolvedValue({
      category: 'Parte superior',
      subcategory: 'Camiseta',
      colors: ['Blanco'],
      alternatives: [{ category: 'Parte superior', subcategory: 'Camisa', score: 0.24 }],
      confidenceByAttribute: { category: 0.62, subcategory: 0.62, colors: 0.8 },
      unknownAttributes: ['pattern', 'sleeveType', 'neckline'],
      modelId: 'wargoninnovation/wargon-clothing-classifier',
      modelVersion: 'test-revision',
      analyzedAt: '2026-10-20T12:00:00.000Z'
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /añadir prenda/i }))
    const upload = screen.getByLabelText('Seleccionar fotografía de la prenda')
    const photos = [
      new File(['front'], 'camisa-frente.png', { type: 'image/png' }),
      new File(['back'], 'camisa-espalda.png', { type: 'image/png' })
    ]
    await user.upload(upload, photos)

    await user.click(await screen.findByRole('button', { name: /Parte superior · Camisa/ }))
    expect(screen.getByPlaceholderText('p. ej. Camiseta azul · Marca')).toHaveValue('Camisa blanca')
    expect(screen.getByPlaceholderText('p. ej. Camiseta')).toHaveValue('Camisa')
    await user.type(screen.getByLabelText('Marca'), 'Zara')
    await waitFor(() => expect(screen.getByPlaceholderText('p. ej. Camiseta azul · Marca')).toHaveValue('Camisa blanca · Zara'))
    await user.clear(screen.getByLabelText(/Colores/))
    await user.type(screen.getByLabelText(/Colores/), 'Blanco, Azul')
    await waitFor(() => expect(screen.getByPlaceholderText('p. ej. Camiseta azul · Marca')).toHaveValue('Camisa blanca y azul · Zara'))
    await user.click(screen.getByRole('button', { name: /guardar prenda/i }))

    expect(await screen.findByRole('button', { name: 'Camisa blanca y azul · Zara' })).toBeInTheDocument()
    const [saved] = await database.garments.toArray()
    expect(saved?.additionalImages).toHaveLength(1)
    expect(saved?.analysis?.suggestions.alternatives).toEqual([
      { category: 'Parte superior', subcategory: 'Camisa', score: 0.24 }
    ])
    await user.click(screen.getByRole('button', { name: 'Camisa blanca y azul · Zara' }))
    expect(screen.getByRole('button', { name: 'Ver foto 2' })).toBeInTheDocument()
    expect(vi.mocked(analyzeGarmentImage)).toHaveBeenCalledWith(expect.arrayContaining([
      expect.any(Blob),
      expect.any(Blob)
    ]))
  }, 15000)

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
