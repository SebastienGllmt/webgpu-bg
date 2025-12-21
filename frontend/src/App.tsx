import { useState, useEffect } from 'react'
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
        <p>This example requires JavaScript Promise Integration (JSPI) support, which is available in:</p>
        <ul>
          <li>Chrome 126+ (or Chromium-based browsers)</li>
        </ul>
        <p>Please update your browser to the latest version, or <a href="https://caniuse.com/mdn-webassembly_jspi">use a browser that supports JSPI.</a></p>
      </div>
      <p><small>Your browser: {navigator.userAgent}</small></p>
    </div>
  )
}

const DEFAULT_SHADER = `
@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> @builtin(position) vec4<f32> {
    let x = f32(i32(in_vertex_index) - 1);
    let y = f32(i32(in_vertex_index & 1u) * 2 - 1);
    return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;

function App() {
  const [text] = useState(DEFAULT_SHADER)

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
        const wasmModule = await import('@wasm/triangle.js')
        
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

  // Show error if WebAssembly.Suspending is not supported
  if (!isWebAssemblySupported) {
    return <BrowserCompatibilityError />
  }

  // TODO: uncomment once we fix the loading detection (or decide it doesn't matter)
  // if (!wasmLoaded) {
  //   return <div>Loading WASM component...</div>
  // }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ flex: '0 0 auto' }}>
        <TerminalComponent />
      </div>
      <div style={{ flex: '1', minHeight: 0, position: 'relative' }}>
        <MonacoEditor
          language="wgsl"
          theme="vs-dark"
          value={text}
          height="100%"
        />
      </div>
    </div>
  )
}

export default App
