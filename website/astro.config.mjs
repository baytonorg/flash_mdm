import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Keep Astro 5's HTML whitespace behaviour while moving to Astro 7.
  compressHTML: true,
  vite: {
    plugins: [tailwindcss()],
  },
  output: 'static',
  image: {
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
  build: {
    assets: '_assets',
  },
});
