import { defineConfig } from 'vitest/config'

// Tests HTTP contre le build (.output/server/index.mjs) : lancer npm run build avant npm run test:http
export default defineConfig({
  test: {
    include: ['tests/http/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
