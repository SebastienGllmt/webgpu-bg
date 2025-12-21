import { useRef, useEffect, useState, useCallback } from 'react';
import type { RefObject } from 'react';
import { MonacoEditorReactComp } from '@typefox/monaco-editor-react';
import type { UserConfig } from 'monaco-editor-wrapper';
import { useAsyncResource } from './useAsyncResource';

export interface MonacoEditorConfig {
  language?: string;
  theme?: string;
  value?: string;
  readOnly?: boolean;
  minimap?: { enabled: boolean };
}

export function useMonacoEditor<T extends HTMLElement>(
  ref: RefObject<T | null>,
  config: MonacoEditorConfig = {}
) {
  const [element, setElement] = useState<T | null>(null);
  const editorRef = useRef<MonacoEditorReactComp | null>(null);

  // Update element state when ref.current changes
  useEffect(() => {
    const current = ref.current;
    if (current !== null) {
      setElement(current);
    }
  }, [ref]);

  const factory = useCallback(async () => {
    const currentElement = element;
    if (!currentElement) {
      throw new Error('Editor container ref is not available');
    }

    // Create worker for language server
    const worker = new Worker(
      new URL('../workers/languageServer.worker.ts', import.meta.url),
      { type: 'module' }
    );

    // Initialize worker
    worker.postMessage({ type: 'init' });

    // Wait for worker to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Language server worker initialization timeout'));
      }, 10000);

      worker.onmessage = (event) => {
        if (event.data.type === 'ready') {
          clearTimeout(timeout);
          resolve();
        } else if (event.data.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(event.data.error));
        }
      };
    });

    // Create user config for Monaco editor
    const userConfig: UserConfig = {
      htmlElement: currentElement,
      wrapperConfig: {
        $type: 'extended',
        editorAppConfig: {
          $type: 'extended',
          languageId: config.language || 'typescript',
          useDiffEditor: false,
          codeResources: {
            modified: {
              uri: '/workspace/main.ts',
              text: config.value || '',
            },
          },
          userConfiguration: {
            json: JSON.stringify({
              'editor.theme': config.theme || 'vs-dark',
              'editor.minimap.enabled': config.minimap?.enabled ?? true,
              'editor.readOnly': config.readOnly ?? false,
            }),
          },
          languageClientConfig: {
            enabled: true,
            options: {
              $type: 'WebWorker',
              name: 'language-server-worker',
              url: new URL('../workers/languageServer.worker.ts', import.meta.url),
            },
          },
        },
      },
    };

    return {
      userConfig,
      worker,
      [Symbol.dispose]() {
        worker.terminate();
      },
    };
  }, [element, config]);

  return useAsyncResource(factory);
}

