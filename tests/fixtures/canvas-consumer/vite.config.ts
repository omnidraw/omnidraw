import { defineConfig } from 'vite'
import solid from '@solidjs/vite-plugin'

export default defineConfig({
  build: {
    sourcemap: true,
    target: 'es2022',
  },
  plugins: [solid({ solid: { moduleName: '@solidjs/web' } })],
})
