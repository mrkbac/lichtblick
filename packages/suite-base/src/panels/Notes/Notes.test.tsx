/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { editor } from "monaco-editor/editor/editor.api.js";

import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { Notes, SAVE_DEBOUNCE_MS } from "./Notes";
import { NotesConfig } from "./types";
import type { EditorDidMount } from "../UserScriptEditor/MonacoEditor";

vi.mock("monaco-editor/languages/definitions/markdown/register.js", () => ({}));
vi.mock("../UserScriptEditor/theme", () => ({ themes: [] }));
vi.mock("@lichtblick/suite-base/components/PanelToolbar", () => ({ default: () => <div /> }));
vi.mock("./settings", () => ({ useNotesSettings: vi.fn() }));

const mocks = vi.hoisted(() => ({ decorate: vi.fn(), dispose: vi.fn() }));

vi.mock("../UserScriptEditor/MonacoEditor", async () => {
  const React = await import("react");
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
          onKeyDown: () => ({ dispose: () => {} }),
          onMouseDown: () => ({ dispose: () => {} }),
          onDidDispose: (fn: () => void) => {
            dispose = fn;
          },
        };
        current.current.editorDidMount(
          instance as unknown as editor.IStandaloneCodeEditor,
          {
            editor: {
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
