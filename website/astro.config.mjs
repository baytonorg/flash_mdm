import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
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
