/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

import getKeybindingsServiceOverride from "@codingame/monaco-vscode-keybindings-service-override";
// import getLifecycleServiceOverride from "@codingame/monaco-vscode-lifecycle-service-override";
import getLocalizationServiceOverride from "@codingame/monaco-vscode-localization-service-override";
import { LogLevel } from "@codingame/monaco-vscode-api";
import { createDefaultLocaleConfiguration } from "monaco-languageclient/vscodeApiLocales";
import type { MonacoVscodeApiConfig } from "monaco-languageclient/vscodeApiWrapper";
import { configureDefaultWorkerFactory } from "monaco-languageclient/workerFactory";
import type {
    CodeContent,
    EditorAppConfig,
} from "monaco-languageclient/editorApp";

/**
 * Simple WGSL configuration without LSP.
 * This uses Monaco's built-in WGSL support (syntax highlighting, basic editing).
 * No language server is needed for this setup.
 */
export const createWgslConfigSimple = (params: {
    codeContent: CodeContent;
    htmlContainer?: HTMLElement;
}): {
    vscodeApiConfig: MonacoVscodeApiConfig;
    editorAppConfig: EditorAppConfig;
} => {
    const vscodeApiConfig: MonacoVscodeApiConfig = {
        $type: "extended",
        viewsConfig: {
            $type: "EditorService",
            htmlContainer: params.htmlContainer,
        },
        logLevel: LogLevel.Info,
        serviceOverrides: {
            ...getKeybindingsServiceOverride(),
            // ...getLifecycleServiceOverride(),
            ...getLocalizationServiceOverride(
                createDefaultLocaleConfiguration(),
            ),
        },
        advanced: {
            loadThemes: false, // Disable theme loading to avoid 404 errors
        },
        monacoWorkerFactory: configureDefaultWorkerFactory,
        userConfiguration: {
            json: JSON.stringify({
                "workbench.colorTheme": "Default Dark Modern",
                "editor.guides.bracketPairsHorizontal": "active",
                "editor.wordBasedSuggestions": "off",
                "editor.experimental.asyncTokenization": true,
            }),
        },
    };

    const editorAppConfig: EditorAppConfig = {
        codeResources: {
            modified: params.codeContent,
        },
        logLevel: LogLevel.Info,
    };

    return {
        editorAppConfig,
        vscodeApiConfig,
    };
};
