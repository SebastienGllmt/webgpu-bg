import { init, Terminal } from 'ghostty-web';
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
  // Track the actual element so we can react to when it becomes available
  // Initialize to null - we'll update it in the effect
  const [element, setElement] = useState<T | null>(null);

  // Update element state when ref.current changes
  // useEffect runs after the DOM is updated, ensuring ref.current is set
  // React will prevent unnecessary re-renders if the value hasn't actually changed
  // We intentionally omit the dependency array to check ref.current on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const current = ref.current;
    if (current !== null) {
      setElement(current);
    }
  });

  const factory = useCallback(async () => {
    // Get the current ref value at call time, not closure time
    const currentElement = element;
    if (!currentElement) {
      throw new Error('Terminal ref is not available');
    }
  
    // Initialize ghostty-web only once globally, even if we close and recreate the terminal later
    if (!ghosttyInitialized) {
      await init();
      ghosttyInitialized = true;
    }

    const term = initTerminal();
    term.open(currentElement);

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
