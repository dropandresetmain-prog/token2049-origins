import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Capsule console. Built to dist/console and served by the gateway at /console.
 * The production bundle must work under the gateway CSP: script-src 'self', no inline scripts.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/console/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../dist/console', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: { port: 5174, strictPort: true },
});
