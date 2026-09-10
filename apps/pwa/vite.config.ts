import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root,
  base: '/app/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Escarlet CMS',
        short_name: 'Escarlet CMS',
        description: 'Crea, revisa y publica contenido desde Escarlet.',
        theme_color: '#101516',
        background_color: '#101516',
        display: 'standalone',
        start_url: '/app/',
        scope: '/app/',
        icons: [
          { src: '/app/icon.png?v=2', sizes: '512x512', type: 'image/png', purpose: 'any' }
        ]
      },
      workbox: {
        navigateFallback: '/app/index.html',
        runtimeCaching: [{
          urlPattern: /\/api\//,
          handler: 'NetworkOnly',
          method: 'GET'
        }]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3040', '/media': 'http://localhost:3040' }
  },
  build: { outDir: 'dist', emptyOutDir: true }
})
