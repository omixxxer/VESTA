import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { database } from '../db/database'
import { analyzeGarmentImage, readGarmentLabel } from '../ai/clothingAnalyzer'
import { importWardrobeBackup, readWardrobeBackup } from '../db/wardrobeBackup'

// Only the functions that load models are replaced; the rest (e.g. labelSize) are the real ones.
vi.mock('../ai/clothingAnalyzer', async (importOriginal) => ({
  ...await importOriginal<typeof import('../ai/clothingAnalyzer')>(),
  analyzeGarmentImage: vi.fn(),
  readGarmentLabel: vi.fn(),
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

// Reading and writing backups is tested in wardrobeBackup.test.ts with real Blobs; here only the flow.
vi.mock('../db/wardrobeBackup', () => ({
  readWardrobeBackup: vi.fn(),
  importWardrobeBackup: vi.fn(),
  createWardrobeBackup: vi.fn()
}))

vi.mock('../db/imageProcessing', () => ({
  reducePhoto: async (photo: Blob) => photo,
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
  it('imports a backup, letting the user merge it with the current wardrobe', async () => {
    await database.garments.add({
      id: 'local', name: 'Camisa', category: 'Parte superior', subcategory: 'Camisa', colors: [], seasons: [], styles: [],
      dressLevels: [], role: 'Top', image: new Blob(['image']), thumbnail: new Blob(['thumbnail']), width: 10, height: 10,
      confirmedAttributes: [], suggestedAttributes: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    })
    vi.mocked(readWardrobeBackup).mockResolvedValue({
      exportedAt: '2026-10-30T12:00:00.000Z', garments: [], outfits: [], preferences: [], outfitFeedback: [], trendPacks: [],
      garmentCodeCounters: []
    })
    vi.mocked(importWardrobeBackup).mockResolvedValue({ added: 2, updated: 1, unchanged: 0, recoded: 1, outfits: 3 })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'Camisa' })

    await user.click(screen.getByText('Datos'))
    expect(screen.getByRole('button', { name: /exportar copia del armario/i })).toBeEnabled()
    await user.upload(screen.getByLabelText('Seleccionar copia del armario'), new File(['zip'], 'vesta-armario.zip', { type: 'application/zip' }))
    expect(await screen.findByText(/copia del 30 de octubre de 2026/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Combinar con mi armario' }))

    expect(importWardrobeBackup).toHaveBeenCalledWith(expect.objectContaining({ exportedAt: '2026-10-30T12:00:00.000Z' }), 'merge')
    expect(await screen.findByText(/Copia importada: 2 prendas añadidas, 1 actualizada, 3 outfits\. 1 prenda ha recibido un código nuevo/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Combinar con mi armario' })).not.toBeInTheDocument()
  })

  it('keeps adding garments inside the wardrobe flow, not in bottom navigation', async () => {
    const user = userEvent.setup()
    render(<App />)

    const navigation = screen.getByRole('navigation', { name: 'Navegación principal' })
    expect(navigation).toHaveTextContent('Armario')
    expect(navigation).toHaveTextContent('Outfits')
    expect(navigation).toHaveTextContent('Maleta')
    expect(navigation).not.toHaveTextContent('Añadir')
    await user.click(await screen.findByRole('button', { name: /añadir prenda/i }))
    expect(screen.getByRole('heading', { name: /añadir prenda/i })).toBeInTheDocument()
  })

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
      calibrated: false,
      analyzedAt: '2026-10-20T12:00:00.000Z'
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /añadir prenda/i }))
    await user.upload(
      await screen.findByLabelText('Seleccionar fotografía de la prenda'),
      new File(['image-bytes'], 'sportswear.png', { type: 'image/png' })
    )

    const nameInput = screen.getByPlaceholderText('p. ej. Camiseta azul · Marca')
    await waitFor(() => expect(nameInput).toHaveValue('Prenda deportiva gris'))
    expect(analyzeGarmentImage).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/60 % de confianza \(no calibrada\)/)).toBeInTheDocument()
    // Use is suggested from the type and stops following it once the user changes it.
    expect(screen.getByRole('checkbox', { name: 'Deportivo' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Formal' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Verano' })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Verano' }))
    await user.type(screen.getByLabelText('Marca'), 'Nike')
    expect(nameInput).toHaveValue('Prenda deportiva gris · Nike')
    await user.clear(nameInput)
    await user.type(nameInput, 'Top de entrenamiento')
    await user.clear(screen.getByLabelText('Marca'))
    expect(nameInput).toHaveValue('Top de entrenamiento')

    await user.click(screen.getByRole('button', { name: /guardar prenda/i }))
    expect(await screen.findByRole('button', { name: 'Top de entrenamiento' })).toBeInTheDocument()
    expect(await database.garments.toArray()).toEqual([
      expect.objectContaining({
        name: 'Top de entrenamiento',
        subcategory: 'Prenda deportiva',
        seasons: ['Primavera', 'Otoño', 'Invierno'],
        dressLevels: ['Deportivo'],
        styles: []
      })
    ])
  })

  it('creates, consults, edits and deletes a garment through the interface', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /añadir prenda/i }))
    await user.type(await screen.findByPlaceholderText('p. ej. Camiseta azul · Marca'), 'Camisa favorita')
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
    expect(await screen.findByRole('dialog')).toBeInTheDocument() // the detail panel loads on demand
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
      calibrated: true,
      analyzedAt: '2026-10-20T12:00:00.000Z'
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /añadir prenda/i }))
    const upload = await screen.findByLabelText('Seleccionar fotografía de la prenda')
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
    // Colours are chips: the suggested one stays, a typed one is added with Enter (a repeated one is ignored).
    await user.type(screen.getByLabelText('Colores'), 'blanco{Enter}Azul{Enter}')
    expect(screen.getByRole('button', { name: 'Quitar Azul' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByPlaceholderText('p. ej. Camiseta azul · Marca')).toHaveValue('Camisa blanca y azul · Zara'))
    await user.click(screen.getByRole('button', { name: /guardar prenda/i }))

    expect(await screen.findByRole('button', { name: 'Camisa blanca y azul · Zara' })).toBeInTheDocument()
    const [saved] = await database.garments.toArray()
    expect(saved?.additionalImages).toHaveLength(1)
    expect(saved?.analysis?.calibrated).toBe(true)
    expect(saved?.analysis?.suggestions.alternatives).toEqual([
      { category: 'Parte superior', subcategory: 'Camisa', score: 0.24 }
    ])
    await user.click(screen.getByRole('button', { name: 'Camisa blanca y azul · Zara' }))
    expect(await screen.findByRole('button', { name: 'Ver foto 2' })).toBeInTheDocument()
    expect(vi.mocked(analyzeGarmentImage)).toHaveBeenCalledWith(expect.arrayContaining([
      expect.any(Blob),
      expect.any(Blob)
    ]))
  }, 15000)

  it('reads the label photo apart from the garment photos and saves it with the garment', async () => {
    vi.mocked(analyzeGarmentImage).mockResolvedValue({
      category: 'Calzado',
      subcategory: 'Zapatillas',
      colors: ['Blanco'],
      alternatives: [],
      confidenceByAttribute: { category: 0.9, subcategory: 0.8, colors: 0.7 },
      unknownAttributes: ['size', 'textileComposition'],
      modelId: 'vesta/dinov2-small-heads',
      modelVersion: 'heads-test',
      calibrated: true,
      analyzedAt: '2026-10-30T12:00:00.000Z'
    })
    vi.mocked(readGarmentLabel).mockResolvedValue({
      lines: [{ text: 'M', score: 0.95 }, { text: 'EUR 42', score: 0.95 }],
      brand: { brand: 'Nike', score: 0.95, text: 'NIKE' },
      composition: { value: '100 % piel', text: '100% LEATHER', score: 0.9 }
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /añadir prenda/i }))
    await user.upload(await screen.findByLabelText('Seleccionar fotografía de la prenda'), new File(['shoe'], 'zapatilla.png', { type: 'image/png' }))
    const label = new File(['label'], 'etiqueta.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Seleccionar foto de la etiqueta'), label)

    // A shoe takes the number on the label, not the letter.
    await waitFor(() => expect(screen.getByLabelText('Talla')).toHaveValue('42'))
    expect(screen.getByLabelText('Marca')).toHaveValue('Nike')
    expect(screen.getByLabelText('Composición')).toHaveValue('100 % piel')
    expect(readGarmentLabel).toHaveBeenCalledWith(label)
    // The label never goes through the garment classifier.
    expect(vi.mocked(analyzeGarmentImage).mock.calls.every(([images]) => !(images as Blob[]).includes(label))).toBe(true)

    await user.click(screen.getByRole('button', { name: /guardar prenda/i }))
    await waitFor(async () => expect(await database.garments.count()).toBe(1))
    const [saved] = await database.garments.toArray()
    expect(saved).toMatchObject({ brand: 'Nike', size: '42', composition: '100 % piel', code: 'ZAP-001' })
    expect(saved?.labelImage).toBeDefined()
    expect(saved?.additionalImages).toBeUndefined()
    expect(saved?.analysis?.sourcesByAttribute).toMatchObject({ size: 'paddle-ocr', composition: 'paddle-ocr' })
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
      dressLevels: ['Diario'],
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
    expect(await screen.findByText('No encontramos esa prenda.')).toBeInTheDocument()
  })
})
