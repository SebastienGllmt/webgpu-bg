import { init, Terminal, FitAddon } from 'ghostty-web';
import { useAsyncResource } from './useAsyncResource';
import type { RefObject } from 'react';
import { useCallback, useLayoutEffect, useState } from 'react';

let ghosttyInitialized = false;

class DisposableTerminal extends Terminal {
  [Symbol.dispose]() {
    this.dispose();
  }
}
export function useTerminal<T extends HTMLElement>(ref: RefObject<T | null>) {
  // Track the ref.current (which can't be tracked automatically by React)
  const [element, setElement] = useState<T | null>(null);

  // Update element state when ref.current changes
  // note: useLayoutEffect to avoid the terminal briefly showing an error message saying it's not attached to a ref
  useLayoutEffect(() => {
    const current = ref.current;
    if (current !== null) {
      setElement(current);
    }
  }, [ref]);

  const factory = useCallback(async () => {
    // Get the current ref value at call time, not closure time
    const currentElement = element;
    if (!currentElement) {
      throw new Error('Terminal ref is not available');
    }
  
    // Initialize ghostty-web only once globally, even if we close & recreate the terminal later
    if (!ghosttyInitialized) {
      await init();
      ghosttyInitialized = true;
    }

    const term = initTerminal();
    term.open(currentElement);

    // Use FitAddon to automatically resize terminal to fit container
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    // Fit the terminal to the container dimensions
    fitAddon.fit();
    
    // Auto-fit on container resize
    fitAddon.observeResize();

    // Write initial message
    term.write('Component Terminal - Type "help" for available commands\r\n');
    term.write('$ ');

    return term;
  }, [element]);

  return useAsyncResource(factory);
}

function initTerminal(): DisposableTerminal {
  // Create and configure the terminal
  const term = new DisposableTerminal({
    fontSize: 14, // 1:100, 14:800, 15:900
    cols: 100, // cols * 8
    rows: 50, // height = fontSize * rows
    theme: {
      background: '#1a1b26',
      foreground: '#a9b1d6',
    },
    cursorBlink: true,
    cursorStyle: 'block',
  });
  // Command buffer to handle multi-character input
  let commandBuffer = '';
  let isProcessing = false;

  // Handle user input
  term.onData((data) => {
    // Handle special keys
    if (data === '\r' || data === '\n') {
      // Enter key - execute command
      if (!isProcessing && commandBuffer.trim()) {
        isProcessing = true;
        term.write('\r\n');
        
        term.write('$ ');
        commandBuffer = '';
        isProcessing = false;
        // session.executeCommand(term, commandBuffer)
        //   .then((result) => {
        //     if (result.output) {
        //       term.write(result.output);
        //       if (!result.output.endsWith('\n')) {
        //         term.write('\r\n');
        //       }
        //     }
        //     // Write prompt
        //     term.write('$ ');
        //     commandBuffer = '';
        //     isProcessing = false;
        //   })
        //   .catch((error) => {
        //     term.write(`Error: ${error instanceof Error ? error.message : String(error)}\r\n`);
        //     term.write('$ ');
        //     commandBuffer = '';
        //     isProcessing = false;
        //   });
      } else if (!isProcessing) {
        // Empty line, just show prompt
        term.write('$ ');
      }
    } else if (data === '\x7f' || data === '\b') {
      // Backspace
      if (!isProcessing && commandBuffer.length > 0) {
        commandBuffer = commandBuffer.slice(0, -1);
        term.write('\b \b');
      }
    } else if (data === '\x03') {
      // Ctrl+C - cancel current command
      if (isProcessing) {
        isProcessing = false;
        commandBuffer = '';
        term.write('^C\r\n$ ');
      } else {
        commandBuffer = '';
        term.write('^C\r\n$ ');
      }
    } else if (data >= ' ' && data <= '~') {
      // Printable characters
      if (!isProcessing) {
        commandBuffer += data;
        term.write(data);
      }
    } else {
      // Other control characters - just write them (handles arrow keys, etc.)
      if (!isProcessing) {
        term.write(data);
      }
    }
  });

  return term;
}
