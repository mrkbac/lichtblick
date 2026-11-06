/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";

import { IAppTimeFormat } from "@lichtblick/suite-base/hooks/useAppTimeFormat";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { UnconnectedPlaybackTimeDisplay } from "./UnconnectedPlaybackTimeDisplay";

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
