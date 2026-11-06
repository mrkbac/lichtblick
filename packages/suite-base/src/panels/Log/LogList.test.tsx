/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import type { Mock } from "vitest";
import "@testing-library/jest-dom/vitest";

import MockPanelContextProvider from "@lichtblick/suite-base/components/MockPanelContextProvider";
import { useAppTimeFormat } from "@lichtblick/suite-base/hooks";
import { NormalizedLogMessage } from "@lichtblick/suite-base/panels/Log/types";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import LogList, { LogListApi, LogListProps } from "./LogList";

function createMockLogMessage(
  index: number,
  level: number,
  message?: string,
): NormalizedLogMessage {
  return {
    topic: "/log",
    receiveTime: { sec: 2000 + index, nsec: 0 },
    stamp: { sec: 1000 + index, nsec: 0 },
    level,
    message: message ?? `Test log message ${index}`,
  };
}

// Mock the hooks
vi.mock("@lichtblick/suite-base/hooks", () => ({
  useAppTimeFormat: vi.fn(),
}));

describe("LogList Component", () => {
  let originalClientHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    (useAppTimeFormat as Mock).mockReturnValue({
      timeFormat: "SEC",
      timeZone: "UTC",
    });
    // jsdom has no layout and the virtualizer renders no rows for a 0px tall scroll container
    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 12;
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    }
  });

  function setup(items: NormalizedLogMessage[] = [], extraProps: Partial<LogListProps> = {}) {
    const props: LogListProps = {
      items,
      ...extraProps,
    };

    const ui: React.ReactElement = (
      <ThemeProvider isDark>
        <MockPanelContextProvider>
          <LogList {...props} />
        </MockPanelContextProvider>
      </ThemeProvider>
    );

    return {
      ...render(ui),
      props,
      user: userEvent.setup(),
    };
  }

  it("should render the component correctly", () => {
    // Given / When
    setup();
    const virtualizedList = screen.getByTestId("virtualized-list");
    // Then
    expect(virtualizedList).toBeInTheDocument();
  });

  it("should handle empty items array", () => {
    // Given / When
    setup([]);
    const virtualizedList = screen.getByTestId("virtualized-list");
    // Then
    expect(virtualizedList).toBeInTheDocument();
  });

  it("should not display scroll-to-bottom button initially", () => {
    // Given / When
    setup();
    const scrollButton = screen.queryByTestId("scroll-to-bottom-button");
    // Then
    expect(scrollButton).not.toBeInTheDocument();
  });

  it("should display different log levels", () => {
    // Given / When
    // Create mock data with different log levels
    const mockItems: NormalizedLogMessage[] = [
      createMockLogMessage(0, 1, "Debug message"), // Debug level
      createMockLogMessage(1, 2, "Info message"), // Info level
      createMockLogMessage(2, 3, "Warning message"), // Warn level
      createMockLogMessage(3, 4, "Error message"), // Error level
      createMockLogMessage(4, 1, "Another debug"), // Another debug
    ];

    setup(mockItems);

    // Check that the virtualized list is rendered
    const virtualizedList = screen.getByTestId("virtualized-list");
    expect(virtualizedList).toBeInTheDocument();

    // Then
    // Verify log messages are displayed
    expect(virtualizedList.textContent).toContain("Debug message");
    expect(virtualizedList.textContent).toContain("Info message");
    expect(virtualizedList.textContent).toContain("Warning message");
    expect(virtualizedList.textContent).toContain("Error message");
    expect(virtualizedList.textContent).toContain("Another debug");

    // Verify log levels are displayed
    expect(virtualizedList.textContent).toContain("DEBUG");
    expect(virtualizedList.textContent).toContain("INFO");
    expect(virtualizedList.textContent).toContain("WARN");
    expect(virtualizedList.textContent).toContain("ERROR");
  });

  describe("scroll behavior", () => {
    function scrollTo(
      element: HTMLElement,
      {
        scrollTop,
        offsetHeight,
        scrollHeight,
      }: { scrollTop: number; offsetHeight: number; scrollHeight: number },
    ) {
      Object.defineProperty(element, "scrollTop", {
        configurable: true,
        value: scrollTop,
      });
      Object.defineProperty(element, "offsetHeight", {
        configurable: true,
        value: offsetHeight,
      });
      Object.defineProperty(element, "scrollHeight", {
        configurable: true,
        value: scrollHeight,
      });
      fireEvent.scroll(element);
    }

    it("shows scroll-to-bottom button when scrolled away from end", () => {
      const items = Array.from({ length: 5 }, (_, i) => createMockLogMessage(i, 2));
      setup(items);

      expect(screen.queryByTestId("scroll-to-bottom-button")).not.toBeInTheDocument();

      scrollTo(screen.getByTestId("scrollable-list"), {
        scrollTop: 10,
        offsetHeight: 100,
        scrollHeight: 1000,
      });

      expect(screen.getByTestId("scroll-to-bottom-button")).toBeInTheDocument();
    });

    it("hides scroll-to-bottom button when scrolled back to end", () => {
      const items = Array.from({ length: 5 }, (_, i) => createMockLogMessage(i, 2));
      setup(items);

      const list = screen.getByTestId("scrollable-list");

      scrollTo(list, { scrollTop: 10, offsetHeight: 100, scrollHeight: 1000 });
      expect(screen.getByTestId("scroll-to-bottom-button")).toBeInTheDocument();

      scrollTo(list, { scrollTop: 900, offsetHeight: 100, scrollHeight: 1000 });
      expect(screen.queryByTestId("scroll-to-bottom-button")).not.toBeInTheDocument();
    });

    it("clicking scroll-to-bottom button restores autoscroll and hides button", async () => {
      const items = Array.from({ length: 5 }, (_, i) => createMockLogMessage(i, 2));
      const { user } = setup(items);

      scrollTo(screen.getByTestId("scrollable-list"), {
        scrollTop: 10,
        offsetHeight: 100,
        scrollHeight: 1000,
      });

      const button = screen.getByTestId("scroll-to-bottom-button");
      expect(button).toBeInTheDocument();

      await user.click(button);

      expect(screen.queryByTestId("scroll-to-bottom-button")).not.toBeInTheDocument();
    });
  });

  describe("scroll api", () => {
    const items = Array.from({ length: 5 }, (_, i) => createMockLogMessage(i, 2));

    it("stops following on scrollToIndex and resumes on follow", () => {
      const apiRef = createRef<LogListApi>();
      setup(items, { apiRef });

      act(() => {
        apiRef.current!.scrollToIndex(0);
      });
      expect(screen.getByTestId("scroll-to-bottom-button")).toBeInTheDocument();

      act(() => {
        apiRef.current!.follow();
      });
      expect(screen.queryByTestId("scroll-to-bottom-button")).not.toBeInTheDocument();
    });

    it("does not take its own scrolling to the playhead as user input", () => {
      // 14px rows in a 12px viewport, and scrollTo moves scrollTop like a browser would
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
        height: 14,
      } as DOMRect);
      vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(70);
      const scrollTo = vi.fn(function (this: Element, options: ScrollToOptions) {
        Object.defineProperty(this, "scrollTop", { configurable: true, value: options.top });
      });
      Object.defineProperty(Element.prototype, "scrollTo", { configurable: true, value: scrollTo });

      try {
        // The playhead is on row 1, so following scrolls away from the end
        setup(items, { currentTime: { sec: 2001, nsec: 0 } });
        expect(scrollTo).toHaveBeenCalled();

        fireEvent.scroll(screen.getByTestId("scrollable-list"));

        expect(screen.queryByTestId("scroll-to-bottom-button")).not.toBeInTheDocument();
      } finally {
        delete (Element.prototype as Partial<Element>).scrollTo;
        vi.restoreAllMocks();
      }
    });
  });

  describe("playhead and row actions", () => {
    const items = Array.from({ length: 5 }, (_, i) => createMockLogMessage(i, 2));

    it("seeks to the receive time of a clicked row", async () => {
      const onSeek = vi.fn();
      const { user } = setup(items, {
        onSeek,
        currentTime: { sec: 2000, nsec: 0 },
      });

      await user.click(screen.getByText("Test log message 3"));

      expect(onSeek).toHaveBeenCalledWith({ sec: 2003, nsec: 0 });
    });

    it("copies a row without seeking", async () => {
      const onSeek = vi.fn();
      const onCopy = vi.fn();
      const { user } = setup(items, { onSeek, onCopy });

      await user.click(screen.getAllByLabelText("Copy log message")[1]!);

      expect(onCopy).toHaveBeenCalledWith(items[1]);
      expect(onSeek).not.toHaveBeenCalled();
    });

    it("marks the row at the playhead and dims later rows", () => {
      setup(items, {
        onSeek: vi.fn(),
        currentTime: { sec: 2002, nsec: 500 },
      });

      const row = (text: string) => screen.getByText(text).closest("[aria-posinset]")!.firstChild!;
      const style = (text: string) => getComputedStyle(row(text) as Element);

      expect(style("Test log message 2").opacity).not.toBe("0.5");
      expect(style("Test log message 3").opacity).toBe("0.5");
      expect(style("Test log message 1").opacity).not.toBe("0.5");
    });
  });
});
