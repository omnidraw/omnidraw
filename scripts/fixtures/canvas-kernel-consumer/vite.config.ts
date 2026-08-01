import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  build: {
    sourcemap: true,
    target: 'es2022',
  },
  plugins: [solid()],
})
