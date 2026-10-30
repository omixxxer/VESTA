// @vitest-environment node
// Node's fetch types (Response, Headers) and real Blobs; no DOM needed.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DRIVE_SCOPE, parseTokenFragment } from './googleAuth'
import { DriveAuthError, downloadDriveBackup, findDriveBackup, uploadDriveBackup } from './googleDrive'

const token = { accessToken: 'abc', expiresAt: Date.now() + 3_600_000 }

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })
}

afterEach(() => vi.unstubAllGlobals())

describe('google sign-in response', () => {
  it('accepts a token for our request with the Drive scope', () => {
    const fragment = `access_token=tok&expires_in=3599&state=s1&scope=${encodeURIComponent(DRIVE_SCOPE)}&token_type=Bearer`
    expect(parseTokenFragment(fragment, 's1', 1_000)).toEqual({ accessToken: 'tok', expiresAt: 1_000 + 3539 * 1000 })
  })

  it('rejects another request, a denial or a missing scope', () => {
    expect(() => parseTokenFragment('access_token=tok&expires_in=3599&state=other', 's1')).toThrow('no corresponde')
    expect(() => parseTokenFragment('error=access_denied&state=s1', 's1')).toThrow('cancelado')
    expect(() => parseTokenFragment('access_token=tok&expires_in=3599&state=s1&scope=email', 's1')).toThrow('permitir el acceso')
  })
})

describe('google drive', () => {
  it('finds the backup in the app folder', async () => {
    const fetch = vi.fn(async () => json({ files: [{ id: 'f1', modifiedTime: '2026-10-30T10:00:00.000Z', size: '1234' }] }))
    vi.stubGlobal('fetch', fetch)
    expect(await findDriveBackup(token)).toEqual({ id: 'f1', modifiedTime: '2026-10-30T10:00:00.000Z', size: 1234 })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('spaces=appDataFolder')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc')
  })

  it('uploads in parts, continuing from what Drive says it received', async () => {
    const archive = new Blob([new Uint8Array(20 * 1024 * 1024)], { type: 'application/zip' })
    const ranges: string[] = []
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('uploadType=resumable')) {
        expect(init.method).toBe('POST')
        expect(JSON.parse(init.body as string)).toMatchObject({ name: 'vesta-armario.zip', parents: ['appDataFolder'] })
        return new Response(null, { status: 200, headers: { Location: 'https://upload.example/session' } })
      }
      const range = (init.headers as Record<string, string>)['Content-Range']!
      ranges.push(range)
      // Drive keeps only the first 4 MB of the first part: the next one starts there.
      if (ranges.length === 1) return new Response(null, { status: 308, headers: { Range: 'bytes=0-4194303' } })
      const end = Number(/-(\d+)\//.exec(range)![1])
      return end + 1 < archive.size
        ? new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } })
        : json({ id: 'f2', modifiedTime: '2026-10-30T11:00:00.000Z', size: String(archive.size) })
    })
    vi.stubGlobal('fetch', fetch)
    const progress: number[] = []
    const saved = await uploadDriveBackup(token, archive, undefined, (fraction) => progress.push(fraction))
    expect(saved).toEqual({ id: 'f2', modifiedTime: '2026-10-30T11:00:00.000Z', size: archive.size })
    expect(ranges).toEqual([
      'bytes 0-8388607/20971520',
      'bytes 4194304-12582911/20971520',
      'bytes 12582912-20971519/20971520'
    ])
    expect(progress.at(-1)).toBe(1)
  })

  it('replaces the existing file and downloads it back', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes('uploadType=resumable')) {
        expect(url).toContain('/files/f1?')
        expect(init.method).toBe('PATCH')
        return new Response(null, { status: 200, headers: { Location: 'https://upload.example/session' } })
      }
      if (url.includes('alt=media')) return new Response('zip-bytes')
      return json({ id: 'f1', modifiedTime: '2026-10-30T12:00:00.000Z' })
    })
    vi.stubGlobal('fetch', fetch)
    await uploadDriveBackup(token, new Blob(['zip']), 'f1')
    expect(await (await downloadDriveBackup(token, 'f1')).text()).toBe('zip-bytes')
  })

  it('asks to sign in again when the token is rejected, and explains a full Drive', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
    await expect(findDriveBackup(token)).rejects.toBeInstanceOf(DriveAuthError)
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'The user has exceeded their Drive storage quota' } }, { status: 403 })))
    await expect(findDriveBackup(token)).rejects.toThrow('No queda espacio')
  })
})
