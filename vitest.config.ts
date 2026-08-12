import { defineConfig } from 'vitest/config';

/**
 * Vlastní konfigurace pro testy. Bez ní by si Vitest vzal `root: 'web'`
 * z vite.config.ts a v adresáři webu by žádné testy nenašel.
 */
export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
  },
});
