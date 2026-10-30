import { useEffect, useRef, useState, type FormEvent } from 'react'
import { analyzeGarmentImage, MODEL_DOWNLOAD_SIZE, type ClothingAnalysisSuggestion } from '../ai/clothingAnalyzer'
import { createThumbnail } from '../db/imageProcessing'
import {
  garmentCategories,
  type Formality,
  type Garment,
  type GarmentAnalysis,
  type GarmentCategory,
  type GarmentRole,
  type Season
} from '../types/domain'
import GarmentPhoto from './GarmentPhoto'

const seasons: Season[] = ['Primavera', 'Verano', 'Otoño', 'Invierno']
const maxPhotos = 4
const maxPhotoSize = 8 * 1024 * 1024
const feminineSubcategories = new Set([
  'bata',
  'blusa',
  'camisa',
  'camiseta',
  'camiseta de tirantes',
  'chaqueta',
  'chaqueta de invierno',
  'falda',
  'media',
  'medias',
  'prenda deportiva',
  'prenda de abrigo',
  'sudadera con capucha'
])
const feminineColors: Record<string, string> = {
  blanco: 'blanca',
  negro: 'negra',
  rojo: 'roja',
  morado: 'morada',
  'gris claro': 'gris clara',
  'gris oscuro': 'gris oscura'
}

function createSuggestedGarmentName(subcategory: string, colors: string, brand: string): string {
  const colorNames = colors.split(',').map((color) => color.trim()).filter(Boolean).slice(0, 2)
  const isFeminine = feminineSubcategories.has(subcategory.trim().toLocaleLowerCase('es'))
  const colorText = colorNames.map((color) => {
    const normalized = color.toLocaleLowerCase('es')
    const genderedColor = isFeminine
      ? feminineColors[normalized] ?? normalized
      : normalized
    return genderedColor
  }).join(' y ')
  const name = [subcategory.trim(), colorText].filter(Boolean).join(' ')
  return [name, brand.trim() ? `· ${brand.trim()}` : ''].filter(Boolean).join(' ').slice(0, 80).trimEnd()
}

const roles: Record<GarmentCategory, GarmentRole> = {
  'Parte superior': 'Top',
  'Parte inferior': 'Bottom',
  'Vestido / mono': 'Una pieza',
  Abrigo: 'Capa',
  Calzado: 'Calzado',
  Accesorio: 'Accesorio'
}

interface GarmentFormProps {
  garment?: Garment
  onSave: (garment: Garment) => Promise<void>
  onCancel: () => void
  submitLabel?: string
}

