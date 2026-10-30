import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['wardrobe-icon.svg'],
      manifest: {
        name: 'VESTA — Armario virtual',
        short_name: 'VESTA',
        description: 'Tu armario virtual, guardado en tu dispositivo.',
        theme_color: '#F5F5EF',
        background_color: '#F5F5EF',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/wardrobe-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          }
        ],
        lang: 'es'
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,png,woff2}'],
        navigateFallback: 'index.html',
        // The Google sign-in return page must load itself, never the app shell.
        navigateFallbackDenylist: [/^\/oauth\//],
        runtimeCaching: [
          {
            urlPattern: /\.(?:wasm|mjs)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vesta-inference-runtime',
              expiration: {
                maxEntries: 3,
                maxAgeSeconds: 60 * 60 * 24 * 365
              }
            }
          }
        ]
      }
    })
  ]
})
