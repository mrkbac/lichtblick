/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { editor, IKeyboardEvent } from "monaco-editor/editor/editor.api.js";

import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { Notes, SAVE_DEBOUNCE_MS } from "./Notes";
import { NotesConfig } from "./types";
import type { EditorDidMount } from "../UserScriptEditor/MonacoEditor";

vi.mock("monaco-editor/languages/definitions/markdown/register.js", () => ({}));
vi.mock("../UserScriptEditor/theme", () => ({ themes: [] }));
vi.mock("@lichtblick/suite-base/components/PanelToolbar", () => ({ default: () => <div /> }));
vi.mock("./settings", () => ({ useNotesSettings: vi.fn() }));

const mocks = vi.hoisted(() => ({
  decorate: vi.fn(),
  dispose: vi.fn(),
  blur: vi.fn(),
  executeEdits: vi.fn(),
  pushUndoStop: vi.fn(),
  tokenize: vi.fn(() => [[{ offset: 0, type: "keyword.md" }]]),
  keyDown: undefined as ((event: IKeyboardEvent) => void) | undefined,
  mouseDown: undefined as ((event: editor.IEditorMouseEvent) => void) | undefined,
}));

vi.mock("../UserScriptEditor/MonacoEditor", async () => {
  const React = await import("react");
  const { Range } = await import("monaco-editor/editor/common/core/range.js");
  return {
    default: function MockEditor(props: {
      editorDidMount: EditorDidMount;
      options: editor.IStandaloneEditorConstructionOptions;
      onChange: (text: string) => void;
    }) {
      const [value, setValue] = React.useState("");
      const blur = React.useRef<() => void>(() => {});
      const current = React.useRef(props);
      current.current = props;
      React.useEffect(() => {
        let text = "";
        let dispose = () => {};
        const model = {
          getValue: () => text,
          getLineContent: (line: number) => text.split("\n")[line - 1],
          getOffsetAt: ({ lineNumber, column }: { lineNumber: number; column: number }) =>
            text
              .split("\n")
              .slice(0, lineNumber - 1)
              .reduce((sum, line) => sum + line.length + 1, 0) +
            column -
            1,
          setValue: (next: string) => {
            text = next;
            setValue(next);
            current.current.onChange(next);
          },
          dispose: mocks.dispose,
        };
        const instance = {
          setModel: () => {},
          getModel: () => model,
          createDecorationsCollection: () => ({ set: mocks.decorate }),
          onDidBlurEditorText: (fn: () => void) => {
            blur.current = fn;
            return { dispose: () => {} };
          },
          onKeyDown: (fn: (event: IKeyboardEvent) => void) => {
            mocks.keyDown = fn;
            return { dispose: () => {} };
          },
          onMouseDown: (fn: (event: editor.IEditorMouseEvent) => void) => {
            mocks.mouseDown = fn;
            return { dispose: () => {} };
          },
          getDomNode: () => ({ querySelector: () => ({ blur: mocks.blur }) }),
          executeEdits: mocks.executeEdits,
          pushUndoStop: mocks.pushUndoStop,
          onDidDispose: (fn: () => void) => {
            dispose = fn;
          },
        };
        current.current.editorDidMount(
          instance as unknown as editor.IStandaloneCodeEditor,
          {
            KeyCode: { Escape: 9, Enter: 3 },
            Range,
            editor: {
              tokenize: mocks.tokenize,
              createModel: (initial: string) => {
                text = initial;
                setValue(initial);
                return model;
              },
            },
          } as unknown as Parameters<EditorDidMount>[1],
        );
        return () => {
          dispose();
        };
      }, []);
      return (
        <textarea
          aria-label={props.options.ariaLabel}
          placeholder={props.options.placeholder}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            props.onChange(event.target.value);
          }}
          onBlur={() => {
            blur.current();
          }}
        />
      );
    },
  };
});

function setup(config: NotesConfig = { text: "" }) {
  const saveConfig = vi.fn();
  const view = (next: NotesConfig) => (
    <ThemeProvider isDark={false}>
      <Notes config={next} saveConfig={saveConfig} />
    </ThemeProvider>
  );
  const result = render(view(config));
  return {
    ...result,
    saveConfig,
    update: (next: NotesConfig) => {
      result.rerender(view(next));
    },
  };
}

function type(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
}

