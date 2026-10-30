import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Garment } from '../types/domain'
import TripPlanner from './TripPlanner'

function garment(id: string, role: Garment['role']): Garment {
  return {
    id,
    name: id,
    category: role === 'Top' ? 'Parte superior' : 'Parte inferior',
    subcategory: '',
    colors: [],
    seasons: [],
    styles: [],
    dressLevels: ['Diario'],
    role,
    image: new Blob(['image']),
    thumbnail: new Blob(['thumbnail']),
    width: 100,
    height: 100,
    confirmedAttributes: [],
    suggestedAttributes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('TripPlanner', () => {
  it('uses the destination forecast to propose outfits and an editable unique packing list', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('geocoding-api')) {
        return {
          ok: true,
          json: async () => ({ results: [{ name: 'Valencia', latitude: 39.47, longitude: -0.37 }] })
        }
      }
      const startDate = new URL(String(input)).searchParams.get('start_date')
      const nextDate = new Date(`${startDate}T12:00:00`)
      nextDate.setDate(nextDate.getDate() + 1)
      const followingDate = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`
      nextDate.setDate(nextDate.getDate() + 1)
      const afterFollowingDate = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`
      return {
        ok: true,
        json: async () => ({
          daily: {
            time: [startDate, followingDate, afterFollowingDate],
            temperature_2m_max: [20, 19, 18],
            temperature_2m_min: [12, 11, 10],
            weather_code: [2, 61, 0]
          }
        })
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<TripPlanner garments={[garment('top', 'Top'), garment('bottom', 'Bottom')]} />)

    await user.type(screen.getByLabelText('Destino'), 'Valencia')
    await user.clear(screen.getByLabelText('Duración (días)'))
    await user.type(screen.getByLabelText('Duración (días)'), '2')
    await user.click(screen.getByRole('button', { name: 'Preparar propuesta de maleta' }))

    expect(await screen.findByText(/16 °C · parcialmente nuboso/)).toBeInTheDocument()
    expect(await screen.findByText(/15 °C · lluvia/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lista de maleta 2 prendas' })).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
