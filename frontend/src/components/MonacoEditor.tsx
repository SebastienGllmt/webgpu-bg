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
    editorOptions: {
      theme,
      minimap: {
        enabled: minimap.enabled,
      },
      language, // Built-in language - works immediately!
    },
  };

  return (
    <MonacoEditorReactComp
      vscodeApiConfig={vscodeApiConfig}
      editorAppConfig={editorAppConfig}
      style={{ width: '100%', height: '100%', opacity: 0.8 }}
      onEditorStartDone={onEditorStartDone}
    />
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
