import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // Optimize dev server startup
    warmup: {
      clientFiles: ['./src/main.jsx', './src/App.jsx'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  // Optimize dependency pre-bundling
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-i18next',
      'i18next',
      'zustand',
      'lucide-react',
      '@tauri-apps/api',
      'react-virtuoso',
    ],
    exclude: [
      'highlight.js',
      'pdfjs-dist',
      'react-file-icon',
    ],
  },
  build: {
    target: 'esnext',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        preview: resolve(__dirname, 'public/preview.html'),
        quickInput: resolve(__dirname, 'quick-input.html'),
        widget: resolve(__dirname, 'widget.html'),
      },
    },
  },
});
