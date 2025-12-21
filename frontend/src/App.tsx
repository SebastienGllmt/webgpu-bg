import { useState, useEffect } from 'react'
import './App.css'
import TerminalComponent from './useTerminal.js'

// Import the WASM component directly - Vite will handle the module resolution
// The 'run' export is an object with a 'run' method (async)
// Using alias for cleaner import path
import { run as wasiCliRun } from '@wasm/triangle.js'

function App() {
  const [wasmLoaded, setWasmLoaded] = useState(false)

  useEffect(() => {
    // Load and run the WASM component when the component mounts
    const initWasm = async () => {
      try {
        // The run function is async (marked with --async-exports 'run')
        await wasiCliRun.run()
        console.log('WASM component loaded and running!')
        setWasmLoaded(true)
      } catch (error) {
        console.error('Failed to run WASM component:', error)
      }
    }

    initWasm()
  }, [])

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