export default function GarmentForm({ garment, onSave, onCancel, submitLabel }: GarmentFormProps) {
  const [name, setName] = useState(garment?.name ?? '')
  const [category, setCategory] = useState<GarmentCategory>(garment?.category ?? 'Parte superior')
  const [subcategory, setSubcategory] = useState(garment?.subcategory ?? '')
  const [colors, setColors] = useState(garment?.colors.join(', ') ?? '')
  const [pattern, setPattern] = useState(garment?.pattern ?? '')
  const [brand, setBrand] = useState(garment?.brand ?? '')
  const [size, setSize] = useState(garment?.size ?? '')
  const [notes, setNotes] = useState(garment?.notes ?? '')
  const [selectedSeasons, setSelectedSeasons] = useState<Season[]>(garment?.seasons ?? [])
  const [styles, setStyles] = useState(garment?.styles.join(', ') ?? '')
  const [formality, setFormality] = useState<Formality>(garment?.formality ?? 'Casual')
  const [nameManuallyEdited, setNameManuallyEdited] = useState(Boolean(garment?.name))
  const [photos, setPhotos] = useState<Blob[]>(() => garment ? [garment.image, ...(garment.additionalImages ?? [])] : [])
  const [imageChanged, setImageChanged] = useState(false)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [analysisSuggestion, setAnalysisSuggestion] = useState<ClothingAnalysisSuggestion>()
  const analysisRequestId = useRef(0)

  useEffect(() => {
    if (!analysisSuggestion || nameManuallyEdited) return
    setName(createSuggestedGarmentName(subcategory, colors, brand))
  }, [analysisSuggestion, brand, colors, nameManuallyEdited, subcategory])

  function selectImages(files: FileList | null) {
    setFormError('')
    const selectedFiles = Array.from(files ?? [])
    if (!selectedFiles.length) return
    if (selectedFiles.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      setFormError('Selecciona una imagen JPG, PNG o WebP válida.')
      return
    }
    if (selectedFiles.some((file) => file.size === 0)) {
      setFormError('No se pueden analizar imágenes vacías.')
      return
    }
    if (selectedFiles.some((file) => file.size > maxPhotoSize)) {
      setFormError('Cada imagen debe ocupar 8 MB o menos.')
      return
    }
    if (photos.length + selectedFiles.length > maxPhotos) {
      setFormError(`Puedes guardar hasta ${maxPhotos} fotos por prenda. Quita alguna antes de añadir más.`)
      return
    }
    const nextPhotos = [...photos, ...selectedFiles]
    setPhotos(nextPhotos)
    setImageChanged(true)
    setAnalysisSuggestion(undefined)
    setAnalysisError('')
    void analyzeImage(nextPhotos)
  }

  function updatePhotos(nextPhotos: Blob[]) {
    setPhotos(nextPhotos)
    setImageChanged(true)
    setAnalysisSuggestion(undefined)
    setAnalysisError('')
    void analyzeImage(nextPhotos)
  }

  async function analyzeImage(imagesToAnalyze: Blob[] = photos) {
    if (!imagesToAnalyze.length) {
      analysisRequestId.current += 1
      setAnalyzing(false)
      return
    }
    const requestId = ++analysisRequestId.current
    setAnalyzing(true)
    setAnalysisError('')
    try {
      const suggestion = await analyzeGarmentImage(imagesToAnalyze)
      if (requestId !== analysisRequestId.current) return
      setAnalysisSuggestion(suggestion)
      setCategory(suggestion.category)
      setSubcategory(suggestion.subcategory)
      setColors(suggestion.colors.join(', '))
    } catch (error) {
      console.error('No se pudo analizar la imagen de la prenda:', error)
      if (requestId === analysisRequestId.current) {
        setAnalysisError('No se pudo cargar o ejecutar el modelo. Comprueba la conexión si es la primera vez y el espacio y la memoria del dispositivo. La foto no se envía y no se ha generado ninguna predicción.')
      }
    } finally {
      if (requestId === analysisRequestId.current) setAnalyzing(false)
    }
  }

  function toggleSeason(season: Season) {
    setSelectedSeasons((current) => current.includes(season)
      ? current.filter((value) => value !== season)
      : [...current, season])
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    const [image, ...additionalImages] = photos
    if (!image) {
      setFormError('Añade una fotografía para guardar la prenda.')
      return
    }

    setSaving(true)
    try {
      const processedImage = imageChanged || !garment || !garment.thumbnail || !garment.width || !garment.height
        ? await createThumbnail(image)
        : {
            thumbnail: garment.thumbnail,
            width: garment.width,
            height: garment.height
          }
      const timestamp = Date.now()
      const previousSuggestions = analysisSuggestion
        ? {
            category: analysisSuggestion.category,
            subcategory: analysisSuggestion.subcategory,
            colors: analysisSuggestion.colors
          }
        : !imageChanged ? garment?.analysis?.suggestions : undefined
      const correctedAttributes: string[] = []
      if (previousSuggestions) {
        if (category !== previousSuggestions.category) correctedAttributes.push('category')
        if (subcategory.trim() !== previousSuggestions.subcategory) correctedAttributes.push('subcategory')
        const savedColors = colors.split(',').map((value) => value.trim().toLocaleLowerCase('es')).filter(Boolean)
        const suggestedColors = previousSuggestions.colors.map((value) => value.toLocaleLowerCase('es'))
        if (savedColors.join('|') !== suggestedColors.join('|')) correctedAttributes.push('colors')
      }
      const analysis: GarmentAnalysis | undefined = analysisSuggestion
        ? {
            modelId: analysisSuggestion.modelId,
            modelVersion: analysisSuggestion.modelVersion,
            analyzedAt: analysisSuggestion.analyzedAt,
            suggestions: {
              category: analysisSuggestion.category,
              subcategory: analysisSuggestion.subcategory,
              colors: analysisSuggestion.colors,
              alternatives: analysisSuggestion.alternatives
            },
            confidenceByAttribute: analysisSuggestion.confidenceByAttribute,
            sourcesByAttribute: {
              category: 'wargon-vit',
              subcategory: 'wargon-vit',
              ...(analysisSuggestion.colors.length > 0 ? { colors: 'local-pixels' as const } : {})
            },
            unknownAttributes: analysisSuggestion.unknownAttributes,
            correctedAttributes
          }
        : !imageChanged && garment?.analysis
          ? {
              ...garment.analysis,
              correctedAttributes
            }
          : undefined
      await onSave({
        id: garment?.id ?? crypto.randomUUID(),
        name: name.trim(),
        category,
        subcategory: subcategory.trim(),
        colors: colors.split(',').map((value) => value.trim()).filter(Boolean),
        pattern: pattern.trim() || undefined,
        brand: brand.trim() || undefined,
        size: size.trim() || undefined,
        notes: notes.trim() || undefined,
        seasons: selectedSeasons,
        styles: styles.split(',').map((value) => value.trim()).filter(Boolean),
        formality,
        role: roles[category],
        availability: garment?.availability,
        image,
        ...(additionalImages.length ? { additionalImages } : {}),
        thumbnail: processedImage.thumbnail,
        width: processedImage.width,
        height: processedImage.height,
        confirmedAttributes: ['category', 'colors', 'seasons', 'styles', 'formality', ...(pattern.trim() ? ['pattern'] : [])],
        suggestedAttributes: analysisSuggestion
          ? ['category', 'subcategory', 'colors']
          : imageChanged ? [] : garment?.suggestedAttributes ?? [],
        analysis,
        createdAt: garment?.createdAt ?? new Date(timestamp).toISOString(),
        updatedAt: new Date(timestamp).toISOString()
      })
    } catch {
      setFormError('No se pudo guardar la prenda. Comprueba la imagen y el espacio disponible e inténtalo de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="garment-form" onSubmit={(event) => void submit(event)}>
      <div className="photo-collection">
        {photos.map((photo, index) => (
          <div className="photo-card" key={`${index}-${photo.size}-${photo.type}`}>
            <GarmentPhoto image={photo} alt={`Foto ${index + 1} de la prenda`} />
            <div className="photo-card-actions">
              {index === 0
                ? <span>Foto principal</span>
                : <button type="button" onClick={() => updatePhotos([photo, ...photos.filter((_, photoIndex) => photoIndex !== index)])} disabled={saving}>Hacer principal</button>}
              <button type="button" onClick={() => updatePhotos(photos.filter((_, photoIndex) => photoIndex !== index))} disabled={saving} aria-label={`Quitar foto ${index + 1}`}>Quitar</button>
            </div>
          </div>
        ))}
        {photos.length < maxPhotos && <label className="photo-upload">
          <span className="upload-placeholder"><span aria-hidden="true">＋</span><strong>{photos.length ? 'Añadir otra foto' : 'Añade fotos de la prenda'}</strong><small>Hasta {maxPhotos} fotos · JPG, PNG o WebP · 8 MB cada una</small></span>
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          capture="environment"
          multiple
          onChange={(event) => {
            selectImages(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
          aria-label="Seleccionar fotografía de la prenda"
        />
        </label>}
      </div>
      <div className="local-analysis">
        <button className="button button-outline" type="button" onClick={() => void analyzeImage()} disabled={!photos.length || analyzing || saving}>
          {analyzing ? `Analizando ${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}…` : 'Analizar de nuevo en este dispositivo'}
        </button>
        <p>Las fotos se guardan con la prenda y se analizan automáticamente en este dispositivo. El modelo solo clasifica el tipo de prenda; combina las puntuaciones de todas las fotos para sugerir categoría y subcategoría. El color se estima aparte por píxeles (puede captar el fondo). Marca, talla, temporadas, estampado, estilo y formalidad no se detectan y deben completarse manualmente. Descarga del modelo bajo demanda: {MODEL_DOWNLOAD_SIZE}. Las fotos no se envían.</p>
        {analysisSuggestion && (
          <div className="analysis-results" role="status">
            <p>Sugerencia principal: {analysisSuggestion.category} · {analysisSuggestion.subcategory} ({(analysisSuggestion.confidenceByAttribute.category ?? 0).toLocaleString('es', { style: 'percent', maximumFractionDigits: 1 })}, puntuación no calibrada). Revisa y confirma los campos.</p>
            {analysisSuggestion.alternatives.length > 0 && (
              <div className="analysis-alternatives">
                <span>Otras clases candidatas del modelo:</span>
                {analysisSuggestion.alternatives.map((candidate) => (
                  <button
                    type="button"
                    key={`${candidate.category}-${candidate.subcategory}`}
                    onClick={() => {
                      setCategory(candidate.category)
                      setSubcategory(candidate.subcategory)
                      setName(candidate.subcategory)
                    }}
                    disabled={saving}
                  >
                    {candidate.category} · {candidate.subcategory} ({candidate.score.toLocaleString('es', { style: 'percent', maximumFractionDigits: 1 })})
                  </button>
                ))}
              </div>
            )}
            <p>Campos rellenados o estimados: categoría, subcategoría y colores. Revisa el color; el resto de atributos requiere entrada manual.</p>
          </div>
        )}
        {analysisError && <p className="form-error" role="alert">{analysisError}</p>}
      </div>
      <div className="form-grid">
        <label className="form-field full"><span>Nombre <small>OPCIONAL · SUGERIDO CON SUBCATEGORÍA, COLOR Y MARCA</small></span><input value={name} onChange={(event) => { setName(event.target.value); setNameManuallyEdited(true) }} placeholder="p. ej. Camiseta azul · Marca" maxLength={80} /></label>
        <label className="form-field"><span>Categoría</span><select value={category} onChange={(event) => setCategory(event.target.value as GarmentCategory)}>{garmentCategories.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="form-field"><span>Subcategoría</span><input value={subcategory} onChange={(event) => setSubcategory(event.target.value)} placeholder="p. ej. Camiseta" maxLength={50} /></label>
        <label className="form-field full"><span>Colores <small>SEPARADOS POR COMAS</small></span><input value={colors} onChange={(event) => setColors(event.target.value)} placeholder="p. ej. azul marino, blanco" /></label>
        <label className="form-field full"><span>Estampado</span><input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="p. ej. liso, rayas, cuadros" maxLength={50} /></label>
        <fieldset className="form-field full season-field"><legend>Temporadas</legend><div className="choice-row">{seasons.map((season) => <label key={season} className={`choice-chip ${selectedSeasons.includes(season) ? 'selected' : ''}`}><input type="checkbox" checked={selectedSeasons.includes(season)} onChange={() => toggleSeason(season)} />{season}</label>)}</div></fieldset>
        <label className="form-field full"><span>Estilos <small>SEPARADOS POR COMAS</small></span><input value={styles} onChange={(event) => setStyles(event.target.value)} placeholder="p. ej. minimalista, casual" /></label>
        <label className="form-field full"><span>Formalidad</span><select value={formality} onChange={(event) => setFormality(event.target.value as Formality)}><option>Casual</option><option>Smart casual</option><option>Formal</option></select></label>
        <label className="form-field"><span>Marca</span><input value={brand} onChange={(event) => setBrand(event.target.value)} maxLength={50} /></label>
        <label className="form-field"><span>Talla</span><input value={size} onChange={(event) => setSize(event.target.value)} maxLength={30} /></label>
        <label className="form-field full"><span>Notas</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={500} /></label>
      </div>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <footer className="form-footer">
        <button className="button button-outline" type="button" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Guardando…' : submitLabel ?? (garment ? 'Guardar cambios' : 'Guardar prenda')}</button>
      </footer>
    </form>
  )
}
