export interface DailyWeather {
  date: string
  temperatureCelsius: number
  conditions: string[]
}

interface GeocodingResult {
  results?: Array<{ name: string; latitude: number; longitude: number; country?: string }>
}

interface ForecastResult {
  daily?: {
    time: string[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    weather_code: number[]
  }
}

const weatherDescriptions: Record<number, string> = {
  0: 'despejado',
  1: 'mayormente despejado',
  2: 'parcialmente nuboso',
  3: 'nuboso',
  45: 'niebla',
  48: 'niebla',
  51: 'llovizna',
  53: 'llovizna',
  55: 'llovizna',
  61: 'lluvia',
  63: 'lluvia',
  65: 'lluvia intensa',
  71: 'nieve',
  73: 'nieve',
  75: 'nieve intensa',
  80: 'chubascos',
  81: 'chubascos',
  82: 'chubascos intensos',
  95: 'tormenta',
  96: 'tormenta',
  99: 'tormenta'
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Open-Meteo respondió con ${response.status}.`)
  return response.json() as Promise<T>
}

export async function getCityForecast(city: string, startDate: string, days: number): Promise<DailyWeather[]> {
  const query = city.trim()
  if (!query) throw new Error('Indica una ciudad para consultar el tiempo.')
  if (!Number.isInteger(days) || days < 1 || days > 14) throw new Error('El viaje debe durar entre 1 y 14 días.')
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const today = new Date()
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const startOffset = Math.round((start - todayUtc) / 86_400_000)
  if (!Number.isFinite(start) || startOffset < 0 || startOffset + days > 16) {
    throw new Error('El pronóstico solo cubre fechas desde hoy y hasta 16 días vista. Ajusta la fecha o la duración.')
  }

  const geocodingUrl = new URL('https://geocoding-api.open-meteo.com/v1/search')
  geocodingUrl.search = new URLSearchParams({ name: query, count: '1', language: 'es', format: 'json' }).toString()
  const geocoding = await fetchJson<GeocodingResult>(geocodingUrl)
  const location = geocoding.results?.[0]
  if (!location) throw new Error(`No se encontró la ciudad «${query}». Prueba con otro nombre.`)

  const end = new Date(`${startDate}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + days - 1)
  const endDate = end.toISOString().slice(0, 10)
  const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast')
  forecastUrl.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    daily: 'temperature_2m_max,temperature_2m_min,weather_code',
    timezone: 'auto',
    start_date: startDate,
    end_date: endDate
  }).toString()
  const forecast = await fetchJson<ForecastResult>(forecastUrl)
  const daily = forecast.daily
  if (!daily || daily.time.length < days) {
    throw new Error('El pronóstico no cubre todas las fechas del viaje. Elige fechas más próximas.')
  }

  return daily.time.slice(0, days).map((date, index) => {
    const high = daily.temperature_2m_max[index]
    const low = daily.temperature_2m_min[index]
    const weatherCode = daily.weather_code[index]
    if (high === undefined || low === undefined || weatherCode === undefined) {
      throw new Error('La respuesta meteorológica está incompleta.')
    }
    return {
      date,
      temperatureCelsius: Math.round((high + low) / 2),
      conditions: [weatherDescriptions[weatherCode] ?? 'condiciones variables']
    }
  })
}
