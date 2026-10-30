import { database } from '../db/database'
import { createWardrobeBackup, readWardrobeBackup, type WardrobeBackup } from '../db/wardrobeBackup'
import { currentToken, signIn, type GoogleToken } from './googleAuth'
import { downloadDriveBackup, findDriveBackup, uploadDriveBackup, type DriveBackupInfo } from './googleDrive'

// Saving the wardrobe to the user's Google Drive and restoring it. Per-device settings live in localStorage:
// they say nothing about the wardrobe beyond when it was last saved.

const SETTINGS_KEY = 'vesta-drive'

export interface DriveSettings {
  autoSave: boolean
  /** modifiedTime of the Drive copy when this device last saved or restored it. */
  knownDriveVersion?: string
  /** When this device last saved to Drive. */
  lastSavedAt?: string
  /** Fingerprint of the wardrobe at the last save, to know whether there is anything new to save. */
  savedFingerprint?: string
}

export function loadDriveSettings(): DriveSettings {
  try {
    return { autoSave: false, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<DriveSettings> }
  } catch {
    return { autoSave: false }
  }
}

export function saveDriveSettings(settings: DriveSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Without storage the settings only last this visit.
  }
}

/** The Drive copy changed since this device last saw it: another device saved over it. */
export class DriveConflictError extends Error {
  constructor(readonly remote: DriveBackupInfo) {
    super('La copia de Google Drive se ha guardado desde otro dispositivo. Restáurala (combinando) antes de guardar, para no perder esos cambios.')
  }
}

/** No valid Google session and no user action to open the sign-in window (automatic save). */
export class SignInNeededError extends Error {
  constructor() {
    super('Conecta con Google Drive para seguir guardando automáticamente.')
  }
}

/**
 * What the backup depends on, without photos: garment ids and edit times, outfits, preferences, feedback and
 * code counters. Only Dexie calls, so it can be observed with liveQuery.
 */
export function wardrobeState() {
  return Promise.all([
    database.garments.toCollection().primaryKeys(),
    database.garments.orderBy('updatedAt').keys(),
    database.outfits.toArray(),
    database.preferences.toArray(),
    database.outfitFeedback.count(),
    database.garmentCodeCounters.toArray()
  ])
}

/** A short digest of wardrobeState that changes whenever something in the backup changes. */
export async function fingerprintOf(state: Awaited<ReturnType<typeof wardrobeState>>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(state)))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function token(interactive: boolean): Promise<GoogleToken> {
  const valid = currentToken()
  if (valid) return valid
  if (!interactive) throw new SignInNeededError()
  return signIn()
}

export interface SaveOptions {
  /** From a click: may open Google's sign-in window. */
  interactive: boolean
  /** Save even if another device changed the Drive copy (the user confirmed it). */
  overwrite?: boolean
  onProgress?: (fraction: number) => void
}

export async function saveToDrive(settings: DriveSettings, options: SaveOptions): Promise<DriveSettings> {
  const access = await token(options.interactive)
  const remote = await findDriveBackup(access)
  if (remote && !options.overwrite && remote.modifiedTime !== settings.knownDriveVersion) {
    throw new DriveConflictError(remote)
  }
  const fingerprint = await fingerprintOf(await wardrobeState())
  const saved = await uploadDriveBackup(access, await createWardrobeBackup(), remote?.id, options.onProgress)
  return { ...settings, knownDriveVersion: saved.modifiedTime, lastSavedAt: new Date().toISOString(), savedFingerprint: fingerprint }
}

export interface DriveRestore {
  backup: WardrobeBackup
  remote: DriveBackupInfo
}

/** Downloads and reads the Drive copy; nothing is written until the user chooses how to import it. */
export async function readFromDrive(): Promise<DriveRestore> {
  const access = await token(true)
  const remote = await findDriveBackup(access)
  if (!remote) throw new Error('Todavía no hay ninguna copia de VESTA en tu Google Drive.')
  return { backup: await readWardrobeBackup(await downloadDriveBackup(access, remote.id)), remote }
}
