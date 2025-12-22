import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { jcoTranspilePlugin } from './vite-plugin-jco-transpile'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    jcoTranspilePlugin(),
  ],
  resolve: {
    dedupe: ['vscode'],
    alias: {
      // Alias for cleaner imports of the transpiled WASM component
      '@wasm': path.resolve(__dirname, 'src/wasm/generated'),
    },
  },
  optimizeDeps: {
    include: [
      '@codingame/monaco-vscode-standalone-languages',
      '@codingame/monaco-vscode-standalone-css-language-features',
      '@codingame/monaco-vscode-standalone-html-language-features',
      '@codingame/monaco-vscode-standalone-json-language-features',
      '@codingame/monaco-vscode-standalone-typescript-language-features',
      '@testing-library/react',
      'vscode/localExtensionHost',
      'vscode-jsonrpc',
      'vscode-languageclient',
      'vscode-languageserver',
      'vscode-languageserver/browser.js',
      'vscode-languageserver-protocol',
      'vscode-oniguruma',
      'vscode-textmate'
    ],
    // Exclude WASI interfaces from pre-bundling - they're resolved at runtime
    exclude: [
      'wasi:webgpu/webgpu@0.0.1',
      'wasi:surface/surface@0.0.1',
      'wasi:graphics-context/graphics-context@0.0.1',
      'wasi:frame-buffer/frame-buffer@0.0.1',
    ],
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      // Mark WASI interfaces as external - these are provided at runtime
      // by gfx.js and the WASI shims, not bundled code
      external: [
        'wasi:webgpu/webgpu@0.0.1',
        'wasi:surface/surface@0.0.1',
        'wasi:graphics-context/graphics-context@0.0.1',
        'wasi:frame-buffer/frame-buffer@0.0.1',
        // Also mark the CDN-provided WASI shims as external
        /^https:\/\/cdn\.jsdelivr\.net\/npm\/@bytecodealliance\/preview2-shim/,
      ],
    },
  },
})
