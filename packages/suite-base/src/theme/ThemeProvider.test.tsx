/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Dialog, Menu, darken } from "@mui/material";
import { render, waitFor } from "@testing-library/react";

import * as palette from "@lichtblick/theme/src/palette";

import ThemeProvider from "./ThemeProvider";

const themeColor = () =>
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content;

describe("ThemeProvider theme-color", () => {
  const appBar = palette.dark.appBar.main!;

  it("matches the app bar, dimmed while a dialog backdrop is shown", async () => {
    const { rerender } = render(<ThemeProvider isDark />);
    expect(themeColor()).toBe(appBar);

    rerender(
      <ThemeProvider isDark>
        <Menu open anchorEl={document.body} />
      </ThemeProvider>,
    );
    expect(themeColor()).toBe(appBar);

    rerender(
      <ThemeProvider isDark>
        <Dialog open transitionDuration={0} />
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(themeColor()).toBe(darken(appBar, 0.4));
    });

    rerender(<ThemeProvider isDark />);
    await waitFor(() => {
      expect(themeColor()).toBe(appBar);
    });
  });

  it("keeps the app bar color for a dialog that starts below the app bar", () => {
    const rect = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 44 } as DOMRect);
    // The dialog is in the DOM when the theme-color is first set.
    render(
      <ThemeProvider isDark>
        <Dialog open transitionDuration={0} />
      </ThemeProvider>,
    );
    expect(themeColor()).toBe(appBar);
    rect.mockRestore();
  });
});
