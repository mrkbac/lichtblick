/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Button, Dialog, Menu, darken } from "@mui/material";
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
    const rect = vi
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

it("styles a panel document without changing the opener's theme", () => {
  // Given
  const previousColorMode = document.documentElement.dataset.colorMode;
  document.documentElement.dataset.colorMode = "light";
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const child = iframe.contentDocument!;
  try {
    // When
    const view = render(
      <ThemeProvider isDark ownerDocument={child}>
        <Button>Child control</Button>
      </ThemeProvider>,
      { container: child.body },
    );
    // Then
    expect(child.documentElement.dataset.colorMode).toBe("dark");
    expect(document.documentElement.dataset.colorMode).toBe("light");
    expect(child.head.querySelector("style[data-emotion]")).not.toBeNull();
    view.unmount();
  } finally {
    if (previousColorMode == undefined) {
      delete document.documentElement.dataset.colorMode;
    } else {
      document.documentElement.dataset.colorMode = previousColorMode;
    }
    iframe.remove();
  }
});

it("updates a child document's PWA color and color mode without changing the opener", async () => {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const child = iframe.contentDocument!;
  const parentColor = themeColor();
  const { rerender, unmount } = render(<ThemeProvider isDark ownerDocument={child} />);
  expect(child.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
    palette.dark.appBar.main,
  );
  rerender(<ThemeProvider isDark={false} ownerDocument={child} />);
  await waitFor(() => {
    expect(child.documentElement.dataset.colorMode).toBe("light");
  });
  expect(child.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
    palette.light.appBar.main,
  );
  expect(themeColor()).toBe(parentColor);
  unmount();
  iframe.remove();
});
