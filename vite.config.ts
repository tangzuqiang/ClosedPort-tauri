import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  clearScreen: false,
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: { input: { main: resolve(__dirname, 'src/renderer/index.html'), floating: resolve(__dirname, 'src/renderer/floating.html') } }
  },
  server: { port: 5173, strictPort: true }
});
