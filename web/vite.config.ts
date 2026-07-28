/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('/node_modules/recharts/')) {
            return 'recharts'
          }

          if (id.includes('/node_modules/victory-vendor/')) {
            return 'charts-vendor'
          }

          if (id.includes('/node_modules/d3-')) {
            return 'd3'
          }

          if (id.includes('qrcode')) {
            return 'qr'
          }

          return undefined
        },
      },
    },
  },
  server: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:4310',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:4310',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react({
      babel: {
        plugins: ['react-dev-locator'],
      },
    }),
    tsconfigPaths(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
  },
})
