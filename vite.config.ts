import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import product from './product.config.json';

export default defineConfig({
  plugins: [
    react(),
    {
      // Produktnavnet indsættes fra product.config.json — aldrig hårdkodet i index.html.
      name: 'product-name',
      transformIndexHtml: (html) => html.replaceAll('%PRODUCT_NAME%', product.name),
    },
  ],
  // ffmpeg.wasm starter sin egen worker og må ikke forhåndspakkes af Vite.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
});
