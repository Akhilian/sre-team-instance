import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // tests/http/ : contre le build, via npm run test:http (vitest.http.config.ts)
    exclude: ['node_modules/**', '.output/**', '.nuxt/**', 'tests/http/**'],
  },
})
