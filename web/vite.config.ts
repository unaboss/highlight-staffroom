import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Served by FastAPI at /fast-track (the earlier plain app is at /fast-track-classic).
export default defineConfig({
  base: '/fast-track/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5174, proxy: { '/api': 'http://localhost:8001', '/static': 'http://localhost:8001', '/lms': 'http://localhost:8001' } },
})
