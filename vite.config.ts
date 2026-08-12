import { defineConfig } from 'vite';

/**
 * Web žije ve `web/`, ale statická data bere přímo z kořenového `data/`,
 * které plní sim-runner a commituje GitHub Action. Vite je servíruje
 * v dev režimu i kopíruje do buildu, takže není potřeba žádný krok navíc.
 *
 * `base` odpovídá cestě na GitHub Pages; všechny fetche v kódu jsou relativní,
 * takže fungují jak na Pages, tak na localhostu.
 */
export default defineConfig({
  root: 'web',
  publicDir: '../data',
  base: '/virtual-civilization/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
