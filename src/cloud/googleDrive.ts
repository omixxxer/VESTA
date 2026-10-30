import { signOut, type GoogleToken } from './googleAuth'

// The wardrobe backup (the same ZIP as «Exportar copia») kept as one file in the app's hidden Drive folder
// (appDataFolder): only VESTA can see it, and the user's other Drive files are out of its reach. Drive keeps
// previous versions of the file for a while, so a bad save can be undone from there.

export const DRIVE_FILE_NAME = 'vesta-armario.zip'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
/** Upload in parts, so a large wardrobe never goes in one request; Drive needs multiples of 256 KB. */
const CHUNK_BYTES = 8 * 1024 * 1024

export interface DriveBackupInfo {
  id: string
  modifiedTime: string
  size: number
}

/** The token was rejected (expired or revoked): the user has to sign in again. */
export class DriveAuthError extends Error {
  constructor() {
    super('La sesión de Google ha caducado. Vuelve a conectar con Google Drive.')
  }
}

async function call(token: GoogleToken, url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token.accessToken}` } })
  } catch {
    throw new Error('No se pudo conectar con Google Drive. Comprueba la conexión.')
  }
  if (response.status === 401) {
    signOut()
    throw new DriveAuthError()
  }
  // 308 is how a resumable upload says «received, send the next part».
  if (!response.ok && response.status !== 308) {
    const detail = await response.json().then((body: { error?: { message?: string } }) => body.error?.message).catch(() => undefined)
    throw new Error(response.status === 403 && detail?.includes('storage')
      ? 'No queda espacio en tu Google Drive.'
      : `Google Drive ha respondido con un error (${response.status}${detail ? `: ${detail}` : ''}).`)
  }
  return response
}

export async function findDriveBackup(token: GoogleToken): Promise<DriveBackupInfo | undefined> {
  const query = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${DRIVE_FILE_NAME}' and trashed = false`,
    fields: 'files(id,modifiedTime,size)',
    orderBy: 'modifiedTime desc',
    pageSize: '1'
  })
  const { files } = await (await call(token, `${API}/files?${query}`)).json() as { files: Array<{ id: string; modifiedTime: string; size?: string }> }
  const [file] = files
  return file && { id: file.id, modifiedTime: file.modifiedTime, size: Number(file.size ?? 0) }
}

/** Creates the backup file or replaces its content; reports progress from 0 to 1. */
export async function uploadDriveBackup(
  token: GoogleToken,
  archive: Blob,
  existingId?: string,
  onProgress?: (fraction: number) => void
): Promise<DriveBackupInfo> {
  const session = await call(token, existingId
    ? `${UPLOAD_API}/files/${existingId}?uploadType=resumable&fields=id,modifiedTime,size`
    : `${UPLOAD_API}/files?uploadType=resumable&fields=id,modifiedTime,size`, {
    method: existingId ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/zip',
      'X-Upload-Content-Length': String(archive.size)
    },
    body: JSON.stringify(existingId ? {} : { name: DRIVE_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/zip' })
  })
  const location = session.headers.get('Location')
  if (!location) throw new Error('Google Drive no ha aceptado la subida.')

  let start = 0
  // A part that does not get through is sent again, a few times at most.
  for (let attempts = Math.ceil(archive.size / CHUNK_BYTES) + 5; attempts > 0; attempts -= 1) {
    const end = Math.min(start + CHUNK_BYTES, archive.size)
    const response = await call(token, location, {
      method: 'PUT',
      headers: { 'Content-Range': archive.size ? `bytes ${start}-${end - 1}/${archive.size}` : 'bytes */0' },
      body: archive.slice(start, end)
    })
    if (response.status !== 308) {
      onProgress?.(1)
      const file = await response.json() as { id: string; modifiedTime: string; size?: string }
      return { id: file.id, modifiedTime: file.modifiedTime, size: Number(file.size ?? archive.size) }
    }
    // Drive says how much it has («bytes=0-8388607»); without that header it has nothing yet.
    const received = /bytes=0-(\d+)/.exec(response.headers.get('Range') ?? '')
    start = received ? Number(received[1]) + 1 : 0
    onProgress?.(start / archive.size)
  }
  throw new Error('La subida a Google Drive no se ha completado. Inténtalo de nuevo.')
}

export async function downloadDriveBackup(token: GoogleToken, id: string): Promise<Blob> {
  return (await call(token, `${API}/files/${id}?alt=media`)).blob()
}
