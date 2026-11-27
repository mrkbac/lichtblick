/** @jest-environment jsdom */

// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";

import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { CursorCoordinates } from "./MapToolbar";

describe("CursorCoordinates", () => {
  it("updates once per frame, adds the slope when the cursor rests, and copies from a button", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    let onMove: ((event: MapMouseEvent) => void) | undefined;
    const queryTerrainElevation = vi.fn(([lng]: [number, number]) => lng * 1000);
    const map = {
      on: (_type: string, listener: typeof onMove) => {
        onMove = listener;
      },
      off: vi.fn(),
      getTerrain: () => ({ exaggeration: 1 }),
      queryTerrainElevation,
    };
    render(
      <ThemeProvider isDark>
        <CursorCoordinates map={map as unknown as MapLibreMap} units="metric" />
      </ThemeProvider>,
    );

    act(() => {
      for (let i = 1; i <= 5; i++) {
        onMove!({ lngLat: { lng: i / 1000, lat: 0 } } as MapMouseEvent);
      }
      vi.advanceTimersToNextFrame();
    });
    // Five moves in one frame: one update with one elevation query, at the last position
    expect(queryTerrainElevation).toHaveBeenCalledTimes(1);
    const readout = screen.getByRole("button", { name: /0\.0050000/ });
    expect(readout.textContent).not.toMatch(/slope/);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    // Resting: four more queries for the slope
    expect(queryTerrainElevation).toHaveBeenCalledTimes(5);
    expect(readout.textContent).toMatch(/slope/);

    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    await act(async () => {
      fireEvent.click(readout);
    });
    expect(writeText).toHaveBeenCalledWith("0.0000000, 0.0050000");
  });
});
