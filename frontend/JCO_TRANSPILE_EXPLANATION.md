# Understanding the `jco transpile` Command

This document explains each part of the `jco transpile` command in the context of the WASM Component Model.

## Command Breakdown

```bash
jco transpile \
  --async-mode jspi \
  --no-nodejs-compat ../bg/bin/triangle.wasm -o ./examples/static \
  --async-exports 'run' \
  --async-imports 'wasi:webgpu/webgpu#[method]gpu.request-adapter' \
  --async-imports 'wasi:webgpu/webgpu#[method]gpu-adapter.request-device' \
  --async-imports 'wasi:webgpu/webgpu#[method]gpu-buffer.map-async' \
  --async-imports 'wasi:webgpu/webgpu#[method]gpu-device.pop-error-scope' \
  --async-imports 'wasi:webgpu/webgpu#[method]gpu-shader-module.get-compilation-info' \
  --async-wasi-imports \
  --async-wasi-exports \
  --map 'wasi:filesystem/*=https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/filesystem.js#*' \
  --map 'wasi:clocks/*=https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/clocks.js#*' \
  --map 'wasi:io/*=https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/io.js#*' \
  --map 'wasi:random/*=https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/random.js#*' \
  --map 'wasi:cli/*=https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/cli.js#*' \
  --map 'wasi:sockets/*=https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim/lib/browser/sockets.js#*' \
  --map 'wasi:io/poll=./gfx.js#poll' \
  --map 'wasi:webgpu/webgpu=./gfx.js' \
  --map 'wasi:surface/surface=./gfx.js' \
  --map 'wasi:graphics-context/graphics-context=./gfx.js' \
  --map 'wasi:frame-buffer/frame-buffer=./gfx.js'
```

## Line-by-Line Explanation

### `jco transpile`
- **Purpose**: The `jco` (JavaScript Component) tool from Bytecode Alliance transpiles WASM components into JavaScript/TypeScript bindings
- **Context**: Converts a WASM Component (which uses WIT interfaces) into JavaScript code that can run in browsers

### `--async-mode jspi`
- **Purpose**: Uses JavaScript Promise Integration (JSPI) for async operations
- **Context**: JSPI allows WASM to suspend and resume execution, enabling true async/await in WASM code
- **Why**: WebGPU operations are inherently async (request adapter, request device, etc.), so this mode is necessary

### `--no-nodejs-compat`
- **Purpose**: Disables Node.js compatibility shims
- **Context**: Since this is for browser use, we don't need Node.js-specific APIs
- **Why**: Reduces bundle size and avoids Node.js-specific code paths

### `../bg/bin/triangle.wasm -o ./examples/static`
- **Purpose**: Input WASM component and output directory
- **Context**: Takes the compiled WASM component and generates JavaScript bindings in the output directory
- **Output**: Creates `triangle.js` and potentially other files in `./examples/static`

### `--async-exports 'run'`
- **Purpose**: Marks the `run` export function as async
- **Context**: The WASM component exports a `run` function that needs to be async (likely because it uses async WebGPU APIs internally)
- **Why**: This tells jco to generate async JavaScript bindings for this export

### `--async-imports 'wasi:webgpu/webgpu#[method]gpu.request-adapter'` (and similar)
- **Purpose**: Marks specific imported functions as async
- **Context**: These are WASI WebGPU interface methods that return promises in the browser
- **Why**: `request-adapter`, `request-device`, `map-async`, etc. are all async operations in WebGPU
- **Component Model**: These use the WASI namespace (`wasi:`) and interface syntax (`#[method]`)

### `--async-wasi-imports`
- **Purpose**: Automatically marks all WASI imports as async
- **Context**: A convenience flag to avoid listing every WASI import individually
- **Why**: Most WASI operations are async in browser contexts

### `--async-wasi-exports`
- **Purpose**: Automatically marks all WASI exports as async
- **Context**: Similar convenience flag for exports
- **Why**: Ensures proper async handling for all WASI interface exports

### `--map 'wasi:filesystem/*=...'` (CDN mappings)
- **Purpose**: Maps WASI interface imports to browser-compatible implementations
- **Context**: WASI interfaces need JavaScript implementations for the browser
- **Why**: Uses `@bytecodealliance/preview2-shim` from CDN to provide WASI polyfills
- **Component Model**: These are interface imports that need runtime implementations

### `--map 'wasi:io/poll=./gfx.js#poll'`
- **Purpose**: Maps the WASI I/O polling interface to a local implementation
- **Context**: Uses a custom `poll` function from `gfx.js` instead of the default
- **Why**: Custom polling implementation needed for WebGPU event handling

### `--map 'wasi:webgpu/webgpu=./gfx.js'` (and similar)
- **Purpose**: Maps WASI WebGPU interfaces to local `gfx.js` implementations
- **Context**: `gfx.js` provides the actual WebGPU bindings that bridge WASI WebGPU interfaces to browser WebGPU APIs
- **Why**: These are custom implementations, not standard WASI, so they need local mappings
- **Component Model**: These interfaces are defined in the component's WIT, and `gfx.js` provides the runtime implementation

## Relationship to Rolldown-Vite

When using `rolldown-vite`, you need to configure `external` for these WASI interfaces because:

1. **They're runtime dependencies**: These interfaces are provided at runtime by `gfx.js` and the WASI shims, not bundled code
2. **Component Model imports**: The transpiled JavaScript will import these interfaces (e.g., `import 'wasi:webgpu/webgpu@0.0.1'`)
3. **External resolution**: Rolldown needs to know not to bundle these, but to resolve them externally

The `external` configuration in `rollupOptions` tells rolldown to:
- Not bundle these imports
- Expect them to be available at runtime
- Resolve them through the mappings provided by jco transpile

