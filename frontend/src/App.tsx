import { useState, useEffect, useRef } from 'react'
import './App.css'
import TerminalComponent from './useTerminal.js'
import MonacoEditor from './components/MonacoEditor'


function BrowserCompatibilityError() {
  return (
    <div style={{
      padding: '20px',
      fontFamily: 'sans-serif',
      color: '#000',
      background: '#fee',
      border: '2px solid #f00',
      margin: '20px',
    }}>
      <h2>Browser Compatibility Error</h2>
      <p><strong>WebAssembly.Suspending is not supported in your browser.</strong></p>
      <div style={{ textAlign: 'left' }}>
        <p>This project requires JavaScript Promise Integration (JSPI) support, which is available in:</p>
        <ul>
          <li>Chrome 126+ (or Chromium-based browsers)</li>
        </ul>
        <p>Please update your browser to the latest version, or <a href="https://caniuse.com/mdn-webassembly_jspi">use a browser that supports JSPI.</a></p>
      </div>
      <p><small>Your browser: {navigator.userAgent}</small></p>
    </div>
  )
}

const DEFAULT_SHADER = `@fragment
fn fragmentMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    return vec4f(pos.xy / inputs.size.xy, 0.5, 1);
}
`;

function App() {
  const [text, setText] = useState(DEFAULT_SHADER)
  const wasmModuleRef = useRef<{ run: (shader: string) => Promise<void> } | null>(null)

  // Check for WebAssembly.Suspending support
  const isWebAssemblySupported = typeof WebAssembly !== 'undefined' && 
    'Suspending' in WebAssembly && typeof (WebAssembly as { Suspending?: unknown }).Suspending !== 'undefined'
 
  useEffect(() => {
    // Only load WASM if browser supports it
    if (!isWebAssemblySupported) {
      return
    }

    // Dynamically import and run the WASM component when the component mounts
    // This prevents the module from executing in unsupported browsers
    const initWasm = async () => {
      try {
        // Dynamic import only happens after browser support is verified
        const wasmModule = await import('@wasm/plugin-bg.js')
        
        // Store the module in a ref so we can use it later
        wasmModuleRef.current = wasmModule
        
        // The run function is async (marked with --async-exports 'run')
        // Pass a string argument to the run function
        await wasmModule.run(DEFAULT_SHADER)
        console.log('WASM component loaded and running!')
      } catch (error) {
        console.error('Failed to run WASM component:', error)
      }
    }

    initWasm()
  }, [isWebAssemblySupported])

  // Run WASM whenever text changes, but only after wasmModule is loaded
  useEffect(() => {
    if (wasmModuleRef.current) {
      wasmModuleRef.current.run(text).catch((error) => {
        console.error('Failed to run WASM with updated shader:', error)
      })
    }
  }, [text])

  // Show error if WebAssembly.Suspending is not supported
  if (!isWebAssemblySupported) {
    return <BrowserCompatibilityError />
  }

  // TODO: uncomment once we fix the loading detection (or decide it doesn't matter)
  // if (!wasmLoaded) {
  //   return <div>Loading WASM component...</div>
  // }
  return (
    <div style={{ 
      padding: '24px', 
      boxSizing: 'border-box', 
      height: '100vh',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'stretch'
    }}>
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%',
        width: '100%',
        maxWidth: 'none'
      }}>
        <div style={{ flex: '0 0 auto', width: '100%', display: 'flex', justifyContent: 'center' }}>
          <TerminalComponent />
        </div>
        <div style={{ flex: '1', minHeight: 0, position: 'relative', width: '100%', opacity: 0.8 }}>
          <MonacoEditor
            value={text}
            onCodeChange={setText}
          />
        </div>
      </div>
    </div>
  )
}

export default App
