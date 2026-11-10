import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Service worker only runs in a built/served app, never during `vite dev`
      // — devOptions stays off so local dev never serves stale cached files.
      devOptions: { enabled: false },
      manifest: {
        name: 'Lesson Teacher',
        short_name: 'Lesson Teacher',
        description: 'Book tutors, manage lessons, and track progress — parents, adult students, tutors, and schools.',
        theme_color: '#863bff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Runtime-cache API calls as a fallback-to-cache network-first
        // strategy, so the shell still loads (with stale data) offline or
        // on a flaky connection, without ever serving stale data when the
        // network is actually up.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'api-cache', networkTimeoutSeconds: 8, expiration: { maxEntries: 100, maxAgeSeconds: 86400 } },
          },
        ],
      },
    }),
  ],
})
