# Idiomatic WASM Component Import in Vite

## Previous Approach (Not Idiomatic)

Previously, you were dynamically creating script tags in HTML:

```javascript
let script = document.createElement("script");
script.type = "module";
script.textContent = `
    import { "wasi:cli/run@0.2.0" as wasiCliRun } from './static/triangle.js';
    wasiCliRun.run();
`;
document.body.appendChild(script);
```

**Issues with this approach:**
- ❌ Bypasses Vite's module system
- ❌ No TypeScript type checking
- ❌ No Hot Module Replacement (HMR)
- ❌ Harder to debug and maintain
- ❌ Doesn't leverage Vite's optimizations
- ❌ Runtime string evaluation (less safe)

## Current Approach (Idiomatic Vite)

Now, we import directly in TypeScript/React:

```typescript
import { run as wasiCliRun } from '@wasm/triangle.js'

useEffect(() => {
  const initWasm = async () => {
    try {
      await wasiCliRun.run()
      setWasmLoaded(true)
    } catch (error) {
      console.error('Failed to run WASM component:', error)
    }
  }
  initWasm()
}, [])
```

**Benefits:**
- ✅ Uses Vite's module resolution
- ✅ Full TypeScript support with type checking
- ✅ Hot Module Replacement works
- ✅ Better debugging (source maps, stack traces)
- ✅ Leverages Vite's optimizations
- ✅ Compile-time safety
- ✅ Works seamlessly with React lifecycle

## Configuration

### 1. Vite Config (`vite.config.ts`)

```typescript
resolve: {
  alias: {
    '@wasm': path.resolve(__dirname, 'examples/static'),
  },
},
optimizeDeps: {
  // Exclude WASI interfaces from pre-bundling
  exclude: [
    'wasi:webgpu/webgpu@0.0.1',
    // ... other WASI interfaces
  ],
},
build: {
  rollupOptions: {
    external: [
      // Mark WASI interfaces as external
      'wasi:webgpu/webgpu@0.0.1',
      // ... other WASI interfaces
    ],
  },
}
```

### 2. TypeScript Config (`tsconfig.app.json`)

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@wasm/*": ["examples/static/*"]
    }
  }
}
```

## How It Works

1. **Import Resolution**: Vite resolves `@wasm/triangle.js` to `examples/static/triangle.js`
2. **Type Checking**: TypeScript uses the generated `.d.ts` files for type checking
3. **Dev Mode**: Vite serves the files directly, WASI imports are resolved at runtime
4. **Build Mode**: Rolldown marks WASI interfaces as external, leaving them for runtime resolution

## Usage Example

```typescript
import { run as wasiCliRun } from '@wasm/triangle.js'

function MyComponent() {
  useEffect(() => {
    // Run WASM component when component mounts
    wasiCliRun.run().catch(console.error)
  }, [])
  
  return <div>WASM component running...</div>
}
```

## Key Differences

| Aspect | Old Approach | New Approach |
|--------|-------------|--------------|
| **Module System** | Dynamic script injection | ES modules |
| **Type Safety** | None | Full TypeScript support |
| **HMR** | No | Yes |
| **Debugging** | Difficult | Easy (source maps) |
| **Build Integration** | Separate | Integrated |
| **React Integration** | Manual | Native (useEffect) |

## Migration Notes

- The `run` export from `triangle.js` is an object with a `run()` method
- The `run()` method is async (marked with `--async-exports 'run'`)
- WASI interfaces are resolved at runtime through the mappings configured in `jco transpile`
- The `external` config ensures these interfaces aren't bundled but remain as runtime imports