describe("Notes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.tokenize.mockReturnValue([[{ offset: 0, type: "keyword.md" }]]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is immediately editable, including an empty note", () => {
    setup();
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    type("# Hello");
    expect(screen.getByRole("textbox")).toHaveValue("# Hello");
    expect(mocks.decorate).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ options: expect.objectContaining({ fontWeight: "600" }) }),
      ]),
    );
  });

  it("loads existing Markdown without saving it again", () => {
    const { saveConfig } = setup({ text: "# Hello\n\n- [x] done" });
    expect(screen.getByRole("textbox")).toHaveValue("# Hello\n\n- [x] done");
    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("debounces saves while typing", () => {
    const { saveConfig } = setup();
    type("a");
    type("ab");
    expect(saveConfig).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });
    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(saveConfig).toHaveBeenCalledWith({ text: "ab" });
  });

  it("flushes pending text on blur and stays editable", () => {
    const { saveConfig } = setup();
    type("draft");
    fireEvent.blur(screen.getByRole("textbox"));
    expect(saveConfig).toHaveBeenCalledWith({ text: "draft" });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("flushes pending text and disposes the model on unmount", () => {
    const { saveConfig, unmount } = setup();
    type("draft");
    unmount();
    expect(saveConfig).toHaveBeenCalledWith({ text: "draft" });
    expect(mocks.dispose).toHaveBeenCalled();
  });

  it("syncs external changes without scheduling a save", () => {
    const { saveConfig, update } = setup({ text: "old" });
    update({ text: "# New" });
    expect(screen.getByRole("textbox")).toHaveValue("# New");
    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("cancels a stale pending save when the note is replaced externally", () => {
    const { saveConfig, update } = setup({ text: "old" });
    type("draft");
    update({ text: "external" });
    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });
    expect(screen.getByRole("textbox")).toHaveValue("external");
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("preserves newer typing when an earlier save echoes through props", () => {
    // Given a save whose prop update has not arrived yet.
    const { saveConfig, update } = setup();
    type("saved");
    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    // When the user keeps typing before the saved value arrives.
    type("saved and newer");
    update({ text: "saved" });

    // Then the editor and pending save retain the newer text.
    expect(screen.getByRole("textbox")).toHaveValue("saved and newer");
    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });
    expect(saveConfig).toHaveBeenLastCalledWith({ text: "saved and newer" });
    update({ text: "external" });
    expect(screen.getByRole("textbox")).toHaveValue("external");
    type("another draft");
    update({ text: "saved and newer" });
    expect(screen.getByRole("textbox")).toHaveValue("saved and newer");
  });

  it.each([
    { name: "Escape", keyCode: 9 },
    { name: "Cmd+Enter", keyCode: 3, metaKey: true },
    { name: "Ctrl+Enter", keyCode: 3, ctrlKey: true },
  ])("saves and blurs on $name", ({ name: _name, ...key }) => {
    // Given pending typing in the editor.
    const { saveConfig } = setup();
    type("draft");
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    // When the leave-editor shortcut is pressed.
    act(() => {
      mocks.keyDown!({ ...key, preventDefault, stopPropagation } as IKeyboardEvent);
    });
    // Then it saves and releases focus, without removing the editor.
    expect(saveConfig).toHaveBeenCalledWith({ text: "draft" });
    expect(mocks.blur).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("keeps ordinary Enter as an editing key", () => {
    setup();
    act(() => {
      mocks.keyDown!({ keyCode: 3 } as IKeyboardEvent);
    });
    expect(mocks.blur).not.toHaveBeenCalled();
  });

  it("toggles only the clicked nested task and gives it an undo boundary", () => {
    // Given nested tasks.
    setup({ text: "- [ ] parent\n  - [x] child" });
    mocks.tokenize.mockReturnValue([
      [{ offset: 0, type: "keyword.md" }],
      [{ offset: 0, type: "keyword.md" }],
    ]);
    // When the child's marker is clicked.
    act(() => {
      mocks.mouseDown!({
        event: { leftButton: true },
        target: { position: { lineNumber: 2, column: 6 } },
      } as editor.IEditorMouseEvent);
    });
    // Then only its check character changes, as an undoable edit.
    expect(mocks.executeEdits).toHaveBeenCalledWith("notes.toggleTask", [
      { range: { startLineNumber: 2, endLineNumber: 2, startColumn: 6, endColumn: 7 }, text: " " },
    ]);
    expect(mocks.pushUndoStop).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: "list marker", column: 1, token: "keyword.md", leftButton: true },
    { name: "task text", column: 8, token: "keyword.md", leftButton: true },
    { name: "code", column: 4, token: "variable.source.md", leftButton: true },
    { name: "right click", column: 4, token: "keyword.md", leftButton: false },
  ])("ignores clicks on $name", ({ name: _name, column, token, leftButton }) => {
    setup({ text: "- [ ] task" });
    mocks.tokenize.mockReturnValue([[{ offset: 0, type: token }]]);
    act(() => {
      mocks.mouseDown!({
        event: { leftButton },
        target: { position: { lineNumber: 1, column } },
      } as editor.IEditorMouseEvent);
    });
    expect(mocks.executeEdits).not.toHaveBeenCalled();
  });

  it("updates heading sizes when the font setting changes", () => {
    const { update } = setup({ text: "# Title", fontSize: 12 });
    update({ text: "# Title", fontSize: 20 });
    expect(mocks.decorate).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ options: expect.objectContaining({ fontSize: "40px" }) }),
      ]),
    );
  });
});
