import { useEffect, useRef, useState, type TouchEvent } from 'react'
import { database } from '../db/database'
import type { Garment, Outfit, UserPreferences } from '../types/domain'
import GarmentPhoto from './GarmentPhoto'
import { getCityForecast } from '../weather/openMeteo'
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
type OutfitView = 'generate' | 'saved' | 'create'

function tomorrow() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function garmentLabel(garment: Garment) {
  return garment.name.trim() || garment.subcategory || garment.category
}

export default function OutfitGenerator({ garments, onAvailabilityChange }: OutfitGeneratorProps) {
  const [occasion, setOccasion] = useState<OutfitTemplate>('Casual')
  const [view, setView] = useState<OutfitView>('generate')
  const [desiredStyle, setDesiredStyle] = useState('')
  const [temperature, setTemperature] = useState('')
  const [conditions, setConditions] = useState('')
  const [weatherCity, setWeatherCity] = useState('')
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualIds, setManualIds] = useState<string[]>([])
  const touchStart = useRef<{ x: number; y: number } | null>(null)
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

  async function loadTomorrowWeather() {
    setError('')
    setWeatherLoading(true)
    try {
      const forecast = await getCityForecast(weatherCity, tomorrow(), 1)
      const [tomorrowsWeather] = forecast
      if (!tomorrowsWeather) throw new Error('No hay previsión disponible para mañana.')
      setTemperature(String(tomorrowsWeather.temperatureCelsius))
      setConditions(tomorrowsWeather.conditions.join(', '))
      setNotice(`Tiempo de mañana en ${weatherCity.trim()}: ${tomorrowsWeather.temperatureCelsius} °C, ${tomorrowsWeather.conditions.join(', ')}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo consultar el pronóstico.')
    } finally {
      setWeatherLoading(false)
    }
  }

  async function saveManualOutfit() {
    setError('')
    setNotice('')
    const chosenGarments = garments.filter((garment) => manualIds.includes(garment.id))
    if (!chosenGarments.length) {
      setError('Selecciona al menos una prenda para crear el outfit.')
      return
    }
    try {
      const outfit: Outfit = {
        id: crypto.randomUUID(),
        garmentIds: chosenGarments.map((garment) => garment.id),
        occasion: 'Personalizado',
        kind: 'manual',
        name: manualName.trim() || `Outfit ${new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date())}`,
        score: 100,
        createdAt: new Date().toISOString(),
        favorite: true
      }
      await database.outfits.put(outfit)
      setSavedHistory(await database.outfits.orderBy('createdAt').reverse().limit(20).toArray())
      setManualName('')
      setManualIds([])
      setView('saved')
      setNotice('Outfit guardado en este dispositivo.')
    } catch {
      setError('No se pudo guardar el outfit personalizado.')
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

  function finishSwipe(event: TouchEvent<HTMLElement>, entry: { candidate: OutfitCandidate; outfit: Outfit }) {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const touch = event.changedTouches[0]
    if (!touch) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) > 90 && Math.abs(deltaX) > Math.abs(deltaY)) {
      void recordFeedback(deltaX > 0 ? 'like' : 'dislike', entry)
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

      <div className="outfit-tabs" role="tablist" aria-label="Secciones de outfits">
        <button type="button" role="tab" aria-selected={view === 'generate'} onClick={() => setView('generate')}>Generar</button>
        <button type="button" role="tab" aria-selected={view === 'saved'} onClick={() => setView('saved')}>Guardados</button>
        <button type="button" role="tab" aria-selected={view === 'create'} onClick={() => setView('create')}>Crear outfit</button>
      </div>

      {view === 'generate' && <>
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
        <label className="form-field">Ciudad para consultar el tiempo
          <input value={weatherCity} onChange={(event) => setWeatherCity(event.target.value)} placeholder="p. ej. Castellón" />
        </label>
        <div className="weather-action">
          <button className="button button-outline" type="button" onClick={() => void loadTomorrowWeather()} disabled={weatherLoading || !weatherCity.trim()}>
            {weatherLoading ? 'Consultando…' : 'Usar tiempo de mañana'}
          </button>
          <span>Consulta opcional a Open-Meteo. Los datos se usan solo como contexto.</span>
        </div>
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
      {!loading && results.length > 0 && <div className="outfit-results outfit-swipe-list">
        {results.map((entry, index) => (
          <article className="outfit-card" key={entry.outfit.id}
            onTouchStart={(event) => { touchStart.current = { x: event.touches[0]?.clientX ?? 0, y: event.touches[0]?.clientY ?? 0 } }}
            onTouchEnd={(event) => finishSwipe(event, entry)}>
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
              <button type="button" className="button button-outline" onClick={() => void recordFeedback('dislike', entry)}>Descartar / deslizar a la izquierda</button>
            </div>
            <p className="swipe-hint">En móvil, desliza a la derecha para valorar positivamente o a la izquierda para descartar. También puedes usar estos botones.</p>
          </article>
        ))}
      </div>}
      </>}

      {view === 'create' && <section className="manual-outfit" aria-labelledby="create-outfit-title">
        <h2 id="create-outfit-title">Crear outfit con tus prendas</h2>
        <label className="form-field">Nombre del outfit
          <input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="p. ej. Look para la oficina" />
        </label>
        <div className="manual-garment-list">
          {garments.map((garment) => (
            <label key={garment.id}>
              <input type="checkbox" checked={manualIds.includes(garment.id)} onChange={(event) => setManualIds((current) => event.target.checked
                ? [...current, garment.id]
                : current.filter((id) => id !== garment.id))} />
              <span>{garmentLabel(garment)}</span>
            </label>
          ))}
        </div>
        <button className="button button-dark" type="button" onClick={() => void saveManualOutfit()} disabled={!garments.length}>Guardar outfit</button>
      </section>}

      {view === 'saved' && <section className="outfit-history" aria-labelledby="outfit-history-title">
        <h2 id="outfit-history-title">Outfits guardados</h2>
        {savedHistory.filter((outfit) => outfit.favorite || outfit.kind === 'manual').length === 0
          ? <p className="outfit-notice">Todavía no hay outfits guardados. Guarda una recomendación o crea uno con tus prendas.</p>
          : <div className="outfit-results">
            {savedHistory.filter((outfit) => outfit.favorite || outfit.kind === 'manual').map((outfit) => {
              const outfitGarments = outfit.garmentIds
                .map((id) => garments.find((garment) => garment.id === id))
                .filter((garment): garment is Garment => Boolean(garment))
              return <article className="outfit-card" key={outfit.id}>
                <p className="eyebrow">{outfit.kind === 'manual' ? 'CREADO POR TI' : 'GENERADO Y GUARDADO'} · {outfit.score}/100</p>
                <h3>{outfit.name || outfit.occasion}</h3>
                {outfitGarments.length === outfit.garmentIds.length
                  ? <div className="outfit-garments">{outfitGarments.map((garment) => <figure key={garment.id}><GarmentPhoto image={garment.thumbnail ?? garment.image} alt={garmentLabel(garment)} /><figcaption>{garmentLabel(garment)}</figcaption></figure>)}</div>
                  : <p>Algunas prendas de este outfit ya no están en el armario.</p>}
                <p className="outfit-explanation">{outfit.wornAt ? 'Utilizado' : 'Guardado'} · {new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(outfit.wornAt ?? outfit.createdAt))}</p>
              </article>
            })}
          </div>}
      </section>}

      {view === 'generate' && savedHistory.some((outfit) => outfit.wornAt && !outfit.favorite) && <section className="outfit-history" aria-labelledby="worn-history-title">
        <h2 id="worn-history-title">Historial de uso</h2>
        <p>Los outfits que marcaste como usados se guardan en este dispositivo.</p>
      </section>}
    </section>
  )
}
