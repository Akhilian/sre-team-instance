import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Alias Nuxt ~~ (racine) : les utilitaires de app/ qui importent du code de shared/ (pas seulement des
  // types) passent par lui, un import relatif vers shared/ cassant le build SSR de Nuxt
  resolve: {
    alias: { '~~': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // tests/http/ : contre le build, via npm run test:http (vitest.http.config.ts)
    exclude: ['node_modules/**', '.output/**', '.nuxt/**', 'tests/http/**'],
  },
})
