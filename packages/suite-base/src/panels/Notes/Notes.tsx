// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useTheme } from "@mui/material";
import type { editor } from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/markdown/register.js";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { useDebouncedCallback } from "use-debounce";

import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { headingDecorations } from "./headingDecorations";
import { useNotesSettings } from "./settings";
import { toggleTask } from "./toggleTask";
import { NotesConfig } from "./types";
import MonacoEditor, { EditorDidMount, EditorWillMount } from "../UserScriptEditor/MonacoEditor";
import { themes } from "../UserScriptEditor/theme";

/** Each save writes the layout, so batch keystrokes. */
export const SAVE_DEBOUNCE_MS = 500;

const useStyles = makeStyles()(({ palette, spacing }) => ({
  editor: {
    flex: "auto",
    minHeight: 0,
    padding: spacing(0, 1.5),
    backgroundColor: palette.background.paper,
    "& .notes-heading": { fontWeight: 600 },
    "& .notes-heading-1": { fontSize: "2em" },
    "& .notes-heading-2": { fontSize: "1.6em" },
    "& .notes-heading-3": { fontSize: "1.35em" },
    "& .notes-heading-4": { fontSize: "1.15em" },
    "& .monaco-editor, & .monaco-editor-background, & .margin": {
      backgroundColor: palette.background.paper,
    },
  },
}));

type Props = { config: NotesConfig; saveConfig: SaveConfig<NotesConfig> };

export function Notes({ config, saveConfig }: Props): React.JSX.Element {
  const { t } = useTranslation("notes");
  const { classes } = useStyles();
  const theme = useTheme();
  const editorRef = useRef<editor.IStandaloneCodeEditor>(undefined);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection>(undefined);
  const textRef = useRef(config.text);
  const fontSize =
    config.fontSize ??
    Number.parseFloat(theme.typography.body2.fontSize as string) * theme.typography.htmlFontSize;
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;

  useNotesSettings(config, saveConfig);

  const save = useDebouncedCallback((text: string) => {
    saveConfig({ text });
  }, SAVE_DEBOUNCE_MS);
  useEffect(
    () => () => {
      save.flush();
    },
    [save],
  );

  const updateHeadings = useCallback(() => {
    decorationsRef.current?.set(headingDecorations(textRef.current, fontSizeRef.current));
  }, []);

  useEffect(() => {
    if (textRef.current !== config.text) {
      save.cancel();
    }
    textRef.current = config.text;
    const model = editorRef.current?.getModel();
    if (model && model.getValue() !== config.text) {
      model.setValue(config.text);
    }
    updateHeadings();
  }, [config.text, save, updateHeadings]);

  useEffect(updateHeadings, [fontSize, updateHeadings]);

  const willMount = useCallback<EditorWillMount>((monaco) => {
    for (const editorTheme of themes) {
      monaco.editor.defineTheme(editorTheme.name, editorTheme.theme);
    }
  }, []);

  const didMount = useCallback<EditorDidMount>(
    (instance, monaco) => {
      editorRef.current = instance;
      const model = monaco.editor.createModel(textRef.current, "markdown");
      instance.setModel(model);
      decorationsRef.current = instance.createDecorationsCollection();
      updateHeadings();
      const blur = instance.onDidBlurEditorText(() => save.flush());
      const keys = instance.onKeyDown((event) => {
        if (
          event.keyCode === monaco.KeyCode.Escape ||
          (event.keyCode === monaco.KeyCode.Enter && (event.metaKey || event.ctrlKey))
        ) {
          event.preventDefault();
          event.stopPropagation();
          save.flush();
          instance.getDomNode()?.querySelector<HTMLElement>('[role="textbox"]')?.blur();
        }
      });
      const mouse = instance.onMouseDown((event) => {
        const position = event.target.position;
        if (!event.event.leftButton || !position) {
          return;
        }
        const line = model.getLineContent(position.lineNumber);
        const task = /^(\s*(?:[-*+]|\d+[.)])[\t ]+)(\[[ xX]\])/.exec(line);
        if (
          !task ||
          position.column <= task[1]!.length ||
          position.column > task[0].length ||
          monaco.editor
            .tokenize(model.getValue(), "markdown")
            [position.lineNumber - 1]?.some((token) => token.type === "keyword.md") !== true
        ) {
          return;
        }
        const offset = model.getOffsetAt({
          lineNumber: position.lineNumber,
          column: line.search(/\S/) + 1,
        });
        const toggled = toggleTask(model.getValue(), offset);
        const column = task[1]!.length + 2;
        instance.pushUndoStop();
        instance.executeEdits("notes.toggleTask", [
          {
            range: new monaco.Range(position.lineNumber, column, position.lineNumber, column + 1),
            text: toggled[model.getOffsetAt({ lineNumber: position.lineNumber, column })]!,
          },
        ]);
        instance.pushUndoStop();
      });
      instance.onDidDispose(() => {
        blur.dispose();
        keys.dispose();
        mouse.dispose();
        model.dispose();
        editorRef.current = undefined;
        decorationsRef.current = undefined;
      });
    },
    [save, updateHeadings],
  );

  const onChange = useCallback(
    (text: string) => {
      if (text === textRef.current) {
        return;
      }
      textRef.current = text;
      updateHeadings();
      save(text);
    },
    [save, updateHeadings],
  );

  const options = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      automaticLayout: true,
      ariaLabel: t("edit"),
      placeholder: t("placeholder"),
      fontFamily: theme.typography.body2.fontFamily,
      fontSize,
      lineHeight: 1.5,
      allowVariableFonts: true,
      allowVariableLineHeights: true,
      // shortcut: Monaco wraps using the base font size; enable wrapping when it measures heading fonts.
      wordWrap: "off",
      minimap: { enabled: false },
      lineNumbers: "off",
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollBeyondLastLine: false,
      padding: { top: 8, bottom: 8 },
      quickSuggestions: false,
      wordBasedSuggestions: "off",
      tabFocusMode: true,
    }),
    [fontSize, t, theme.typography.body2.fontFamily],
  );

  return (
    <Stack fullHeight>
      <PanelToolbar />
      <div className={classes.editor}>
        <MonacoEditor
          language="markdown"
          theme={theme.palette.mode === "dark" ? "vs-studio-dark" : "vs-studio-light"}
          options={options}
          editorWillMount={willMount}
          editorDidMount={didMount}
          onChange={onChange}
        />
      </div>
    </Stack>
  );
}
