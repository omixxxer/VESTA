import { useState } from 'react'
import type { Garment, Outfit } from '../types/domain'
import { createOutfitRecord, generateOutfitCandidates } from '../outfits/outfitGenerator'
import { getCityForecast, type DailyWeather } from '../weather/openMeteo'
import GarmentPhoto from './GarmentPhoto'

interface TripDay {
  weather: DailyWeather
  outfit: Garment[]
  score: number
}

function localDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function tomorrow() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return localDate(date)
}

function label(garment: Garment) {
  return garment.name.trim() || garment.subcategory || garment.category
}

export default function TripPlanner({ garments }: { garments: Garment[] }) {
  const [city, setCity] = useState('')
  const [startDate, setStartDate] = useState(tomorrow)
  const [days, setDays] = useState('3')
  const [tripDays, setTripDays] = useState<TripDay[]>([])
  const [packedIds, setPackedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function planTrip() {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      const forecast = await getCityForecast(city, startDate, Number(days))
      const recent: Outfit[] = []
      const proposed: TripDay[] = forecast.map((weather) => {
        const candidate = generateOutfitCandidates(garments, {
          occasion: 'Casual',
          temperatureCelsius: weather.temperatureCelsius,
          weatherConditions: weather.conditions
        }, { recentOutfits: recent, limit: 1 })[0]
        if (!candidate) return { weather, outfit: [], score: 0 }
        const outfit = createOutfitRecord(candidate, {
          occasion: 'Viaje',
          temperatureCelsius: weather.temperatureCelsius,
          weatherConditions: weather.conditions
        })
        recent.unshift(outfit)
        return { weather, outfit: candidate.garments, score: candidate.score }
      })
      setTripDays(proposed)
      const proposedIds = [...new Set(proposed.flatMap((day) => day.outfit.map((garment) => garment.id)))]
      setPackedIds(proposedIds)
      if (proposed.every((day) => !day.outfit.length)) {
        setNotice('No hay suficientes prendas disponibles para proponer outfits. Añade prendas superiores e inferiores o un vestido/mono.')
      } else if (proposed.some((day) => !day.outfit.length)) {
        setNotice('Algunos días no tienen una combinación posible con las prendas disponibles.')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo preparar la maleta.')
    } finally {
      setLoading(false)
    }
  }

  const packedGarments = [...new Set(tripDays.flatMap((day) => day.outfit))]
    .filter((garment) => packedIds.includes(garment.id))

  return (
    <section className="feature-screen trip-planner" aria-labelledby="trip-title">
      <p className="eyebrow">VIAJA CON LO QUE YA TIENES</p>
      <h1 id="trip-title">Maleta<span>.</span></h1>
      <p className="page-intro">Consulta el pronóstico y crea propuestas diarias usando únicamente las prendas de tu armario. La previsión se solicita a Open-Meteo; tu inventario permanece en este dispositivo.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="outfit-notice" role="status">{notice}</p>}
      <div className="outfit-controls">
        <label className="form-field">Destino
          <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="p. ej. Valencia" autoComplete="address-level2" />
        </label>
        <label className="form-field">Primer día
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="form-field">Duración (días)
          <input type="number" min="1" max="14" value={days} onChange={(event) => setDays(event.target.value)} />
        </label>
      </div>
      <p className="score-note">El servicio ofrece previsión de hasta 14 días. Para fechas más lejanas, usa una fecha dentro del pronóstico disponible.</p>
      <button className="button button-dark" type="button" onClick={() => void planTrip()} disabled={loading || !garments.length}>
        {loading ? 'Consultando el tiempo…' : 'Preparar propuesta de maleta'}
      </button>
      {!garments.length && <p className="outfit-notice" role="status">Añade prendas al armario antes de planificar un viaje.</p>}

      {tripDays.length > 0 && <>
        <section className="outfit-history" aria-labelledby="trip-outfits-title">
          <h2 id="trip-outfits-title">Outfits propuestos</h2>
          <div className="trip-days">
            {tripDays.map(({ weather, outfit, score }) => (
              <article className="outfit-card" key={weather.date}>
                <p className="eyebrow">{new Intl.DateTimeFormat('es', { dateStyle: 'full' }).format(new Date(`${weather.date}T12:00:00`))}</p>
                <h3>{weather.temperatureCelsius} °C · {weather.conditions.join(', ')}{score ? ` · ${score}/100` : ''}</h3>
                {outfit.length ? (
                  <div className="outfit-garments">{outfit.map((garment) => (
                    <figure key={garment.id}>
                      <GarmentPhoto image={garment.thumbnail ?? garment.image} alt={label(garment)} />
                      <figcaption>{label(garment)}</figcaption>
                    </figure>
                  ))}</div>
                ) : <p>No se pudo formar una combinación con las prendas disponibles.</p>}
              </article>
            ))}
          </div>
        </section>
        {packedGarments.length > 0 && <section className="outfit-history" aria-labelledby="packing-list-title">
          <h2 id="packing-list-title">Lista de maleta <span className="packing-count">{packedGarments.length} prendas</span></h2>
          <p className="score-note">La lista reúne las prendas distintas de los outfits. Puedes ajustar la selección; el mismo artículo puede aparecer en varios días.</p>
          <div className="packing-list">
            {packedGarments.map((garment) => (
              <label className="packing-item" key={garment.id}>
                <input
                  type="checkbox"
                  checked={packedIds.includes(garment.id)}
                  onChange={(event) => setPackedIds((current) => event.target.checked
                    ? [...current, garment.id]
                    : current.filter((id) => id !== garment.id))}
                />
                <GarmentPhoto image={garment.thumbnail ?? garment.image} alt="" />
                <span>{label(garment)}</span>
              </label>
            ))}
          </div>
        </section>}
      </>}
    </section>
  )
}
