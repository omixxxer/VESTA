import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCityForecast } from './openMeteo'

afterEach(() => vi.unstubAllGlobals())

function dateFromToday(offset: number) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

describe('Open-Meteo forecast client', () => {
  it('resolves a city and returns the requested daily weather without wardrobe data', async () => {
    const startDate = dateFromToday(1)
    const nextDate = dateFromToday(2)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ name: 'Valencia', latitude: 39.47, longitude: -0.37 }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          daily: {
            time: [startDate, nextDate],
            temperature_2m_max: [20, 19],
            temperature_2m_min: [12, 11],
            weather_code: [2, 61]
          }
        })
      })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCityForecast(' Valencia ', startDate, 2)).resolves.toEqual([
      { date: startDate, temperatureCelsius: 16, conditions: ['parcialmente nuboso'] },
      { date: nextDate, temperatureCelsius: 15, conditions: ['lluvia'] }
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('name=Valencia')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('latitude=39.47')
  })

  it('reports an unknown city and rejects invalid trip durations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    }))
    const startDate = dateFromToday(1)
    await expect(getCityForecast('Ciudad inventada', startDate, 1)).rejects.toThrow('No se encontró la ciudad')
    await expect(getCityForecast('Valencia', startDate, 15)).rejects.toThrow('entre 1 y 14 días')
  })
})
