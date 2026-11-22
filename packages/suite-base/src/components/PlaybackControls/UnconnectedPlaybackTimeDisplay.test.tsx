/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";

import { IAppTimeFormat } from "@lichtblick/suite-base/hooks/useAppTimeFormat";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import clipboard from "@lichtblick/suite-base/util/clipboard";

import {
  UnconnectedPlaybackTimeDisplay,
  formatElapsed,
  formatIsoUtc,
} from "./UnconnectedPlaybackTimeDisplay";

const appTimeFormat: IAppTimeFormat = {
  formatDate: () => "",
  formatTime: () => "",
  formatDuration: () => "",
  timeFormat: "SEC",
  setTimeFormat: async () => {},
  timeZone: undefined,
};

describe("UnconnectedPlaybackTimeDisplay", () => {
  it("sizes the input to the displayed text, including while editing", () => {
    render(
      <ThemeProvider isDark={false}>
        <UnconnectedPlaybackTimeDisplay
          appTimeFormat={appTimeFormat}
          currentTime={{ sec: 1, nsec: 0 }}
          onSeek={() => {}}
          onPause={() => {}}
          isPlaying={false}
        />
      </ThemeProvider>,
    );
    const input = screen.getByRole<HTMLInputElement>("textbox");
    expect(input.size).toBe(input.value.length);

    fireEvent.focus(input);
    const edited = "2025-06-12 10:50:40.599 AM Europe/Berlin";
    fireEvent.change(input, { target: { value: edited } });
    expect(input.size).toBe(edited.length);
  });
});

describe("formatIsoUtc", () => {
  it("keeps nanosecond precision", () => {
    expect(formatIsoUtc({ sec: 1_749_718_240, nsec: 599_000_001 })).toBe(
      "2025-06-12T08:50:40.599000001Z",
    );
  });
});

describe("formatElapsed", () => {
  it("keeps nanoseconds", () => {
    expect(formatElapsed({ sec: 0, nsec: 5 })).toBe("0:00:00.000000005");
    expect(formatElapsed({ sec: 3723, nsec: 400_000_000 })).toBe("1:02:03.400000000");
  });
});

describe("blur", () => {
  it("does not seek when the time was not edited", () => {
    const onSeek = vi.fn();
    const ui = (currentTime: { sec: number; nsec: number }) => (
      <ThemeProvider isDark={false}>
        <UnconnectedPlaybackTimeDisplay
          appTimeFormat={appTimeFormat}
          startTime={{ sec: 1, nsec: 0 }}
          currentTime={currentTime}
          endTime={{ sec: 3, nsec: 0 }}
          onSeek={onSeek}
          onPause={() => {}}
          isPlaying={false}
        />
      </ThemeProvider>
    );
    const { rerender } = render(ui({ sec: 2, nsec: 5 }));
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onSeek).not.toHaveBeenCalled();

    // The time moving while focused must not make blur seek back to the focus-time text
    fireEvent.focus(input);
    rerender(ui({ sec: 2, nsec: 700_000_000 }));
    fireEvent.blur(input);
    expect(onSeek).not.toHaveBeenCalled();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.blur(input);
    expect(onSeek).toHaveBeenCalledWith({ sec: 2, nsec: 500_000_000 });

    vi.useFakeTimers();
    try {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "invalid" } });
      fireEvent.blur(input);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(input.getAttribute("aria-invalid")).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("time format menu", () => {
  function renderOpenMenu(setTimeFormat = vi.fn(async () => {})) {
    render(
      <ThemeProvider isDark={false}>
        <UnconnectedPlaybackTimeDisplay
          appTimeFormat={{ ...appTimeFormat, setTimeFormat }}
          startTime={{ sec: 1, nsec: 0 }}
          currentTime={{ sec: 2, nsec: 5 }}
          endTime={{ sec: 3, nsec: 0 }}
          onSeek={() => {}}
          onPause={() => {}}
          isPlaying={false}
        />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId("playback-time-display-toggle-button"));
    return setTimeFormat;
  }

  it("lists copy-only formats with a copy button each", () => {
    renderOpenMenu();
    expect(screen.getByLabelText("Copy current time")).toBeTruthy();
    expect(screen.getByText("2000000005")).toBeTruthy();
    expect(screen.getByText("0:00:01.000000005")).toBeTruthy();
    expect(screen.getByLabelText("Copy Nanoseconds")).toBeTruthy();
  });

  it("copies a row without selecting it or closing the menu", async () => {
    const copy = vi.spyOn(clipboard, "copy").mockResolvedValue();
    const setTimeFormat = renderOpenMenu();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Copy Seconds"));
    });
    expect(copy).toHaveBeenLastCalledWith("2.000000005");

    // Copy-only rows copy on activation, which keyboard users reach with Enter.
    await act(async () => {
      fireEvent.click(screen.getByTestId("playback-time-display-option-NS"));
    });
    expect(copy).toHaveBeenLastCalledWith("2000000005");
    expect(screen.getByText("Copied")).toBeTruthy();

    // Ctrl/Cmd+C copies the focused row, including the selectable ones.
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("playback-time-display-option-SEC"), {
        key: "c",
        ctrlKey: true,
      });
    });
    expect(copy).toHaveBeenLastCalledWith("2.000000005");

    expect(setTimeFormat).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});
