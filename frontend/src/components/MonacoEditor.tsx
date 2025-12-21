import { MonacoEditorReactComp } from "@typefox/monaco-editor-react";
import type {
  EditorAppConfig,
  EditorApp,
  TextContents,
} from "monaco-languageclient/editorApp";
import type { MonacoVscodeApiConfig } from "monaco-languageclient/vscodeApiWrapper";
import { useState } from "react";
import { createWgslConfigSimple } from "./wgslConfigSimple";

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
  const [codeState, setCodeState] = useState<string>(value);
  const [triggerReprocessConfig, setTriggerReprocessConfig] =
      useState<number>(0);

  const onTextChanged = (textChanges: TextContents) => {
      if (textChanges.modified !== codeState) {
          setCodeState(textChanges.modified as string);
      }
  };

  const appConfig = createWgslConfigSimple({
      codeContent: {
          text: codeState,
          uri: "/workspace/shader.wgsl",
      },
  });

  return (
      <MonacoEditorReactComp
          style={{ height: "70vh" }}
          vscodeApiConfig={appConfig.vscodeApiConfig}
          editorAppConfig={appConfig.editorAppConfig}
          // No languageClientConfig - using built-in WGSL support only!
          onTextChanged={onTextChanged}
          triggerReprocessConfig={triggerReprocessConfig}
          onConfigProcessed={() =>
              console.log(" >>> WGSL config processed <<<")
          }
          onEditorStartDone={() =>
              console.log(" >>> WGSL editor started <<<")
          }
      />
  );
}