import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';

// The bundle report is opt-in: `ANALYZE=1 npm run build` writes dist/stats.html.
// It never opens a browser, so it is safe in CI and in headless shells.
const analyzeBundle = process.env.ANALYZE === '1';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    ...(analyzeBundle
      ? [
          visualizer({
            open: false,
            gzipSize: true,
            brotliSize: true,
            filename: 'dist/stats.html'
          })
        ]
      : [])
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Polyfill Node.js modules for browser
      "node:module": "module",
      "node:fs": "fs",
      "node:path": "path",
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis'
      }
    }
  },
  server: {
    // The dev server listens on localhost only. To reach it from another
    // machine or from a container, opt in explicitly: `npm run dev -- --host`.
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups'
    }
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          // ReactFlow
          if (id.includes('node_modules/reactflow')) {
            return 'reactflow';
          }

          // PDF.js
          if (id.includes('pdfjs-dist')) {
            return 'pdfjs';
          }

          // Monaco Editor
          if (id.includes('@monaco-editor/react') || id.includes('monaco-editor')) {
            return 'monaco';
          }

          // Charts
          if (id.includes('node_modules/recharts')) {
            return 'charts';
          }

          // Animation library - used throughout but can be chunked
          if (id.includes('node_modules/framer-motion')) {
            return 'motion';
          }

          // Markdown rendering
          if (id.includes('react-markdown') || id.includes('remark-gfm')) {
            return 'markdown';
          }

          // Syntax highlighting (heavy)
          if (id.includes('react-syntax-highlighter')) {
            return 'syntax-highlighter';
          }

          // YouTube transcript
          if (id.includes('youtube-transcript')) {
            return 'youtube';
          }

          return undefined;
        }
      }
    },
    // Lower threshold to catch bundle bloat early
    chunkSizeWarningLimit: 1000,
    // Source maps are disabled for smaller production builds
    sourcemap: false,
  }
});
