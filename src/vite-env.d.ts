/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** OAuth client ID (Google Cloud, «Web application») for the Drive backup; optional. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
}
