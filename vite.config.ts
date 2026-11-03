import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Tauri expects a fixed dev port; failing loudly beats silently picking another
// one (the webview would then load a blank page).
const DEV_PORT = 5183

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: DEV_PORT,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // Windows ships a modern WebView2; no need to downlevel for legacy engines.
    target: 'chrome110',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
