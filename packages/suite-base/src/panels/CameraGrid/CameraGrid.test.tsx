/** @jest-environment jsdom */

// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";

import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { Tile } from "./CameraGrid";
import { GridRenderer } from "./GridRenderer";
import { makeTile } from "./types";

describe("CameraGrid tile", () => {
  it("is focusable and maximizes, zooms and pans from the keyboard", () => {
    const renderer = {
      attach: vi.fn(),
      detach: vi.fn(),
      setTileConfig: vi.fn(),
      zoomAt: vi.fn(),
      panBy: vi.fn(),
      resetView: vi.fn(() => false),
      isZoomed: vi.fn(() => false),
    };
    const onToggleMaximize = vi.fn();
    render(
      <ThemeProvider isDark>
        <Tile
          tile={makeTile("/camera")}
          renderer={renderer as unknown as GridRenderer}
          showLabels
          showTimestamps={false}
          maximized={false}
          onToggleMaximize={onToggleMaximize}
        />
      </ThemeProvider>,
    );
    const tile = screen.getByRole("button", { name: "/camera" });
    expect(tile.tabIndex).toBe(0);

    fireEvent.keyDown(tile, { key: "Enter" });
    expect(onToggleMaximize).toHaveBeenCalledWith("/camera");

    fireEvent.keyDown(tile, { key: "+" });
    fireEvent.keyDown(tile, { key: "-" });
    expect(renderer.zoomAt.mock.calls.map(([, factor]) => factor)).toEqual([1.25, 0.8]);

    fireEvent.keyDown(tile, { key: "ArrowRight" });
    expect(renderer.panBy).toHaveBeenCalledWith("/camera", -40, -0);

    // Unbound keys (e.g. Escape for the panel) bubble on
    const escape = fireEvent.keyDown(tile, { key: "Escape" });
    expect(escape).toBe(true);
  });
});
