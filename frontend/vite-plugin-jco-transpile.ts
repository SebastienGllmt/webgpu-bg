import type { Plugin } from 'vite'
import { execSync } from 'child_process'
import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { join } from 'path'

/**
 * Vite plugin to automatically run jco transpile before dev/build
 * 
 * This transpiles the WASM component into JavaScript bindings that can be used
 * in the browser, mapping WASI interfaces to browser-compatible implementations.
 */
export function jcoTranspilePlugin(): Plugin {
  let hasRun = false

  return {
    name: 'jco-transpile',
    enforce: 'pre',
    
    buildStart() {
      // Only run once per build session
      if (hasRun) return
      hasRun = true

      const wasmPath = join(process.cwd(), '../bg/bin/triangle.wasm')
      const outputDir = join(process.cwd(), 'src/wasm/generated')
      const gfxSource = join(process.cwd(), 'src/lib/gfx.js')
      const gfxDest = join(outputDir, 'gfx.js')

      // Check if WASM file exists
      if (!existsSync(wasmPath)) {
        console.warn(`[jco-transpile] WASM file not found: ${wasmPath}`)
        return
      }

      // Create output directory if it doesn't exist
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true })
      }

      // Check if jco is available
      try {
        execSync('jco --version', { stdio: 'ignore' })
      } catch {
        throw new Error('jco is not installed or not in PATH. Install it with: npm install -g @bytecodealliance/jco')
      }

      console.log('[jco-transpile] Transpiling WASM component...')

      try {
        // Run jco transpile command
        const command = [
          'jco transpile',
          '--async-mode jspi',
          '--no-nodejs-compat',
          wasmPath,
          '-o', outputDir,
          '--async-exports', 'run',
          '--async-imports', 'wasi:webgpu/webgpu#[method]gpu.request-adapter',
          '--async-imports', 'wasi:webgpu/webgpu#[method]gpu-adapter.request-device',
          '--async-imports', 'wasi:webgpu/webgpu#[method]gpu-buffer.map-async',
          '--async-imports', 'wasi:webgpu/webgpu#[method]gpu-device.pop-error-scope',
          '--async-imports', 'wasi:webgpu/webgpu#[method]gpu-shader-module.get-compilation-info',
          '--async-wasi-imports',
          '--async-wasi-exports',
          '--map', 'wasi:filesystem/*=https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/filesystem.js#*',
          '--map', 'wasi:clocks/*=https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/clocks.js#*',
          '--map', 'wasi:io/*=https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/io.js#*',
          '--map', 'wasi:random/*=https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/random.js#*',
          '--map', 'wasi:cli/*=https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/cli.js#*',
          '--map', 'wasi:sockets/*=https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/sockets.js#*',
          '--map', 'wasi:io/poll=./gfx.js#poll',
          '--map', 'wasi:webgpu/webgpu=./gfx.js',
          '--map', 'wasi:surface/surface=./gfx.js',
          '--map', 'wasi:graphics-context/graphics-context=./gfx.js',
          '--map', 'wasi:frame-buffer/frame-buffer=./gfx.js',
        ].join(' ')

        execSync(command, {
          cwd: process.cwd(),
          stdio: 'inherit',
        })

        // Copy gfx.js to output directory (jco expects it relative to output)
        if (existsSync(gfxSource)) {
          copyFileSync(gfxSource, gfxDest)
          console.log('[jco-transpile] Copied gfx.js to output directory')
        } else {
          console.warn(`[jco-transpile] gfx.js not found at ${gfxSource}`)
        }

        console.log('[jco-transpile] Transpilation complete!')
      } catch (error) {
        console.error('[jco-transpile] Transpilation failed:', error)
        throw error
      }
    },
  }
}

