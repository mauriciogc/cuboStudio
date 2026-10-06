import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js por sí solo ronda los 600 kB minificado
    chunkSizeWarningLimit: 800,
  },
});
