import { useState, useEffect } from 'react'
import './App.css'
import TerminalComponent from './useTerminal.js'


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

function App() {
  const [wasmLoaded, setWasmLoaded] = useState(false)

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
        const wasiCliRun = wasmModule.run
        
        // The run function is async (marked with --async-exports 'run')
        await wasiCliRun.run()
        console.log('WASM component loaded and running!')
        setWasmLoaded(true)
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
    <>
      <TerminalComponent />
    </>
  )
}

export default App
