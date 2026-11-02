import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // three.js is the bulk of the bundle; one ~170 kB gzipped chunk is expected
    chunkSizeWarningLimit: 900,
  },
});
