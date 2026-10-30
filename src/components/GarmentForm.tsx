import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import {
  analyzeGarmentImage,
  labelSize,
  MODEL_DOWNLOAD_SIZE,
  readGarmentLabel,
  type ClothingAnalysisSuggestion,
  type LabelReading
} from '../ai/clothingAnalyzer'
import { suggestUsage } from '../ai/usageRules'
import { createThumbnail, reducePhoto } from '../db/imageProcessing'
import { taxonomy } from '../ml/taxonomy'
import {
  dressLevels,
  garmentCategories,
  type DressLevel,
  type Garment,
  type GarmentAnalysis,
  type GarmentCategory,
  type GarmentRole,
  type Season
} from '../types/domain'
import GarmentPhoto from './GarmentPhoto'

const seasons: Season[] = ['Primavera', 'Verano', 'Otoño', 'Invierno']
const dressLevelHints: Record<DressLevel, string> = {
  Deportivo: 'Para hacer deporte',
  Diario: 'Día a día, sin código',
  Arreglado: 'Cena, oficina, una cita',
  Formal: 'Boda, evento, traje'
}
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
const colorOptions = taxonomy.attributes.colors.values.map((value) => value.label)
const patternOptions = taxonomy.attributes.pattern.values.map((value) => value.label)
// How dressed up a garment is goes in «Estilo» (dress levels); these are aesthetics.
const styleOptions = ['Minimalista', 'Clásico', 'Urbano', 'Bohemio', 'Romántico', 'Vintage', 'Rockero', 'Preppy']

// Fields the analysis can fill; each shows a «Sugerido» mark until the user edits it.
type SuggestedField = 'category' | 'subcategory' | 'colors' | 'pattern' | 'brand' | 'size' | 'composition' | UsageField
// Suggested from the garment type (usageRules) and kept up to date with it until the user changes them.
type UsageField = 'seasons' | 'dressLevels' | 'styles'
const usageFields: UsageField[] = ['seasons', 'dressLevels', 'styles']

function createSuggestedGarmentName(subcategory: string, colors: string[], brand: string): string {
  const colorNames = colors.map((color) => color.trim()).filter(Boolean).slice(0, 2)
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

function percent(value: number): string {
  return value.toLocaleString('es', { style: 'percent', maximumFractionDigits: 0 })
}

const roles: Record<GarmentCategory, GarmentRole> = {
  'Parte superior': 'Top',
  'Parte inferior': 'Bottom',
  'Vestido / mono': 'Una pieza',
  Abrigo: 'Capa',
  Calzado: 'Calzado',
  Accesorio: 'Accesorio'
}

function SuggestedBadge() {
  return <span className="suggested-badge" title="Rellenado por el análisis; revísalo">Sugerido</span>
}

function FieldHeading({ htmlFor, label, hint, suggested }: { htmlFor?: string; label: string; hint?: string; suggested?: boolean }) {
  return (
    <div className="field-heading">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
      {hint && <small>{hint}</small>}
      {suggested && <SuggestedBadge />}
    </div>
  )
}

interface ChipsFieldProps {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  options: string[]
  placeholder: string
  suggested?: boolean
}

/** A list of short values edited as chips; Enter, comma or leaving the field adds what was typed. */
function ChipsField({ label, values, onChange, options, placeholder, suggested }: ChipsFieldProps) {
  const id = useId()
  const [draft, setDraft] = useState('')

  function add(text: string) {
    const additions = text.split(',').map((value) => value.trim()).filter(Boolean)
    const known = new Set(values.map((value) => value.toLocaleLowerCase('es')))
    const fresh = additions.filter((value) => {
      const key = value.toLocaleLowerCase('es')
      if (known.has(key)) return false
      known.add(key)
      return true
    })
    if (fresh.length) onChange([...values, ...fresh])
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      add(draft)
      setDraft('')
    } else if (event.key === 'Backspace' && !draft && values.length) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div className="form-field full">
      <FieldHeading htmlFor={id} label={label} suggested={suggested} />
      <div className="chips-input">
        {values.map((value) => (
          <span className="chip" key={value}>
            {value}
            <button type="button" onClick={() => onChange(values.filter((item) => item !== value))} aria-label={`Quitar ${value}`}>×</button>
          </span>
        ))}
        <input
          id={id}
          list={`${id}-options`}
          value={draft}
          onChange={(event) => {
            const text = event.target.value
            if (text.includes(',')) {
              add(text)
              setDraft('')
            } else {
              setDraft(text)
            }
          }}
          onKeyDown={keyDown}
          onBlur={() => {
            add(draft)
            setDraft('')
          }}
          placeholder={values.length ? 'Añadir…' : placeholder}
        />
        <datalist id={`${id}-options`}>
          {options.filter((option) => !values.includes(option)).map((option) => <option key={option} value={option} />)}
        </datalist>
      </div>
    </div>
  )
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="form-section">
      <legend>{title}</legend>
      <div className="form-grid">{children}</div>
    </fieldset>
  )
}

