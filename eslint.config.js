import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Determinismus je tvrdý požadavek projektu, ne konvence.
 * Stav světa musí být čistou funkcí (worldSeed, tickIndex) — jinak
 * se rozejde checkpoint ze serveru s tím, co si dopočítá klient.
 */
const NON_DETERMINISTIC = {
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message: 'Použij Rng z engine/rng.ts — Math.random rozbije determinismus.',
    },
    {
      object: 'Date',
      property: 'now',
      message: 'Engine nesmí číst hodiny. Čas do enginu vstupuje jen jako world.tick.',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date']",
      message: 'Engine nesmí číst hodiny. Čas do enginu vstupuje jen jako world.tick.',
    },
  ],
};

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/', 'data/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['engine/**/*.ts'],
    rules: NON_DETERMINISTIC,
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
