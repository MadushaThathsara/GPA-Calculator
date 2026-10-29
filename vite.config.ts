import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@/rules': resolve(__dirname, 'src/rules'),
      '@/engine': resolve(__dirname, 'src/engine'),
      '@/extract': resolve(__dirname, 'src/extract'),
      '@/store': resolve(__dirname, 'src/store'),
      '@/ui': resolve(__dirname, 'src/ui'),
    },
  },
  // Ensure pdfjs-dist worker URL is handled correctly
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  worker: {
    format: 'es',
  },
});
