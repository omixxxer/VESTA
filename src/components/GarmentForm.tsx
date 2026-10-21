import { useState, type FormEvent } from 'react'
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
import { useObjectUrl } from './useObjectUrl'

const seasons: Season[] = ['Primavera', 'Verano', 'Otoño', 'Invierno']

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
  const [brand, setBrand] = useState(garment?.brand ?? '')
  const [size, setSize] = useState(garment?.size ?? '')
  const [notes, setNotes] = useState(garment?.notes ?? '')
  const [selectedSeasons, setSelectedSeasons] = useState<Season[]>(garment?.seasons ?? [])
  const [styles, setStyles] = useState(garment?.styles.join(', ') ?? '')
  const [formality, setFormality] = useState<Formality>(garment?.formality ?? 'Casual')
  const [image, setImage] = useState<Blob | undefined>(garment?.image)
  const [imageChanged, setImageChanged] = useState(false)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [analysisSuggestion, setAnalysisSuggestion] = useState<ClothingAnalysisSuggestion>()
  const imageUrl = useObjectUrl(image)

  function selectImage(file: File | undefined) {
    setFormError('')
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setFormError('Selecciona una imagen JPG, PNG o WebP válida.')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setFormError('La imagen debe ocupar 8 MB o menos.')
      return
    }
    setImage(file)
    setImageChanged(true)
    setAnalysisSuggestion(undefined)
    setAnalysisError('')
  }

  async function analyzeImage() {
    if (!image || analyzing) return
    setAnalyzing(true)
    setAnalysisError('')
    try {
      const suggestion = await analyzeGarmentImage(image)
      setAnalysisSuggestion(suggestion)
      setCategory(suggestion.category)
      setSubcategory(suggestion.subcategory)
      setName(suggestion.subcategory)
      setColors(suggestion.colors.join(', '))
    } catch {
      setAnalysisError('No se pudo cargar o ejecutar el modelo. Comprueba la conexión si es la primera vez y el espacio y la memoria del dispositivo. La foto no se envía y no se ha generado ninguna predicción.')
    } finally {
      setAnalyzing(false)
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
              colors: analysisSuggestion.colors
            },
            confidenceByAttribute: analysisSuggestion.confidenceByAttribute,
            sourcesByAttribute: {
              category: 'clip-zero-shot',
              subcategory: 'clip-zero-shot',
              ...(analysisSuggestion.colors.length > 0 ? { colors: 'local-pixels' as const } : {})
            },
            unknownAttributes: analysisSuggestion.unknownAttributes,
            correctedAttributes
          }
        : garment?.analysis
          ? {
              ...garment.analysis,
              correctedAttributes: imageChanged ? [] : correctedAttributes
            }
          : undefined
      await onSave({
        id: garment?.id ?? crypto.randomUUID(),
        name: name.trim(),
        category,
        subcategory: subcategory.trim(),
        colors: colors.split(',').map((value) => value.trim()).filter(Boolean),
        brand: brand.trim() || undefined,
        size: size.trim() || undefined,
        notes: notes.trim() || undefined,
        seasons: selectedSeasons,
        styles: styles.split(',').map((value) => value.trim()).filter(Boolean),
        formality,
        role: roles[category],
        image,
        thumbnail: processedImage.thumbnail,
        width: processedImage.width,
        height: processedImage.height,
        confirmedAttributes: ['category', 'colors', 'seasons', 'styles', 'formality'],
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
      <label className="photo-upload">
        {imageUrl
          ? <img src={imageUrl} alt="Vista previa de la prenda" />
          : <span className="upload-placeholder"><span aria-hidden="true">＋</span><strong>Añade una fotografía</strong><small>JPG, PNG o WebP · hasta 8 MB</small></span>}
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={(event) => selectImage(event.currentTarget.files?.[0])}
          aria-label="Seleccionar fotografía de la prenda"
        />
        {imageUrl && <span className="change-photo">Cambiar foto</span>}
      </label>
      <div className="local-analysis">
        <button className="button button-outline" type="button" onClick={() => void analyzeImage()} disabled={!image || analyzing || saving}>
          {analyzing ? 'Cargando modelo y analizando…' : 'Analizar foto en este dispositivo'}
        </button>
        <p>La categoría usa un modelo que se descarga bajo demanda ({MODEL_DOWNLOAD_SIZE}); el color se estima con píxeles locales. La foto nunca se envía.</p>
        {analysisSuggestion && (
          <p role="status">
            Sugerencia: {analysisSuggestion.subcategory} · {analysisSuggestion.colors.join(', ') || 'color no identificado'}.
            {' '}Puntuación de categoría {(analysisSuggestion.confidenceByAttribute.category ?? 0).toLocaleString('es', { style: 'percent', maximumFractionDigits: 1 })} (no calibrada); revisa y confirma los campos.
            {' '}No se detectan estampado, manga, cuello, corte, estilo, formalidad ni temporada.
          </p>
        )}
        {analysisError && <p className="form-error" role="alert">{analysisError}</p>}
      </div>
      <div className="form-grid">
        <label className="form-field full"><span>Nombre <small>OPCIONAL · SE PROPONE TRAS EL ANÁLISIS</small></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="p. ej. Camisa de lino" maxLength={80} /></label>
        <label className="form-field"><span>Categoría</span><select value={category} onChange={(event) => setCategory(event.target.value as GarmentCategory)}>{garmentCategories.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="form-field"><span>Subcategoría</span><input value={subcategory} onChange={(event) => setSubcategory(event.target.value)} placeholder="p. ej. Camiseta" maxLength={50} /></label>
        <label className="form-field full"><span>Colores <small>SEPARADOS POR COMAS</small></span><input value={colors} onChange={(event) => setColors(event.target.value)} placeholder="p. ej. azul marino, blanco" /></label>
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
