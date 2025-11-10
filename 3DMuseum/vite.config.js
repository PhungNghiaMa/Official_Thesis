import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import viteCompression from 'vite-plugin-compression'


export default defineConfig({
  cacheDir: 'node_modules/.vite',   // correct place for cache dir

  resolve: {
    alias: {
      '@': '/src',
    },
  },

  plugins: [
    tailwindcss(),
    viteCompression({
      algorithm: 'brotliCompress',
      threshold: 10
    }),
  ],

  build: {
    sourcemap: false,
    minify: 'esbuild', // fast & good enough
    // If you really want Terser for advanced compression, set minify: 'terser'
    // and move terserOptions here.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          'three-post': [
            'three/examples/jsm/postprocessing/EffectComposer.js',
            'three/examples/jsm/postprocessing/RenderPass.js',
            'three/examples/jsm/postprocessing/OutlinePass.js'
          ]
        }
      }
    }
  },

  optimizeDeps: {
    include: [
      'three',
    ],
  }
})