interface GarmentFormProps {
  garment?: Garment
  onSave: (garment: Garment) => Promise<void>
  onCancel: () => void
  submitLabel?: string
}

export default function GarmentForm({ garment, onSave, onCancel, submitLabel }: GarmentFormProps) {
  const fieldId = useId()
  const [name, setName] = useState(garment?.name ?? '')
  const [category, setCategory] = useState<GarmentCategory>(garment?.category ?? 'Parte superior')
  const [subcategory, setSubcategory] = useState(garment?.subcategory ?? '')
  const [colors, setColors] = useState<string[]>(garment?.colors ?? [])
  const [pattern, setPattern] = useState(garment?.pattern ?? '')
  const [brand, setBrand] = useState(garment?.brand ?? '')
  const [size, setSize] = useState(garment?.size ?? '')
  const [composition, setComposition] = useState(garment?.composition ?? '')
  const [notes, setNotes] = useState(garment?.notes ?? '')
  const [selectedSeasons, setSelectedSeasons] = useState<Season[]>(garment?.seasons ?? [])
  const [styles, setStyles] = useState<string[]>(garment?.styles ?? [])
  const [levels, setLevels] = useState<DressLevel[]>(garment?.dressLevels ?? [])
  const [nameManuallyEdited, setNameManuallyEdited] = useState(Boolean(garment?.name))
  const [photos, setPhotos] = useState<Blob[]>(() => garment ? [garment.image, ...(garment.additionalImages ?? [])] : [])
  const [imageChanged, setImageChanged] = useState(false)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [analysisSuggestion, setAnalysisSuggestion] = useState<ClothingAnalysisSuggestion>()
  const [suggested, setSuggested] = useState<Set<SuggestedField>>(() => new Set())
  // The care label has its own photo, read only for text, so it never weighs on the garment photos' results.
  const [labelPhoto, setLabelPhoto] = useState<Blob | undefined>(garment?.labelImage)
  const [labelReading, setLabelReading] = useState<LabelReading>()
  const [readingLabel, setReadingLabel] = useState(false)
  const [labelError, setLabelError] = useState('')
  const analysisRequestId = useRef(0)
  const labelRequestId = useRef(0)
  // Analyses finish later; they must see what the user typed meanwhile, not the values when they started.
  const typed = useRef({ brand, size, composition, suggested })
  typed.current = { brand, size, composition, suggested }
  // A saved garment keeps the use the user gave it; a new one follows the suggestion until the user changes it.
  const usageTouched = useRef(new Set<UsageField>(garment ? usageFields : []))

  useEffect(() => {
    if (!analysisSuggestion || nameManuallyEdited) return
    setName(createSuggestedGarmentName(subcategory, colors, brand))
  }, [analysisSuggestion, brand, colors, nameManuallyEdited, subcategory])

  // Which size a label gives depends on the garment (a number for shoes, a letter for tops): choose it again when
  // the category changes, unless the user has typed a size.
  const sizeFromLabel = labelSize(labelReading, category)
  useEffect(() => {
    if (!sizeFromLabel) return
    const { size: current, suggested: marks } = typed.current
    if (current.trim() && !marks.has('size')) return
    setSize(sizeFromLabel.value)
    mark(['size'])
  }, [sizeFromLabel?.value]) // eslint-disable-line react-hooks/exhaustive-deps

  const usage = suggestUsage({ category, subcategory, sleeve: analysisSuggestion?.sleeve?.value, composition })
  const usageKey = JSON.stringify(usage)
  const hasType = Boolean(analysisSuggestion || subcategory.trim())
  useEffect(() => {
    if (!hasType) return
    const untouched = usageFields.filter((field) => !usageTouched.current.has(field))
    if (untouched.includes('seasons')) setSelectedSeasons(usage.seasons)
    if (untouched.includes('dressLevels')) setLevels(usage.dressLevels)
    if (untouched.includes('styles')) setStyles(usage.styles)
    // No style is suggested for most types: then the field is left empty and unmarked.
    mark(untouched.filter((field) => field !== 'styles' || usage.styles.length))
    if (untouched.includes('styles') && !usage.styles.length) edited('styles')
  }, [usageKey, hasType]) // eslint-disable-line react-hooks/exhaustive-deps

  function touchUsage(field: UsageField) {
    usageTouched.current.add(field)
    edited(field)
  }

  function mark(fields: SuggestedField[]) {
    setSuggested((current) => fields.every((field) => current.has(field)) ? current : new Set([...current, ...fields]))
  }

  function edited(field: SuggestedField) {
    setSuggested((current) => {
      if (!current.has(field)) return current
      const next = new Set(current)
      next.delete(field)
      return next
    })
  }

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
      const filled: SuggestedField[] = ['category', 'subcategory', 'colors']
      setAnalysisSuggestion(suggestion)
      setCategory(suggestion.category)
      setSubcategory(suggestion.subcategory)
      setColors(suggestion.colors)
      if (suggestion.pattern) {
        setPattern(suggestion.pattern.label)
        filled.push('pattern')
      }
      // A brand typed by the user is never replaced by one read from the photo.
      if (suggestion.brand && !typed.current.brand.trim()) {
        setBrand(suggestion.brand.brand)
        filled.push('brand')
      }
      // Marks from the label photo (size, composition) stay; those of a previous analysis of these photos go.
      setSuggested((current) => new Set([
        ...[...current].filter((field) => ['brand', 'size', 'composition', ...usageFields].includes(field)),
        ...filled
      ]))
    } catch (error) {
      console.error('No se pudo analizar la imagen de la prenda:', error)
      if (requestId === analysisRequestId.current) {
        setAnalysisError('No se pudo cargar o ejecutar el modelo. Comprueba la conexión si es la primera vez y el espacio y la memoria del dispositivo. La foto no se envía y no se ha generado ninguna predicción.')
      }
    } finally {
      if (requestId === analysisRequestId.current) setAnalyzing(false)
    }
  }

  function selectLabelPhoto(file: File | undefined) {
    setLabelError('')
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size === 0 || file.size > maxPhotoSize) {
      setLabelError('La foto de la etiqueta debe ser JPG, PNG o WebP de 8 MB o menos.')
      return
    }
    setLabelPhoto(file)
    void readLabel(file)
  }

  function removeLabelPhoto() {
    labelRequestId.current += 1
    setLabelPhoto(undefined)
    setLabelReading(undefined)
    setReadingLabel(false)
    setLabelError('')
  }

  async function readLabel(image: Blob) {
    const requestId = ++labelRequestId.current
    setReadingLabel(true)
    setLabelReading(undefined)
    try {
      const reading = await readGarmentLabel(image)
      if (requestId !== labelRequestId.current) return
      setLabelReading(reading)
      // Brand and composition only fill empty fields; the size is chosen by the effect above, for the category.
      const filled: SuggestedField[] = []
      if (reading.brand && !typed.current.brand.trim()) {
        setBrand(reading.brand.brand)
        filled.push('brand')
      }
      if (reading.composition && !typed.current.composition.trim()) {
        setComposition(reading.composition.value)
        filled.push('composition')
      }
      mark(filled)
      if (!reading.brand && !reading.composition && !reading.lines.length) {
        setLabelError('No se ha podido leer texto en la etiqueta. Prueba con una foto más cercana, recta y con buena luz.')
      }
    } catch (error) {
      console.error('No se pudo leer la etiqueta:', error)
      if (requestId === labelRequestId.current) setLabelError('No se pudo leer la etiqueta en este dispositivo. Puedes rellenar los campos a mano.')
    } finally {
      if (requestId === labelRequestId.current) setReadingLabel(false)
    }
  }

  function toggleLevel(level: DressLevel) {
    touchUsage('dressLevels')
    // Kept in scale order, whatever order they were ticked in.
    setLevels((current) => dressLevels.filter((value) => value === level ? !current.includes(value) : current.includes(value)))
  }

  function toggleSeason(season: Season) {
    touchUsage('seasons')
    setSelectedSeasons((current) => current.includes(season)
      ? current.filter((value) => value !== season)
      : [...current, season])
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    if (!photos.length) {
      setFormError('Añade una fotografía para guardar la prenda.')
      return
    }

    setSaving(true)
    try {
      // Stored photos are reduced (≤ 2048 px); photos already saved are not processed again.
      const [image, ...additionalImages] = (imageChanged ? await Promise.all(photos.map(reducePhoto)) : photos) as [Blob, ...Blob[]]
      const labelImage = labelPhoto && labelPhoto !== garment?.labelImage ? await reducePhoto(labelPhoto) : labelPhoto
      const processedImage = imageChanged || !garment || !garment.thumbnail || !garment.width || !garment.height
        ? await createThumbnail(image)
        : {
            thumbnail: garment.thumbnail,
            width: garment.width,
            height: garment.height
          }
      const timestamp = Date.now()
      const labelBrand = labelReading?.brand?.brand
      const previousSuggestions = analysisSuggestion
        ? {
            category: analysisSuggestion.category,
            subcategory: analysisSuggestion.subcategory,
            colors: analysisSuggestion.colors,
            pattern: analysisSuggestion.pattern?.label,
            brand: labelBrand ?? analysisSuggestion.brand?.brand,
            size: sizeFromLabel?.value,
            composition: labelReading?.composition?.value
          }
        : !imageChanged ? garment?.analysis?.suggestions : undefined
      const correctedAttributes: string[] = []
      if (previousSuggestions) {
        if (category !== previousSuggestions.category) correctedAttributes.push('category')
        if (subcategory.trim() !== previousSuggestions.subcategory) correctedAttributes.push('subcategory')
        const savedColors = colors.map((value) => value.toLocaleLowerCase('es'))
        const suggestedColors = previousSuggestions.colors.map((value) => value.toLocaleLowerCase('es'))
        if (savedColors.join('|') !== suggestedColors.join('|')) correctedAttributes.push('colors')
        if (previousSuggestions.pattern && pattern.trim() !== previousSuggestions.pattern) correctedAttributes.push('pattern')
        if (previousSuggestions.brand && brand.trim() !== previousSuggestions.brand) correctedAttributes.push('brand')
        if (previousSuggestions.size && size.trim() !== previousSuggestions.size) correctedAttributes.push('size')
        if (previousSuggestions.composition && composition.trim() !== previousSuggestions.composition) correctedAttributes.push('composition')
      }
      const analysis: GarmentAnalysis | undefined = analysisSuggestion
        ? {
            modelId: analysisSuggestion.modelId,
            modelVersion: analysisSuggestion.modelVersion,
            ...(analysisSuggestion.calibrated ? { calibrated: true } : {}),
            analyzedAt: analysisSuggestion.analyzedAt,
            suggestions: {
              category: analysisSuggestion.category,
              subcategory: analysisSuggestion.subcategory,
              colors: analysisSuggestion.colors,
              ...(analysisSuggestion.pattern ? { pattern: analysisSuggestion.pattern.label } : {}),
              ...(analysisSuggestion.sleeve ? { sleeve: analysisSuggestion.sleeve.label } : {}),
              ...(analysisSuggestion.fit ? { fit: analysisSuggestion.fit.label } : {}),
              ...(labelBrand ?? analysisSuggestion.brand ? { brand: labelBrand ?? analysisSuggestion.brand!.brand } : {}),
              ...(sizeFromLabel ? { size: sizeFromLabel.value } : {}),
              ...(labelReading?.composition ? { composition: labelReading.composition.value } : {}),
              alternatives: analysisSuggestion.alternatives
            },
            confidenceByAttribute: analysisSuggestion.confidenceByAttribute,
            sourcesByAttribute: {
              category: 'vesta-dinov2',
              subcategory: 'vesta-dinov2',
              ...(analysisSuggestion.pattern ? { pattern: 'vesta-dinov2' as const } : {}),
              ...(labelBrand ?? analysisSuggestion.brand ? { brand: 'paddle-ocr' as const } : {}),
              ...(sizeFromLabel ? { size: 'paddle-ocr' as const } : {}),
              ...(labelReading?.composition ? { composition: 'paddle-ocr' as const } : {}),
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
        ...(garment?.code ? { code: garment.code } : {}),
        name: name.trim(),
        category,
        subcategory: subcategory.trim(),
        colors,
        pattern: pattern.trim() || undefined,
        brand: brand.trim() || undefined,
        size: size.trim() || undefined,
        composition: composition.trim() || undefined,
        notes: notes.trim() || undefined,
        seasons: selectedSeasons,
        styles,
        dressLevels: levels,
        role: roles[category],
        availability: garment?.availability,
        image,
        ...(additionalImages.length ? { additionalImages } : {}),
        ...(labelImage ? { labelImage } : {}),
        thumbnail: processedImage.thumbnail,
        width: processedImage.width,
        height: processedImage.height,
        confirmedAttributes: ['category', 'colors', 'seasons', 'styles', 'dressLevels', ...(pattern.trim() ? ['pattern'] : [])],
        suggestedAttributes: analysisSuggestion
          ? ['category', 'subcategory', 'colors',
              ...(['pattern', 'brand', 'size', 'composition'] as const).filter((attribute) => suggested.has(attribute))]
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

  const categoryId = taxonomy.categories.find((entry) => entry.label === category)?.id
  const subcategoryOptions = taxonomy.subcategories.filter((entry) => entry.category === categoryId).map((entry) => entry.label)
  // A pattern typed in an earlier version of the form stays selectable.
  const patterns = pattern && !patternOptions.includes(pattern) ? [...patternOptions, pattern] : patternOptions
  const brandRead = labelReading?.brand ?? analysisSuggestion?.brand
  const readFromLabel = ([
    ['Marca', brandRead?.brand, brandRead?.text],
    ['Talla', sizeFromLabel?.value, sizeFromLabel?.text],
    ['Composición', labelReading?.composition?.value, labelReading?.composition?.text]
  ] as const).filter(([, value]) => value)
  const shape = analysisSuggestion && [analysisSuggestion.sleeve?.label, analysisSuggestion.fit && `Corte ${analysisSuggestion.fit.label.toLocaleLowerCase('es')}`].filter(Boolean)

  return (
    <form className="garment-form" onSubmit={(event) => void submit(event)}>
      <div className="garment-form-layout">
        <aside className="garment-form-media">
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

          <section className="label-slot" aria-labelledby={`${fieldId}-label-title`}>
            <div className="label-slot-header">
              <p className="analysis-label" id={`${fieldId}-label-title`}>Foto de la etiqueta</p>
              <small>Opcional · solo se lee el texto</small>
            </div>
            {labelPhoto ? (
              <div className="label-slot-body">
                <GarmentPhoto image={labelPhoto} alt="Etiqueta de la prenda" />
                <div className="label-slot-reading" role="status">
                  {readingLabel && <p className="analysis-progress">Leyendo la etiqueta…</p>}
                  {!readingLabel && readFromLabel.length > 0 && (
                    <dl className="analysis-read">
                      {readFromLabel.map(([label, value, text]) => (
                        <div key={label}><dt>{label}</dt><dd>{value}{text && text.toLocaleLowerCase('es') !== value?.toLocaleLowerCase('es') && <> <q>{text}</q></>}</dd></div>
                      ))}
                    </dl>
                  )}
                  {!readingLabel && labelReading && !readFromLabel.length && !labelError && (
                    <p className="analysis-progress">No se ha reconocido marca, talla ni composición.</p>
                  )}
                  {labelError && <p className="form-error" role="alert">{labelError}</p>}
                  <div className="label-slot-actions">
                    {!labelReading && !readingLabel && <button type="button" onClick={() => void readLabel(labelPhoto)} disabled={saving}>Leer etiqueta</button>}
                    <button type="button" onClick={removeLabelPhoto} disabled={saving} aria-label="Quitar foto de la etiqueta">Quitar</button>
                  </div>
                </div>
              </div>
            ) : (
              <label className="label-upload">
                <span aria-hidden="true">＋</span>
                <span>Añadir foto de la etiqueta <small>para leer marca, talla y composición; no cuenta para el tipo ni el color</small></span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  capture="environment"
                  onChange={(event) => {
                    selectLabelPhoto(event.currentTarget.files?.[0])
                    event.currentTarget.value = ''
                  }}
                  aria-label="Seleccionar foto de la etiqueta"
                />
              </label>
            )}
            {!labelPhoto && labelError && <p className="form-error" role="alert">{labelError}</p>}
          </section>

          <div className="analysis-card" role="status">
            {analyzing && <p className="analysis-progress">Analizando {photos.length} {photos.length === 1 ? 'foto' : 'fotos'}…</p>}
            {!analyzing && analysisSuggestion && (
              <>
                <p className="analysis-label">Sugerencia del análisis</p>
                <p className="analysis-main">{analysisSuggestion.subcategory || analysisSuggestion.category}</p>
                <p className="analysis-meta">
                  {analysisSuggestion.subcategory ? `${analysisSuggestion.category} · ` : ''}
                  {percent(analysisSuggestion.confidenceByAttribute.category ?? 0)} de confianza{analysisSuggestion.calibrated ? '' : ' (no calibrada)'}
                </p>
                {analysisSuggestion.alternatives.length > 0 && (
                  <div className="analysis-alternatives">
                    <span>¿No es esto?</span>
                    {analysisSuggestion.alternatives.map((candidate) => (
                      <button
                        type="button"
                        key={`${candidate.category}-${candidate.subcategory}`}
                        aria-label={`${candidate.category}${candidate.subcategory ? ` · ${candidate.subcategory}` : ''}`}
                        onClick={() => {
                          setCategory(candidate.category)
                          setSubcategory(candidate.subcategory)
                          setName(candidate.subcategory)
                          edited('category')
                          edited('subcategory')
                        }}
                        disabled={saving}
                      >
                        {candidate.subcategory || candidate.category} <small>{percent(candidate.score)}</small>
                      </button>
                    ))}
                  </div>
                )}
                {shape && shape.length > 0 && (
                  <p className="analysis-info">{shape.join(' · ')} <small>(informativo, no se guarda)</small></p>
                )}
                {analysisSuggestion.brand && !labelReading?.brand && (
                  <p className="analysis-info">Marca leída en la prenda: {analysisSuggestion.brand.brand}</p>
                )}
              </>
            )}
            {!analyzing && !analysisSuggestion && !analysisError && (
              <p className="analysis-progress">{photos.length ? 'Pulsa «Analizar de nuevo» para obtener sugerencias.' : 'Añade una foto y sugeriremos tipo, color y estampado.'}</p>
            )}
            {analysisError && <p className="form-error" role="alert">{analysisError}</p>}
            <button className="button button-outline analysis-again" type="button" onClick={() => void analyzeImage()} disabled={!photos.length || analyzing || saving}>
              {analyzing ? 'Analizando…' : 'Analizar de nuevo'}
            </button>
          </div>

          <details className="analysis-details">
            <summary>¿Cómo se analiza?</summary>
            <p>Las fotos se analizan en este dispositivo y no se envían. El modelo de VESTA combina todas las fotos para sugerir categoría, subcategoría y estampado, y estima la manga o el corte del pantalón. El color se calcula por píxeles y puede captar el fondo. La marca se lee si aparece escrita (etiqueta, lengüeta…); los logos sin letras no se reconocen. Talla y composición salen de la foto de la etiqueta, que va en su propio campo y solo se usa para leer texto: no cuenta para el tipo ni el color. Temporadas, estilo y formalidad se completan a mano. Las sugerencias nunca sustituyen lo que hayas escrito en marca, talla o composición. Descarga del modelo la primera vez: {MODEL_DOWNLOAD_SIZE}.</p>
          </details>
        </aside>

        <div className="garment-form-fields">
          <FormSection title="Qué es">
            <div className="form-field">
              <FieldHeading htmlFor={`${fieldId}-category`} label="Categoría" suggested={suggested.has('category')} />
              <select id={`${fieldId}-category`} value={category} onChange={(event) => { setCategory(event.target.value as GarmentCategory); edited('category') }}>
                {garmentCategories.map((value) => <option key={value}>{value}</option>)}
              </select>
            </div>
            <div className="form-field">
              <FieldHeading htmlFor={`${fieldId}-subcategory`} label="Subcategoría" suggested={suggested.has('subcategory')} />
              <input id={`${fieldId}-subcategory`} list={`${fieldId}-subcategories`} value={subcategory} onChange={(event) => { setSubcategory(event.target.value); edited('subcategory') }} placeholder="p. ej. Camiseta" maxLength={50} />
              <datalist id={`${fieldId}-subcategories`}>{subcategoryOptions.map((value) => <option key={value} value={value} />)}</datalist>
            </div>
            <div className="form-field full">
              <FieldHeading htmlFor={`${fieldId}-name`} label="Nombre" hint={nameManuallyEdited ? 'Opcional' : 'Opcional · se propone con subcategoría, color y marca'} />
              <input id={`${fieldId}-name`} value={name} onChange={(event) => { setName(event.target.value); setNameManuallyEdited(true) }} placeholder="p. ej. Camiseta azul · Marca" maxLength={80} />
            </div>
          </FormSection>

          <FormSection title="Aspecto">
            <ChipsField label="Colores" values={colors} onChange={(values) => { setColors(values); edited('colors') }} options={colorOptions} placeholder="p. ej. Azul marino" suggested={suggested.has('colors')} />
            <div className="form-field full">
              <FieldHeading htmlFor={`${fieldId}-pattern`} label="Estampado" suggested={suggested.has('pattern')} />
              <select id={`${fieldId}-pattern`} value={pattern} onChange={(event) => { setPattern(event.target.value); edited('pattern') }}>
                <option value="">Sin especificar</option>
                {patterns.map((value) => <option key={value}>{value}</option>)}
              </select>
            </div>
          </FormSection>

          <FormSection title="Etiqueta">
            <div className="form-field">
              <FieldHeading htmlFor={`${fieldId}-brand`} label="Marca" suggested={suggested.has('brand')} />
              <input id={`${fieldId}-brand`} value={brand} onChange={(event) => { setBrand(event.target.value); edited('brand') }} maxLength={50} />
            </div>
            <div className="form-field">
              <FieldHeading htmlFor={`${fieldId}-size`} label="Talla" suggested={suggested.has('size')} />
              <input id={`${fieldId}-size`} value={size} onChange={(event) => { setSize(event.target.value); edited('size') }} placeholder="p. ej. M, 42, W32 L34" maxLength={30} />
            </div>
            <div className="form-field full">
              <FieldHeading htmlFor={`${fieldId}-composition`} label="Composición" hint="Opcional" suggested={suggested.has('composition')} />
              <input id={`${fieldId}-composition`} value={composition} onChange={(event) => { setComposition(event.target.value); edited('composition') }} placeholder="p. ej. 95 % algodón, 5 % elastano" maxLength={120} />
            </div>
          </FormSection>

          <FormSection title="Uso">
            <fieldset className="form-field full choice-field">
              <legend>Temporadas{suggested.has('seasons') && <SuggestedBadge />}</legend>
              <div className="choice-row">{seasons.map((season) => <label key={season} className={`choice-chip ${selectedSeasons.includes(season) ? 'selected' : ''}`}><input type="checkbox" checked={selectedSeasons.includes(season)} onChange={() => toggleSeason(season)} />{season}</label>)}</div>
            </fieldset>
            <fieldset className="form-field full choice-field">
              <legend>Estilo{suggested.has('dressLevels') && <SuggestedBadge />}<small>Marca todos los que encajen</small></legend>
              <div className="choice-row">{dressLevels.map((level) => <label key={level} className={`choice-chip ${levels.includes(level) ? 'selected' : ''}`} title={dressLevelHints[level]}><input type="checkbox" checked={levels.includes(level)} onChange={() => toggleLevel(level)} />{level}</label>)}</div>
            </fieldset>
            <ChipsField label="Estética" values={styles} onChange={(values) => { setStyles(values); touchUsage('styles') }} options={styleOptions} placeholder="Opcional, p. ej. Minimalista" suggested={suggested.has('styles')} />
          </FormSection>

          <div className="form-field full form-notes">
            <FieldHeading htmlFor={`${fieldId}-notes`} label="Notas" hint="Opcional" />
            <textarea id={`${fieldId}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={500} />
          </div>
        </div>
      </div>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <footer className="form-footer">
        <button className="button button-outline" type="button" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Guardando…' : submitLabel ?? (garment ? 'Guardar cambios' : 'Guardar prenda')}</button>
      </footer>
    </form>
  )
}
