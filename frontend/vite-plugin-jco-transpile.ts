import type { Plugin } from 'vite'
import { execSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Vite plugin to automatically run jco transpile before dev/build
 * 
 * This transpiles the WASM component into JavaScript bindings that can be used
 * in the browser, mapping WASI interfaces to browser-compatible implementations.
 */
export function jcoTranspilePlugin(): Plugin {
  let hasRun = false
  const outputDir = join(process.cwd(), 'src/wasm/generated')
  const generatedFile = join(outputDir, 'plugin-bg.js')

  // Function to run transpilation
  const runTranspile = () => {
    // Only run once per build session
    if (hasRun) return
    hasRun = true

    const wasmPath = join(process.cwd(), '../bg/plugin-base/bin/plugin-bg.wasm')
    const gfxSource = join(process.cwd(), 'src/lib/gfx.js')

    // Check if WASM file exists
    if (!existsSync(wasmPath)) {
      console.warn(`[jco-transpile] WASM file not found: ${wasmPath}`)
      return
    }

    // Create output directory if it doesn't exist
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }
    
    // Create a placeholder file if the generated file doesn't exist yet
    // This prevents Vite from failing during static analysis
    if (!existsSync(generatedFile)) {
      writeFileSync(generatedFile, '// Placeholder file - will be replaced by jco transpile\n// This file is generated automatically\n', 'utf-8')
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
        // Map to source gfx.js using relative path from generated directory
        // From src/wasm/generated/ to src/lib/ requires going up two levels
        '--map', 'wasi:io/poll=../../lib/gfx.js#poll',
        '--map', 'wasi:webgpu/webgpu=../../lib/gfx.js',
        '--map', 'wasi:surface/surface=../../lib/gfx-surface-wrapper.js',
        '--map', 'wasi:graphics-context/graphics-context=../../lib/gfx.js',
        '--map', 'wasi:frame-buffer/frame-buffer=../../lib/gfx.js',
        '--map', 'wasi:clocks/monotonic-clock=../../lib/clock.js#monotonicClock',
      ].join(' ')

      // Verify gfx.js exists before transpiling
      if (!existsSync(gfxSource)) {
        throw new Error(`gfx.js not found at ${gfxSource}. Make sure src/lib/gfx.js exists.`)
      }

      execSync(command, {
        cwd: process.cwd(),
        stdio: 'inherit',
      })

      console.log('[jco-transpile] Transpilation complete!')
    } catch (error) {
      console.error('[jco-transpile] Transpilation failed:', error)
      throw error
    }
  }

  return {
    name: 'jco-transpile',
    enforce: 'pre',
    
    // Run transpilation early, before Vite tries to resolve imports
    configResolved() {
      // Create output directory and placeholder file early to prevent Vite errors
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true })
      }
      if (!existsSync(generatedFile)) {
        writeFileSync(generatedFile, '// Placeholder file - will be replaced by jco transpile\n// This file is generated automatically\n', 'utf-8')
      }
      // Now run the actual transpilation
      runTranspile()
    },
    
    // Handle resolution of @wasm imports
    resolveId(id) {
      // Intercept @wasm/plugin-bg.js imports
      if (id === '@wasm/plugin-bg.js' || id.startsWith('@wasm/')) {
        // Ensure transpilation has run
        if (!hasRun) {
          runTranspile()
        }
        // Return the resolved path
        // The file should exist now since runTranspile() was called
        const fileName = id.replace('@wasm/', '')
        const resolvedPath = join(outputDir, fileName)
        
        // Double-check file exists, if not, try transpiling again
        if (!existsSync(resolvedPath)) {
          console.warn(`[jco-transpile] Generated file not found: ${resolvedPath}, attempting to regenerate...`)
          runTranspile()
        }
        
        return resolvedPath
      }
      return null
    },
    
    // Handle loading of generated files
    load(id) {
      // If this is one of our generated files and it doesn't exist, ensure it's generated
      if (id.startsWith(outputDir)) {
        if (!existsSync(id)) {
          console.warn(`[jco-transpile] File not found during load: ${id}, attempting to generate...`)
          if (!hasRun) {
            runTranspile()
          }
        }
      }
      return null // Let Vite handle the actual file loading
    },
    
    buildStart() {
      // Transpilation is handled in configResolved and resolveId hooks
      // This hook is kept for backwards compatibility
      if (!hasRun) {
        runTranspile()
      }
    },
  }
}

