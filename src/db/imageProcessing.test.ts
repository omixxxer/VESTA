import { afterEach, describe, expect, it, vi } from 'vitest'
import { createThumbnail } from './imageProcessing'

describe('createThumbnail', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps source dimensions and creates a scaled local thumbnail', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 1280,
      height: 640,
      close
    })))
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
      callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
    })

    const result = await createThumbnail(new Blob(['source'], { type: 'image/png' }))

    expect(result).toMatchObject({ width: 1280, height: 640 })
    expect(result.thumbnail.type).toBe('image/jpeg')
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 640, 320)
    expect(close).toHaveBeenCalledOnce()
  })
})
