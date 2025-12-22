import { MonacoEditorReactComp } from "@typefox/monaco-editor-react";
import type {
  EditorApp,
  TextContents,
} from "monaco-languageclient/editorApp";
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
  value = "",
  onEditorStartDone,
}: MonacoEditorProps) {
  const [codeState, setCodeState] = useState<string>(value);

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
          onConfigProcessed={() =>
              console.log(" >>> WGSL config processed <<<")
          }
          onEditorStartDone={onEditorStartDone}
      />
  );
}