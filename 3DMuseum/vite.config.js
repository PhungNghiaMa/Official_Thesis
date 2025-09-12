import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  cacheDir: 'node_modules/.vite',   // correct place for cache dir

  resolve: {
    alias: {
      '@': '/src',
    },
  },

  plugins: [
    tailwindcss(),
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
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/renderers/CSS3DRenderer.js',
      'three/examples/jsm/postprocessing/EffectComposer.js',
      'three/examples/jsm/postprocessing/RenderPass.js',
      'three/examples/jsm/postprocessing/OutlinePass.js',
      '@recast-navigation/three'
    ],
    exclude: [
      'recast-navigation'
    ]
  }
})

