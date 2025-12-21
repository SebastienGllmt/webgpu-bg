import { useEffect, useRef, useCallback } from 'react';
import { MonacoEditorReactComp } from '@typefox/monaco-editor-react';
import type { EditorAppConfig, EditorApp } from 'monaco-languageclient/editorApp';
import type { MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import { configureDefaultWorkerFactory } from 'monaco-languageclient/workerFactory';

export interface MonacoEditorProps {
  language?: string;
  theme?: string;
  value?: string;
  readOnly?: boolean;
  minimap?: { enabled: boolean };
  height?: string;
  onEditorStartDone?: (editorApp?: EditorApp) => void;
}

export default function MonacoEditor({
  language = 'typescript',
  theme = 'vs-dark',
  value = '',
  readOnly = false,
  minimap = { enabled: true },
  height = '100%',
  onEditorStartDone,
}: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorAppRef = useRef<EditorApp | null>(null);

  // Create VSCode API config - required for Monaco editor wrapper
  // Use 'classic' mode to avoid loading VSCode workbench resources (themes, localization, etc.)
  const vscodeApiConfig: MonacoVscodeApiConfig = {
    $type: 'classic',
    viewsConfig: {
      $type: 'EditorService',
    },
    monacoWorkerFactory: configureDefaultWorkerFactory,
  };

  // Create editor app config for built-in Monaco languages
  // Built-in languages (WGSL, JavaScript, TypeScript, Python, etc.) work out of the box
  // No language server required - Monaco Editor includes syntax highlighting,
  // tokenization, and basic IntelliSense for these languages
  const editorAppConfig: EditorAppConfig = {
    codeResources: {
      modified: {
        uri: `/workspace/main.${getFileExtension(language)}`,
        text: value,
      },
    },
    useDiffEditor: false,
    readOnly,
    overrideAutomaticLayout: false, // Let Monaco handle layout automatically
    editorOptions: {
      theme,
      minimap: {
        enabled: minimap.enabled,
      },
      language, // Built-in language - works immediately!
      automaticLayout: true, // Automatically resize editor when container size changes
    },
  };

  // Handle editor ready callback
  const handleEditorStartDone = useCallback((editorApp?: EditorApp) => {
    editorAppRef.current = editorApp || null;
    if (onEditorStartDone) {
      onEditorStartDone(editorApp);
    }
  }, [onEditorStartDone]);

  // Set up ResizeObserver and window resize listener to trigger editor layout
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const triggerLayout = () => {
      if (editorAppRef.current) {
        const editorApp = editorAppRef.current;
        // Try multiple ways to access the editor instance
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let editor: any = null;
        
        // Cast through unknown to access dynamic properties
        const editorAppAny = editorApp as unknown as Record<string, unknown>;
        
        // Method 1: getEditor method (most common API)
        if ('getEditor' in editorAppAny && typeof editorAppAny.getEditor === 'function') {
          editor = (editorAppAny.getEditor as () => unknown)();
        }
        // Method 2: Try accessing through internal properties (fallback)
        else if ('_editor' in editorAppAny) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          editor = editorAppAny._editor as any;
        }
        // Method 3: Try accessing through editorService
        else if ('editorService' in editorAppAny) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const editorService = editorAppAny.editorService as any;
          if (editorService && 'editor' in editorService) {
            editor = editorService.editor;
          } else if (editorService && 'getEditor' in editorService && typeof editorService.getEditor === 'function') {
            editor = editorService.getEditor();
          }
        }

        // Call layout if we found the editor
        if (editor && typeof editor.layout === 'function') {
          editor.layout();
        }
      }
    };

    // Use ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(() => {
      triggerLayout();
    });

    resizeObserver.observe(container);

    // Also listen to window resize as a fallback
    window.addEventListener('resize', triggerLayout);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', triggerLayout);
    };
  }, []);

  return (
    <div 
      ref={containerRef}
      style={{ height, width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', opacity: 0.8 }}
    >
      <MonacoEditorReactComp
        vscodeApiConfig={vscodeApiConfig}
        editorAppConfig={editorAppConfig}
        style={{ height: '100%', width: '100%', flex: '1', minWidth: 0 }}
        onEditorStartDone={handleEditorStartDone}
      />
    </div>
  );
}

// Helper to get file extension from language ID
function getFileExtension(language: string): string {
  const extensions: Record<string, string> = {
    typescript: 'ts',
    javascript: 'js',
    python: 'py',
    wgsl: 'wgsl',
    rust: 'rs',
    go: 'go',
    java: 'java',
    csharp: 'cs',
    html: 'html',
    css: 'css',
    json: 'json',
    markdown: 'md',
  };
  return extensions[language.toLowerCase()] || 'txt';
}
