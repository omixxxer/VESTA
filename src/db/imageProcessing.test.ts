import { afterEach, describe, expect, it, vi } from 'vitest'
import { createThumbnail, reducedSize, reducePhoto } from './imageProcessing'

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
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, fillRect: vi.fn() } as unknown as CanvasRenderingContext2D)
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

describe('reducePhoto', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stubImage(width: number, height: number, encoded: Blob) {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close: vi.fn() })))
    const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) { callback(encoded) })
    return context
  }

  it('keeps small photos and reduces large ones to 2048 px', () => {
    expect(reducedSize(1200, 900, 300_000)).toBeUndefined()
    expect(reducedSize(4032, 3024, 3_000_000)).toEqual({ width: 2048, height: 1536 })
    expect(reducedSize(1500, 2000, 2_000_000)).toEqual({ width: 1500, height: 2000 }) // heavy file, same size
  })

  it('re-encodes a phone photo at 2048 px on a white background', async () => {
    const encoded = new Blob(['x'.repeat(10)], { type: 'image/jpeg' })
    const context = stubImage(4032, 3024, encoded)
    const result = await reducePhoto(new Blob(['x'.repeat(2_000_000)], { type: 'image/png' }))
    expect(result).toBe(encoded)
    expect(context.fillStyle).toBe('#ffffff')
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 1536)
  })

  it('keeps the original when it is small, or when re-encoding would not make it lighter', async () => {
    const small = new Blob(['photo'], { type: 'image/jpeg' })
    stubImage(800, 600, new Blob(['ignored']))
    expect(await reducePhoto(small)).toBe(small)

    const heavy = new Blob(['x'.repeat(1_100_000)], { type: 'image/jpeg' })
    stubImage(1600, 1200, new Blob(['x'.repeat(1_200_000)], { type: 'image/jpeg' }))
    expect(await reducePhoto(heavy)).toBe(heavy)
  })
})
