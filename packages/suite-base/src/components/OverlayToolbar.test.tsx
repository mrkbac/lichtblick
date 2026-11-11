/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { IconButton, Tooltip } from "@mui/material";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import OverlayToolbar from "./OverlayToolbar";

it.each([false, true])("keeps floating controls consistent (dark: %s)", (isDark) => {
  const onClick = vi.fn();
  const { rerender } = render(
    <ThemeProvider isDark={isDark}>
      <OverlayToolbar data-testid="toolbar">
        <IconButton aria-label="Camera" aria-pressed={true} onClick={onClick}>
          3D
        </IconButton>
        <Tooltip title="Unavailable">
          <span>
            <IconButton aria-label="Unavailable" disabled>
              <svg width="20" height="20" />
            </IconButton>
          </span>
        </Tooltip>
      </OverlayToolbar>
    </ThemeProvider>,
  );
  const camera = screen.getByRole("button", { name: "Camera" });
  const unavailable = screen.getByRole("button", { name: "Unavailable" });
  expect(camera).toHaveStyle({ width: "32px", height: "32px" });
  expect(unavailable).toHaveStyle({ width: "32px", height: "32px" });
  expect(unavailable).toBeDisabled();
  expect(screen.getByTestId("toolbar")).toHaveStyle({ pointerEvents: "auto" });
  fireEvent.click(camera);
  expect(onClick).toHaveBeenCalledTimes(1);
  const activeBackground = getComputedStyle(camera).backgroundColor;
  rerender(
    <ThemeProvider isDark={isDark}>
      <OverlayToolbar>
        <IconButton aria-label="Camera" aria-pressed={false}>
          3D
        </IconButton>
      </OverlayToolbar>
    </ThemeProvider>,
  );
  expect(getComputedStyle(screen.getByRole("button", { name: "Camera" })).backgroundColor).not.toBe(
    activeBackground,
  );
});
