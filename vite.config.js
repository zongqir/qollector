import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'startup-logger',
      configureServer(server) {
        server.httpServer?.once('listening', () => {
          console.log('\n[Vite] Server ready at', new Date().toISOString());
        });
      },
    },
  ],
  resolve: {
    alias: {
      'react': 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
      'react-dom/test-utils': 'preact/test-utils',
    },
  },
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
      'preact/compat',
      'preact/jsx-runtime',
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
