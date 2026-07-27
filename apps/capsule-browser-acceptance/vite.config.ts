import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',
  },
  server: {
    host: '127.0.0.1',
    port: 4477,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4477,
    strictPort: true,
  },
});
