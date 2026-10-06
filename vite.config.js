import { defineConfig } from 'vite';

export default defineConfig({
  // Publicado en GitHub Pages: https://mauriciogc.github.io/cuboStudio/
  base: '/cuboStudio/',
  build: {
    // three.js por sí solo ronda los 600 kB minificado
    chunkSizeWarningLimit: 800,
  },
});
