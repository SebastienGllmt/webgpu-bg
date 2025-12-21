import { useEffect, useRef } from 'react';
import { init, Terminal } from 'ghostty-web';

let ghosttyInitialized = false;

export default function TerminalComponent() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const initializeTerminal = async () => {
      if (!terminalRef.current) {
        return;
      }

      try {
        // Initialize ghostty-web only once
        if (!ghosttyInitialized) {
          await init();
          ghosttyInitialized = true;
        }

        const term = initTerminal();

        // Open terminal in the DOM element
        term.open(terminalRef.current);
        terminalInstanceRef.current = term;

        // Write initial message
        term.write('Component Terminal - Type "help" for available commands\r\n');
        term.write('$ ');
      } catch (error) {
        console.error('Failed to initialize terminal:', error);
      }
    };

    initializeTerminal();

    // Cleanup function
    return () => {
      // Clean up terminal instance if needed
      if (terminalInstanceRef.current) {
        // Note: ghostty-web may not have a cleanup method, but we store the ref
        // in case you need to access it later or add cleanup logic
        terminalInstanceRef.current = null;
      }
    };
  }, []);

  return <div id="terminal-content" ref={terminalRef} />;
}

function initTerminal(): Terminal {
  // Create and configure the terminal
  const term = new Terminal({
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