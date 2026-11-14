import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The dev server proxies /api to the local mission-computer API (src/server).
const API_PORT = Number(process.env.GG_PORT ?? 4317)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.GG_WEB_PORT ?? 5317),
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false } },
  },
  build: { outDir: process.env.GG_OUT_DIR ?? 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
})
