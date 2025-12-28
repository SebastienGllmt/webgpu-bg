import { useState, useEffect, useRef } from 'react'
import './App.css'
import MonacoEditor from './components/MonacoEditor'
import defaultShader from './assets/star.wgsl?raw';

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

function App() {
  const [text, setText] = useState(defaultShader)
  const [opacity, setOpacity] = useState(0.8)
  const wasmModuleRef = useRef<typeof import('@wasm/plugin-bg.js') | null>(null)

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
        
        if (wasmModuleRef.current != null) return;
        // Store the module in a ref so we can use it later
        wasmModuleRef.current = wasmModule
        
        // TODO: not great we're queueing this before `run` is called
        //       ideally, this is passed through the wasi-cli environment
        wasmModuleRef.current.queueShader(defaultShader);
        wasmModule.run.run(); // note: this will never terminate
      } catch (error) {
        console.error('Failed to run WASM component:', error)
      }
    }

    initWasm()
  }, [isWebAssemblySupported])

  // Run WASM whenever text changes, but only after wasmModule is loaded
  useEffect(() => {
    if (wasmModuleRef.current) {
      try {
        wasmModuleRef.current.queueShader(text);
      } catch(error) {
        console.error('Failed to run WASM with updated shader:', error)
      }
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
        <div style={{ 
          display: 'flex', 
          width: '100%', 
          height: '4px'
        }}>
          <div style={{ 
            width: '50%', 
            backgroundColor: 'red',
            height: '100%'
          }}></div>
          <div style={{ 
            width: '50%', 
            backgroundColor: 'green',
            height: '100%'
          }}></div>
        </div>
        <div style={{ flex: '0 0 auto', width: '100%', display: 'flex', justifyContent: 'center' }}>
          {/* <TerminalComponent /> */}
        </div>
        <div style={{ 
          flex: '0 0 auto', 
          padding: '12px 16px', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '12px',
          backgroundColor: '#f5f5f5',
          borderBottom: '1px solid #ddd',
          width: 'fit-content',
          opacity: 0.8,
          boxSizing: 'border-box'
        }}>
          <label htmlFor="opacity-slider" style={{ fontSize: '14px', fontWeight: '500', color: '#333', whiteSpace: 'nowrap' }}>Opacity:</label>
          <input
            id="opacity-slider"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))}
            style={{ 
              flex: '1', 
              maxWidth: '300px',
              height: '8px',
              cursor: 'pointer',
              minWidth: '100px',
              WebkitAppearance: 'none',
              appearance: 'none',
              background: 'transparent',
              outline: 'none'
            }}
          />
          <span style={{ fontSize: '14px', minWidth: '45px', fontWeight: '500', color: '#333', whiteSpace: 'nowrap' }}>{(opacity * 100).toFixed(0)}%</span>
        </div>
        <div style={{ flex: '1', minHeight: 0, position: 'relative', width: '100%', opacity: opacity }}>
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
