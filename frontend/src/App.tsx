import { useState, useEffect } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import Terminal from './Terminal'

// Import the WASM component directly - Vite will handle the module resolution
// The 'run' export is an object with a 'run' method (async)
// Using alias for cleaner import path
import { run as wasiCliRun } from '@wasm/triangle.js'

function App() {
  const [count, setCount] = useState(0)
  const [wasmLoaded, setWasmLoaded] = useState(false)

  useEffect(() => {
    // Load and run the WASM component when the component mounts
    const initWasm = async () => {
      try {
        // The run function is async (marked with --async-exports 'run')
        await wasiCliRun.run()
        setWasmLoaded(true)
      } catch (error) {
        console.error('Failed to run WASM component:', error)
      }
    }

    initWasm()
  }, [])

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
        {wasmLoaded && <p>WASM component loaded and running!</p>}
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
      <Terminal />
    </>
  )
}

export default App
