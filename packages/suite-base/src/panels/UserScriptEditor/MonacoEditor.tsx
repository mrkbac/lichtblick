// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as monacoApi from "monaco-editor/editor/editor.api.js";
import { ReactElement, useEffect, useRef } from "react";
import { useLatest } from "react-use";

type Monaco = typeof monacoApi;
type Editor = monacoApi.editor.IStandaloneCodeEditor;
type Options = monacoApi.editor.IStandaloneEditorConstructionOptions;

export type EditorWillMount = (monaco: Monaco) => Options | void;
export type EditorDidMount = (editor: Editor, monaco: Monaco) => void;

type Props = {
  language: string;
  theme: string;
  options: Options;
  editorWillMount: EditorWillMount;
  editorDidMount: EditorDidMount;
  onChange: (value: string) => void;
};

// Monaco's fallback for its editor worker is a bare `new URL(...)`, which the bundler emits as an
// unbundled asset, so create the workers here (Monaco's documented ESM setup).
globalThis.MonacoEnvironment = {
  getWorker: (_moduleId: string, label: string) =>
    label === "typescript" || label === "javascript"
      ? new Worker(
          new URL("monaco-editor/languages/features/typescript/ts.worker.js", import.meta.url),
          { type: "module" },
        )
      : new Worker(new URL("monaco-editor/editor/editor.worker.js", import.meta.url), {
          type: "module",
        }),
};

/** Thin wrapper around the locally bundled monaco editor (no CDN loader). */
export default function MonacoEditor(props: Props): ReactElement {
  const containerRef = useRef<HTMLDivElement>(ReactNull);
  const editorRef = useRef<Editor>(undefined);
  const latestProps = useLatest(props);

  useEffect(() => {
    const { language, theme, options, editorWillMount, editorDidMount } = latestProps.current;
    const editor = monacoApi.editor.create(containerRef.current!, {
      language,
      theme,
      ...options,
      ...editorWillMount(monacoApi),
    });
    editorRef.current = editor;
    editorDidMount(editor, monacoApi);
    const subscription = editor.onDidChangeModelContent(() => {
      latestProps.current.onChange(editor.getValue());
    });
    return () => {
      subscription.dispose();
      editor.dispose();
      editorRef.current = undefined;
    };
  }, [latestProps]);

  useEffect(() => {
    editorRef.current?.updateOptions(props.options);
  }, [props.options]);

  useEffect(() => {
    monacoApi.editor.setTheme(props.theme);
  }, [props.theme]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
