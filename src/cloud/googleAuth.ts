// Sign-in with Google for Drive, without loading any Google script into the app: a popup goes to Google's
// OAuth page (token flow for browser apps) and comes back to /oauth/google.html, which hands the token to this
// window. The token lives only in memory and expires after about an hour; nothing is stored.

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const CHANNEL = 'vesta-google-oauth'
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000

export interface GoogleToken {
  accessToken: string
  /** Epoch milliseconds, a minute early so a request does not start with a token about to expire. */
  expiresAt: number
}

let current: GoogleToken | undefined

export function googleClientId(): string | undefined {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || undefined
}

export function redirectUri(origin = window.location.origin): string {
  return `${origin}/oauth/google.html`
}

/** The token if there is a valid one; never opens a window (usable from automatic saves). */
export function currentToken(now = Date.now()): GoogleToken | undefined {
  return current && current.expiresAt > now ? current : undefined
}

export function signOut() {
  current = undefined
}

/** Parses the fragment Google appends to the return page; checks it answers our request. */
export function parseTokenFragment(fragment: string, expectedState: string, now = Date.now()): GoogleToken {
  const params = new URLSearchParams(fragment)
  if (params.get('state') !== expectedState) throw new Error('La respuesta de Google no corresponde a esta solicitud.')
  const error = params.get('error')
  if (error) {
    throw new Error(error === 'access_denied' ? 'Has cancelado el acceso a Google Drive.' : `Google ha rechazado el acceso (${error}).`)
  }
  const accessToken = params.get('access_token')
  const expiresIn = Number(params.get('expires_in'))
  if (!accessToken || !Number.isFinite(expiresIn)) throw new Error('Google no ha devuelto un acceso válido.')
  if (!(params.get('scope') ?? '').split(' ').includes(DRIVE_SCOPE)) {
    throw new Error('Para guardar la copia hay que permitir el acceso a la carpeta de VESTA en Drive.')
  }
  return { accessToken, expiresAt: now + Math.max(0, expiresIn - 60) * 1000 }
}

/**
 * The current token, or a new one through Google's sign-in window. Must be called from a click (or another
 * user action), or the browser blocks the window.
 */
export async function signIn(): Promise<GoogleToken> {
  const valid = currentToken()
  if (valid) return valid
  const clientId = googleClientId()
  if (!clientId) throw new Error('Google Drive no está configurado en esta instalación (falta VITE_GOOGLE_CLIENT_ID).')

  const state = crypto.randomUUID()
  const url = new URL(AUTH_URL)
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: DRIVE_SCOPE,
    state,
    include_granted_scopes: 'false',
    prompt: 'select_account'
  }).toString()
  const popup = window.open(url, 'vesta-google', 'popup,width=480,height=640')
  if (!popup) throw new Error('El navegador ha bloqueado la ventana de Google. Permite las ventanas emergentes para esta página.')

  const fragment = await new Promise<string>((resolve, reject) => {
    const channel = new BroadcastChannel(CHANNEL)
    const finish = () => {
      clearTimeout(timer)
      channel.close()
      window.removeEventListener('message', onWindowMessage)
    }
    const accept = (data: unknown) => {
      const message = data as { type?: string; fragment?: string } | null
      if (message?.type !== 'vesta-google-oauth' || typeof message.fragment !== 'string') return
      if (new URLSearchParams(message.fragment).get('state') !== state) return
      finish()
      resolve(message.fragment)
    }
    const onWindowMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin) accept(event.data)
    }
    channel.onmessage = (event) => accept(event.data)
    window.addEventListener('message', onWindowMessage)
    const timer = setTimeout(() => {
      finish()
      reject(new Error('No se ha completado el inicio de sesión con Google.'))
    }, SIGN_IN_TIMEOUT_MS)
  })
  current = parseTokenFragment(fragment, state)
  return current
}
