/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";

import { IAppTimeFormat } from "@lichtblick/suite-base/hooks/useAppTimeFormat";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { UnconnectedPlaybackTimeDisplay, formatIsoUtc } from "./UnconnectedPlaybackTimeDisplay";

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

describe("time format menu", () => {
  it("lists copy-only formats with a copy button each", () => {
    render(
      <ThemeProvider isDark={false}>
        <UnconnectedPlaybackTimeDisplay
          appTimeFormat={appTimeFormat}
          startTime={{ sec: 1, nsec: 0 }}
          currentTime={{ sec: 2, nsec: 5 }}
          endTime={{ sec: 3, nsec: 0 }}
          onSeek={() => {}}
          onPause={() => {}}
          isPlaying={false}
        />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText("Copy current time")).toBeTruthy();
    fireEvent.click(screen.getByTestId("playback-time-display-toggle-button"));
    expect(screen.getByText("2000000005")).toBeTruthy();
    expect(screen.getByText("0:00:01.000")).toBeTruthy();
    expect(screen.getByLabelText("Copy Nanoseconds")).toBeTruthy();
  });
});
