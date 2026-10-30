import { liveQuery } from 'dexie'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DriveConflictError,
  fingerprintOf,
  loadDriveSettings,
  readFromDrive,
  saveDriveSettings,
  saveToDrive,
  SignInNeededError,
  wardrobeState,
  type DriveRestore,
  type DriveSettings
} from './driveSync'
import { googleClientId } from './googleAuth'
import { DriveAuthError } from './googleDrive'

/** Wait after the last change before saving automatically, so a burst of edits makes one upload. */
export const AUTO_SAVE_DELAY_MS = 30_000

export type DriveStatus =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'saving'; progress: number }
  | { kind: 'saved'; at: string }
  | { kind: 'error'; message: string; reason: 'sign-in' | 'conflict' | 'other' }

export interface DriveSync {
  /** False when this build has no Google client ID: the Drive options are not offered. */
  configured: boolean
  settings: DriveSettings
  status: DriveStatus
  save: (options: { interactive: boolean; overwrite?: boolean }) => Promise<void>
  read: () => Promise<DriveRestore>
  /** After importing a Drive copy: this device has now seen that version. */
  markRestored: (remote: DriveRestore['remote']) => void
  setAutoSave: (enabled: boolean) => Promise<void>
}

export function useDriveSync(): DriveSync {
  const configured = Boolean(googleClientId())
  const [settings, setSettings] = useState(loadDriveSettings)
  const [status, setStatus] = useState<DriveStatus>({ kind: 'idle' })
  const latest = useRef(settings)
  const running = useRef(false)

  const update = useCallback((next: DriveSettings) => {
    latest.current = next
    saveDriveSettings(next)
    setSettings(next)
  }, [])

  const save = useCallback(async (options: { interactive: boolean; overwrite?: boolean }) => {
    if (running.current) return
    running.current = true
    setStatus({ kind: 'saving', progress: 0 })
    try {
      const next = await saveToDrive(latest.current, { ...options, onProgress: (progress) => setStatus({ kind: 'saving', progress }) })
      update(next)
      setStatus({ kind: 'saved', at: next.lastSavedAt! })
    } catch (error) {
      if (!(error instanceof SignInNeededError || error instanceof DriveConflictError)) console.error('No se pudo guardar en Google Drive:', error)
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No se pudo guardar en Google Drive.',
        reason: error instanceof SignInNeededError || error instanceof DriveAuthError ? 'sign-in'
          : error instanceof DriveConflictError ? 'conflict' : 'other'
      })
    } finally {
      running.current = false
    }
  }, [update])

  // Automatic save: watch what the backup contains and upload a while after it stops changing.
  useEffect(() => {
    if (!configured || !settings.autoSave) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const subscription = liveQuery(wardrobeState).subscribe({
      next: (state) => void fingerprintOf(state).then((fingerprint) => {
        if (stopped) return
        clearTimeout(timer)
        if (fingerprint === latest.current.savedFingerprint) return
        setStatus((current) => current.kind === 'saving' || current.kind === 'error' ? current : { kind: 'pending' })
        timer = setTimeout(() => void save({ interactive: false }), AUTO_SAVE_DELAY_MS)
      }),
      error: (error) => console.error('No se pueden vigilar los cambios para Google Drive:', error)
    })
    return () => {
      stopped = true
      clearTimeout(timer)
      subscription.unsubscribe()
    }
  }, [configured, settings.autoSave, save])

  const setAutoSave = useCallback(async (enabled: boolean) => {
    update({ ...latest.current, autoSave: enabled })
    // Turning it on is a click: sign in now and make the first copy, so later saves need no window.
    if (enabled) await save({ interactive: true })
    else setStatus({ kind: 'idle' })
  }, [save, update])

  const markRestored = useCallback((remote: DriveRestore['remote']) => {
    update({ ...latest.current, knownDriveVersion: remote.modifiedTime })
    setStatus({ kind: 'idle' })
  }, [update])

  return { configured, settings, status, save, read: readFromDrive, markRestored, setAutoSave }
}
