import { MonacoEditorReactComp } from "@typefox/monaco-editor-react";
import type {
  EditorAppConfig,
  EditorApp,
} from "monaco-languageclient/editorApp";
import type { MonacoVscodeApiConfig } from "monaco-languageclient/vscodeApiWrapper";

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
  language = "wgsl",
  theme = "vs-dark",
  value = "",
  readOnly = false,
  minimap = { enabled: true },
  onEditorStartDone,
}: MonacoEditorProps) {
  // Use the configured worker factory from monaco-worker-setup.ts
  // Workers are already configured, but we pass the factory function for consistency

  const vscodeApiConfig: MonacoVscodeApiConfig = {
    $type: "classic",
    viewsConfig: { $type: "EditorService" },
  };

  const editorAppConfig: EditorAppConfig = {
    codeResources: {
      modified: {
        uri: `/workspace/main.${language}`,
        text: value,
      },
    },
    readOnly,
    editorOptions: {
      theme,
      minimap,
      language,
    },
  };

  return (
    <MonacoEditorReactComp
      vscodeApiConfig={vscodeApiConfig}
      editorAppConfig={editorAppConfig}
      style={{ width: "100%", height: "100%", opacity: 0.95 }}
      onEditorStartDone={onEditorStartDone}
    />
  );
}