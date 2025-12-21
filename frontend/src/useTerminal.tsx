import { useRef } from "react";
import { useTerminal } from "./hooks/useTerminal";

export default function TerminalComponent() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const { resource: terminal, error } = useTerminal(terminalRef);

  if (error != null) {
    return <div>Error: {String(error)}</div>;
  }

  // Always render the div so the ref gets attached, even if terminal isn't ready yet
  return <div className="terminal-content" ref={terminalRef} tabIndex={0} />;
}
