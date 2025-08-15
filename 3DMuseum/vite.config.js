import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({
  sourceMap: false,
  optimize: true,
  optimizeDeps: true,
  build: {
    sourcemap: false,
    minify: 'esbuild',
    terserOptions:{
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
      cacheDir: 'node_modules/.cache/vite',
    }
  },
  minify: 'esbuild',
  cacheDir: 'node_modules/.vite',
  cache: true,
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  plugins: [
    tailwindcss(),
    
  ],
})