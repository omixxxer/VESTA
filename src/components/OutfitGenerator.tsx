import { useEffect, useState } from 'react'
import { database } from '../db/database'
import type { Garment, Outfit, UserPreferences } from '../types/domain'
import GarmentPhoto from './GarmentPhoto'
import {
  createOutfitFeedback,
  createOutfitRecord,
  generateOutfitCandidates,
  OUTFIT_SCORE_WEIGHTS,
  type OutfitCandidate,
  type OutfitContext,
  type OutfitTemplate
} from '../outfits/outfitGenerator'

interface OutfitGeneratorProps {
  garments: Garment[]
  onAvailabilityChange: (garment: Garment) => Promise<void>
}

const occasions: OutfitTemplate[] = ['Casual', 'Smart casual', 'Formal', 'Deportivo', 'Frío y capas', 'Calor y pocas capas']
const emptyPreferences: UserPreferences = {
  id: 'current',
  preferredColors: [],
  preferredStyles: [],
  feedbackWeights: {},
  updatedAt: ''
}

function garmentLabel(garment: Garment) {
  return garment.name.trim() || garment.subcategory || garment.category
}

export default function OutfitGenerator({ garments, onAvailabilityChange }: OutfitGeneratorProps) {
  const [occasion, setOccasion] = useState<OutfitTemplate>('Casual')
  const [desiredStyle, setDesiredStyle] = useState('')
  const [temperature, setTemperature] = useState('')
  const [conditions, setConditions] = useState('')
  const [includedIds, setIncludedIds] = useState<string[]>([])
  const [excludedIds, setExcludedIds] = useState<string[]>([])
  const [preferences, setPreferences] = useState<UserPreferences>(emptyPreferences)
  const [savedHistory, setSavedHistory] = useState<Outfit[]>([])
  const [results, setResults] = useState<Array<{ candidate: OutfitCandidate; outfit: Outfit }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const wardrobeStyles = [...new Set(garments.flatMap((garment) => garment.styles).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'))

  useEffect(() => {
    let active = true
    database.open().then(async () => Promise.all([
      database.preferences.get('current'),
      database.outfits.orderBy('createdAt').reverse().limit(20).toArray()
    ])).then(([storedPreferences, history]) => {
      if (!active) return
      setPreferences(storedPreferences ?? emptyPreferences)
      setSavedHistory(history)
    }).catch(() => {
      if (active) setError('No se pudieron cargar las preferencias y el historial del generador.')
    })
    return () => { active = false }
  }, [])

  async function saveGeneratedPreferences(next: UserPreferences) {
    setPreferences(next)
    try {
      await database.open()
      await database.preferences.put(next)
      setNotice('Preferencias guardadas en este dispositivo.')
    } catch {
      setError('No se pudieron guardar las preferencias.')
    }
  }

  function resetPreferences() {
    const reset = { ...emptyPreferences, updatedAt: new Date().toISOString() }
    void saveGeneratedPreferences(reset)
    setDesiredStyle('')
  }

  async function generate() {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      await database.open()
      const selectionEvents = [
        ...includedIds.map((id) => createOutfitFeedback('included', [id])),
        ...excludedIds.map((id) => createOutfitFeedback('excluded', [id]))
      ]
      if (selectionEvents.length) await database.outfitFeedback.bulkAdd(selectionEvents)
      const [latest, history] = await Promise.all([
        database.outfitFeedback.orderBy('createdAt').reverse().limit(250).toArray(),
        database.outfits.orderBy('createdAt').reverse().limit(20).toArray()
      ])
      const context: OutfitContext = {
        occasion,
        desiredStyle: desiredStyle.trim() || undefined,
        temperatureCelsius: temperature === '' ? undefined : Number(temperature),
        weatherConditions: conditions.trim() ? conditions.split(',').map((item) => item.trim()).filter(Boolean) : undefined,
        includeGarmentIds: includedIds,
        excludeGarmentIds: excludedIds
      }
      const candidates = generateOutfitCandidates(garments, context, { preferences, recentOutfits: history, feedback: latest })
      const created = candidates.map((candidate) => ({ candidate, outfit: createOutfitRecord(candidate, context) }))
      setResults(created)
      if (!created.length) setNotice(garments.length ? 'No hay una combinación disponible que cumpla las prendas incluidas y el contexto elegido.' : 'Añade prendas al armario para generar un outfit.')
    } catch {
      setError('No se pudieron generar outfits con los datos locales.')
    } finally {
      setLoading(false)
    }
  }

  async function recordFeedback(type: 'like' | 'dislike' | 'saved' | 'worn', entry: { candidate: OutfitCandidate; outfit: Outfit }) {
    setError('')
    try {
      const actionAt = new Date().toISOString()
      const outfit = {
        ...entry.outfit,
        createdAt: actionAt,
        favorite: type === 'saved' ? true : entry.outfit.favorite,
        wornAt: type === 'worn' ? actionAt : entry.outfit.wornAt
      }
      const event = createOutfitFeedback(type, outfit.garmentIds, outfit.id, actionAt)
      await database.transaction('rw', database.outfits, database.outfitFeedback, async () => {
        await database.outfits.put(outfit)
        await database.outfitFeedback.add(event)
      })
      setSavedHistory(await database.outfits.orderBy('createdAt').reverse().limit(20).toArray())
      setResults((current) => current.filter((item) => item.outfit.id !== entry.outfit.id))
      setNotice(type === 'saved' ? 'Outfit guardado en tus favoritos.' : type === 'worn' ? 'Outfit registrado como utilizado.' : 'Gracias; tu valoración se aplicará a futuras recomendaciones.')
    } catch {
      setError('No se pudo guardar esta acción en el historial local.')
    }
  }

  function updateSelection(id: string, kind: 'include' | 'exclude', checked: boolean) {
    if (kind === 'include') {
      setIncludedIds((current) => checked ? [...current.filter((item) => item !== id), id] : current.filter((item) => item !== id))
      if (checked) setExcludedIds((current) => current.filter((item) => item !== id))
    } else {
      setExcludedIds((current) => checked ? [...current.filter((item) => item !== id), id] : current.filter((item) => item !== id))
      if (checked) setIncludedIds((current) => current.filter((item) => item !== id))
    }
  }

  async function changeAvailability(garment: Garment, availability: Garment['availability']) {
    setError('')
    try {
      await onAvailabilityChange({ ...garment, availability })
    } catch {
      setError('No se pudo guardar la disponibilidad de la prenda.')
    }
  }

  return (
    <section className="feature-screen outfit-generator" aria-labelledby="outfits-title">
      <p className="eyebrow">COMBINACIONES CON INTENCIÓN</p>
      <h1 id="outfits-title">Outfits<span>.</span></h1>
      <p className="page-intro">Recomendaciones locales creadas solo con prendas y fotografías de tu armario. Las reglas son heurísticas iniciales, no una valoración estilística validada científicamente.</p>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="outfit-notice" role="status">{notice}</p>}
      {garments.length === 0 && <p className="outfit-notice" role="status">El armario aún no tiene prendas. Añade prendas para poder generar combinaciones.</p>}

      <div className="outfit-controls">
        <label className="form-field">Ocasión
          <select value={occasion} onChange={(event) => setOccasion(event.target.value as OutfitTemplate)}>
            {occasions.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="form-field">Estilo deseado
          <select value={desiredStyle} onChange={(event) => setDesiredStyle(event.target.value)}>
            <option value="">Sin preferencia</option>
            {wardrobeStyles.map((style) => <option key={style}>{style}</option>)}
          </select>
        </label>
        <label className="form-field">Temperatura (°C, opcional)
          <input type="number" value={temperature} onChange={(event) => setTemperature(event.target.value)} placeholder="Sin datos" />
        </label>
        <label className="form-field">Condiciones (opcional)
          <input value={conditions} onChange={(event) => setConditions(event.target.value)} placeholder="Solo si las conoces" />
        </label>
      </div>

      <details className="garment-selection">
        <summary>Prendas del armario ({garments.length}) · incluir, excluir o marcar disponibilidad</summary>
        {garments.length === 0 ? <p>Aún no hay prendas guardadas.</p> : (
          <div className="garment-selection-list">
            {garments.map((garment) => (
              <div className="garment-selection-row" key={garment.id}>
                <span>{garmentLabel(garment)}</span>
                <label><input type="checkbox" checked={includedIds.includes(garment.id)} onChange={(event) => updateSelection(garment.id, 'include', event.target.checked)} /> Incluir</label>
                <label><input type="checkbox" checked={excludedIds.includes(garment.id)} onChange={(event) => updateSelection(garment.id, 'exclude', event.target.checked)} /> Excluir</label>
                <label>Disponibilidad
                  <select value={garment.availability ?? 'available'} onChange={(event) => void changeAvailability(garment, event.target.value as Garment['availability'])}>
                    <option value="available">Disponible</option>
                    <option value="laundry">En la lavadora</option>
                    <option value="unavailable">No disponible</option>
                  </select>
                </label>
              </div>
            ))}
          </div>
        )}
      </details>

      <details className="preference-settings" open={preferencesOpen} onToggle={(event) => setPreferencesOpen(event.currentTarget.open)}>
        <summary>Preferencias personales</summary>
        <div className="outfit-controls">
          <label className="form-field">Colores preferidos (separados por coma)
            <input value={preferences.preferredColors.join(', ')} onChange={(event) => setPreferences({ ...preferences, preferredColors: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} />
          </label>
          <label className="form-field">Estilos preferidos (separados por coma)
            <input value={preferences.preferredStyles.join(', ')} onChange={(event) => setPreferences({ ...preferences, preferredStyles: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} />
          </label>
          <label className="form-field">Formalidad preferida
            <select value={preferences.preferredFormality ?? ''} onChange={(event) => setPreferences({ ...preferences, preferredFormality: (event.target.value || undefined) as UserPreferences['preferredFormality'] })}>
              <option value="">Sin preferencia</option>
              <option>Casual</option><option>Smart casual</option><option>Formal</option>
            </select>
          </label>
          <div className="preference-actions">
            <button className="button button-outline" type="button" onClick={() => void saveGeneratedPreferences({ ...preferences, updatedAt: new Date().toISOString() })}>Guardar preferencias</button>
            <button className="button button-outline" type="button" onClick={resetPreferences}>Restablecer</button>
          </div>
        </div>
      </details>

      <p className="score-note">
        Puntuación (0–100): ocasión {Math.round(OUTFIT_SCORE_WEIGHTS.occasion * 100)}% (formalidad y contexto), visual/estilo {Math.round(OUTFIT_SCORE_WEIGHTS.visualStyle * 100)}% (colores, estampado y estilo), clima {Math.round(OUTFIT_SCORE_WEIGHTS.thermal * 100)}% (temperatura, capas y temporadas), preferencias {Math.round(OUTFIT_SCORE_WEIGHTS.preference * 100)}% (preferencias y feedback) y rotación {Math.round(OUTFIT_SCORE_WEIGHTS.rotation * 100)}% (repetición reciente). Los atributos ausentes no causan descartes automáticos.
      </p>
      <div className="outfit-generate-actions">
        <button className="button button-dark" type="button" onClick={() => void generate()} disabled={loading || garments.length === 0}>
          {loading ? 'Generando…' : 'Generar outfits'}
        </button>
        <button className="button button-outline" type="button" onClick={() => { setResults([]); void generate() }} disabled={loading || garments.length === 0}>Regenerar</button>
      </div>

      {loading && <div className="loading-state" role="status">Combinando prendas disponibles…</div>}
      {!loading && results.length > 0 && <div className="outfit-results">
        {results.map((entry, index) => (
          <article className="outfit-card" key={entry.outfit.id}>
            <header><div><p className="eyebrow">RECOMENDACIÓN {index + 1}</p><h2>{occasion} · {entry.outfit.score}/100</h2></div></header>
            <div className="outfit-garments">
              {entry.candidate.garments.map((garment) => (
                <figure key={garment.id}><GarmentPhoto image={garment.thumbnail ?? garment.image} alt={garmentLabel(garment)} /><figcaption>{garmentLabel(garment)}</figcaption></figure>
              ))}
            </div>
            <p className="outfit-explanation">Recomendado por {entry.candidate.explanation.join(' · ')}.</p>
            <div className="outfit-actions">
              <button type="button" className="button button-outline" onClick={() => void recordFeedback('like', entry)}>Me gusta</button>
              <button type="button" className="button button-outline" onClick={() => void recordFeedback('dislike', entry)}>No me gusta</button>
              <button type="button" className="button button-outline" onClick={() => void recordFeedback('saved', entry)}>Guardar</button>
              <button type="button" className="button button-dark" onClick={() => void recordFeedback('worn', entry)}>Lo he usado</button>
              <button type="button" className="button button-outline" onClick={() => void recordFeedback('dislike', entry)}>Descartar</button>
            </div>
          </article>
        ))}
      </div>}
      {savedHistory.length > 0 && <section className="outfit-history" aria-labelledby="outfit-history-title">
        <h2 id="outfit-history-title">Favoritos e historial local</h2>
        <div className="outfit-results">
          {savedHistory.map((outfit) => {
            const outfitGarments = outfit.garmentIds
              .map((id) => garments.find((garment) => garment.id === id))
              .filter((garment): garment is Garment => Boolean(garment))
            return <article className="outfit-card" key={outfit.id}>
              <p className="eyebrow">{outfit.favorite ? 'GUARDADO' : 'HISTORIAL'} · {outfit.score}/100</p>
              <h3>{outfit.occasion}</h3>
              {outfitGarments.length === outfit.garmentIds.length
                ? <div className="outfit-garments">{outfitGarments.map((garment) => <figure key={garment.id}><GarmentPhoto image={garment.thumbnail ?? garment.image} alt={garmentLabel(garment)} /><figcaption>{garmentLabel(garment)}</figcaption></figure>)}</div>
                : <p>Algunas prendas de este outfit ya no están en el armario.</p>}
              <p className="outfit-explanation">{outfit.wornAt ? 'Utilizado' : outfit.favorite ? 'Favorito' : 'Valoración registrada'} · {new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(outfit.wornAt ?? outfit.createdAt))}</p>
            </article>
          })}
        </div>
      </section>}
    </section>
  )
}
