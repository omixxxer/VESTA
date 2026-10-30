// @vitest-environment node
// Real Blobs and crypto.subtle for the backup and its fingerprint.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { database } from '../db/database'
import { DriveConflictError, fingerprintOf, readFromDrive, saveToDrive, SignInNeededError, wardrobeState } from './driveSync'
import { currentToken, signIn } from './googleAuth'
import { downloadDriveBackup, findDriveBackup, uploadDriveBackup } from './googleDrive'

vi.mock('./googleAuth', () => ({ currentToken: vi.fn(), signIn: vi.fn() }))
vi.mock('./googleDrive', () => ({ findDriveBackup: vi.fn(), uploadDriveBackup: vi.fn(), downloadDriveBackup: vi.fn() }))

const token = { accessToken: 'abc', expiresAt: Date.now() + 3_600_000 }
const remote = { id: 'f1', modifiedTime: '2026-10-30T10:00:00.000Z', size: 10 }

afterEach(async () => {
  vi.resetAllMocks()
  await database.outfits.clear()
})

describe('drive sync', () => {
  it('does not open a sign-in window for an automatic save without a session', async () => {
    await expect(saveToDrive({ autoSave: true }, { interactive: false })).rejects.toBeInstanceOf(SignInNeededError)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('creates the copy, then refuses to overwrite one another device saved meanwhile', async () => {
    vi.mocked(currentToken).mockReturnValue(token)
    vi.mocked(findDriveBackup).mockResolvedValueOnce(undefined)
    vi.mocked(uploadDriveBackup).mockResolvedValueOnce(remote)
    const settings = await saveToDrive({ autoSave: true }, { interactive: false })
    expect(uploadDriveBackup).toHaveBeenCalledWith(token, expect.any(Blob), undefined, undefined)
    expect(settings).toMatchObject({ autoSave: true, knownDriveVersion: remote.modifiedTime })
    expect(settings.savedFingerprint).toBe(await fingerprintOf(await wardrobeState()))

    // Unchanged on Drive: this device replaces its own copy.
    vi.mocked(findDriveBackup).mockResolvedValueOnce(remote)
    vi.mocked(uploadDriveBackup).mockResolvedValueOnce({ ...remote, modifiedTime: '2026-10-30T11:00:00.000Z' })
    const next = await saveToDrive(settings, { interactive: false })
    expect(uploadDriveBackup).toHaveBeenLastCalledWith(token, expect.any(Blob), 'f1', undefined)

    // Another device saved in between: no upload unless the user chooses to overwrite.
    const other = { ...remote, modifiedTime: '2026-10-30T12:00:00.000Z' }
    vi.mocked(findDriveBackup).mockResolvedValue(other)
    await expect(saveToDrive(next, { interactive: false })).rejects.toBeInstanceOf(DriveConflictError)
    expect(uploadDriveBackup).toHaveBeenCalledTimes(2)
    vi.mocked(uploadDriveBackup).mockResolvedValueOnce({ ...other, modifiedTime: '2026-10-30T13:00:00.000Z' })
    expect(await saveToDrive(next, { interactive: true, overwrite: true })).toMatchObject({ knownDriveVersion: '2026-10-30T13:00:00.000Z' })
  })

  it('changes the fingerprint when the wardrobe changes', async () => {
    const before = await fingerprintOf(await wardrobeState())
    await database.outfits.add({ id: 'o1', garmentIds: [], occasion: 'Diario', score: 1, createdAt: '2026-01-01T00:00:00.000Z', favorite: true })
    expect(await fingerprintOf(await wardrobeState())).not.toBe(before)
  })

  it('says so when there is no copy on Drive yet', async () => {
    vi.mocked(signIn).mockResolvedValue(token)
    vi.mocked(findDriveBackup).mockResolvedValue(undefined)
    await expect(readFromDrive()).rejects.toThrow('Todavía no hay ninguna copia')
    expect(downloadDriveBackup).not.toHaveBeenCalled()
  })
})
