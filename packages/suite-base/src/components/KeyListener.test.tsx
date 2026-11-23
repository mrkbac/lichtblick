/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MenuItem, MenuList, Slider } from "@mui/material";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import type { Mock } from "vitest";

import KeyListener, { KeyListenerProps } from "./KeyListener";

describe("KeyListener", () => {
  let mockHandler: Mock;

  beforeEach(() => {
    mockHandler = vi.fn();
  });

  function setup(propsOverride: Partial<KeyListenerProps> = {}) {
    const props: KeyListenerProps = {
      ...propsOverride,
    };

    return {
      ...render(<KeyListener {...props} />),
    };
  }

  describe("keydown events", () => {
    it("should call handler when key is pressed", () => {
      // Given
      const key = "a";
      const keyDownHandlers = { [key]: mockHandler };
      setup({ global: true, keyDownHandlers });

      // When
      const event = new KeyboardEvent("keydown", { key });
      document.dispatchEvent(event);

      // Then
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should still run when an earlier listener re-renders it during the same keypress", () => {
      // Given: like a parent panel exiting fullscreen, the first listener's handler re-renders the
      // second listener synchronously, giving it new handlers mid-dispatch
      const second = vi.fn();
      function Listeners() {
        const [count, setCount] = useState(0);
        return (
          <>
            <KeyListener
              global
              keyDownHandlers={{
                escape: () => {
                  flushSync(() => {
                    setCount((c) => c + 1);
                  });
                },
              }}
            />
            <KeyListener global keyDownHandlers={{ escape: () => second(count) }} />
          </>
        );
      }
      render(<Listeners />);

      // When
      act(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });

      // Then
      expect(second).toHaveBeenCalledTimes(1);
    });

    it("should skip keys the focused element already handled", () => {
      // Given: a tree that uses the arrow keys itself (React handlers run before document ones)
      const keyDownHandlers = { arrowleft: mockHandler };
      setup({ global: true, keyDownHandlers });
      const tree = document.createElement("div");
      tree.addEventListener("keydown", (event) => {
        event.preventDefault();
      });
      document.body.appendChild(tree);

      // When
      tree.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
      );
      tree.remove();

      // Then
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it("should leave arrow keys to a focused slider or menu", () => {
      // Given: playback-style shortcuts on the arrow keys
      setup({ global: true, keyDownHandlers: { arrowright: mockHandler, arrowdown: mockHandler } });
      render(
        <>
          <Slider defaultValue={2} max={10} />
          <MenuList>
            <MenuItem>first</MenuItem>
            <MenuItem>second</MenuItem>
          </MenuList>
        </>,
      );

      // When
      fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
      fireEvent.keyDown(screen.getByText("first"), { key: "ArrowDown" });

      // Then
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it("should still call every global listener for a key another listener handled", () => {
      // Given: e.g. one listener per Plot panel for the same shortcut
      const otherHandler = vi.fn();
      setup({ global: true, keyDownHandlers: { a: mockHandler } });
      setup({ global: true, keyDownHandlers: { a: otherHandler } });

      // When
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", cancelable: true }));

      // Then
      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(otherHandler).toHaveBeenCalledTimes(1);
    });

    it("should prevent default behavior by default", () => {
      // Given
      const key = "a";
      const keyDownHandlers = { [key]: mockHandler };
      setup({ global: true, keyDownHandlers });

      // When
      const event = new KeyboardEvent("keydown", { key, cancelable: true });
      document.dispatchEvent(event);

      // Then
      expect(event.defaultPrevented).toBe(true);
    });

    it("should not prevent default when handler returns false", () => {
      // Given
      const key = "a";
      mockHandler.mockReturnValue(false);
      const keyDownHandlers = { [key]: mockHandler };

      setup({ global: true, keyDownHandlers });

      // When
      const event = new KeyboardEvent("keydown", { key, cancelable: true });
      document.dispatchEvent(event);

      // Then
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe("keyup events", () => {
    it("should call handler when key is released", () => {
      // Given
      const key = "a";
      const keyUpHandlers = { [key]: mockHandler };
      setup({ global: true, keyUpHandlers });

      // When
      const event = new KeyboardEvent("keyup", { key });
      document.dispatchEvent(event);

      // Then
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("keypress events", () => {
    it("should call handler when key is pressed", () => {
      // Given
      const key = "a";
      const keyPressHandlers = { [key]: mockHandler };
      setup({ global: true, keyPressHandlers });

      // When
      const event = new KeyboardEvent("keypress", { key });
      document.dispatchEvent(event);

      // Then
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("editable element detection", () => {
    it("should ignore events from input elements", () => {
      // Given
      const key = "a";
      const keyDownHandlers = { [key]: mockHandler };
      setup({ global: true, keyDownHandlers });
      const input = document.createElement("input");
      document.body.appendChild(input);

      // When
      const event = new KeyboardEvent("keydown", { key, bubbles: true });
      input.dispatchEvent(event);

      // Then
      expect(mockHandler).not.toHaveBeenCalled();
      input.remove();
    });

    it("should ignore events from textarea elements", () => {
      // Given
      const key = "a";
      const keyDownHandlers = { [key]: mockHandler };
      setup({ global: true, keyDownHandlers });
      const textarea = document.createElement("textarea");
      document.body.appendChild(textarea);

      // When
      const event = new KeyboardEvent("keydown", { key, bubbles: true });
      textarea.dispatchEvent(event);

      // Then
      expect(mockHandler).not.toHaveBeenCalled();
      textarea.remove();
    });

    it("should ignore events from contentEditable elements", () => {
      // Given
      const key = "a";
      const keyDownHandlers = { [key]: mockHandler };
      setup({ global: true, keyDownHandlers });
      const div = document.createElement("div");
      div.contentEditable = "true";
      document.body.appendChild(div);

      // When
      const event = new KeyboardEvent("keydown", { key, bubbles: true });
      div.dispatchEvent(event);

      // Then
      expect(mockHandler).not.toHaveBeenCalled();
      div.remove();
    });

    it("should ignore events from monaco-editor elements", () => {
      // Given
      const key = "a";
      const keyDownHandlers = { [key]: mockHandler };
      setup({ global: true, keyDownHandlers });
      const monacoEditor = document.createElement("div");
      monacoEditor.className = "monaco-editor";
      const innerElement = document.createElement("div");
      monacoEditor.appendChild(innerElement);
      document.body.appendChild(monacoEditor);

      // When
      const event = new KeyboardEvent("keydown", { key, bubbles: true });
      innerElement.dispatchEvent(event);

      // Then
      expect(mockHandler).not.toHaveBeenCalled();
      monacoEditor.remove();
    });
  });

  describe("global vs local mode", () => {
    it("should listen on document when global is true", () => {
      // Given
      const key = "a";
      const keyDownHandlers = { [key]: mockHandler };
      setup({ global: true, keyDownHandlers });

      // When
      const event = new KeyboardEvent("keydown", { key });
      document.dispatchEvent(event);

      // Then
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should listen on parent element when global is false", () => {
      // Given
      const key = "a";
      const keyDownHandlers = { [key]: mockHandler };
      const container = document.createElement("div");
      document.body.appendChild(container);
      render(<KeyListener keyDownHandlers={keyDownHandlers} />, { container });

      // When
      const event = new KeyboardEvent("keydown", { key, bubbles: true });
      container.dispatchEvent(event);

      // Then
      expect(mockHandler).toHaveBeenCalledTimes(1);
      container.remove();
    });
  });

  describe("multiple handlers", () => {
    it("should support multiple key handlers", () => {
      // Given
      const key1 = "a";
      const key2 = "b";
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const keyDownHandlers = { [key1]: handler1, [key2]: handler2 };
      setup({ global: true, keyDownHandlers });

      // When
      const event1 = new KeyboardEvent("keydown", { key: key1 });
      document.dispatchEvent(event1);
      const event2 = new KeyboardEvent("keydown", { key: key2 });
      document.dispatchEvent(event2);

      // Then
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should handle keydown and keyup handlers separately", () => {
      // Given
      const key = "a";
      const keyDownHandler = vi.fn();
      const keyUpHandler = vi.fn();
      setup({
        global: true,
        keyDownHandlers: { [key]: keyDownHandler },
        keyUpHandlers: { [key]: keyUpHandler },
      });

      // When
      const downEvent = new KeyboardEvent("keydown", { key });
      document.dispatchEvent(downEvent);
      const upEvent = new KeyboardEvent("keyup", { key });
      document.dispatchEvent(upEvent);

      // Then
      expect(keyDownHandler).toHaveBeenCalledTimes(1);
      expect(keyUpHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("cleanup", () => {
    it("should remove event listeners on unmount", () => {
      // Given
      const key = "a";
      const keyDownHandlers = { [key]: mockHandler };
      const { unmount } = setup({ global: true, keyDownHandlers });

      // When
      unmount();
      const event = new KeyboardEvent("keydown", { key });
      document.dispatchEvent(event);

      // Then
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });
});
