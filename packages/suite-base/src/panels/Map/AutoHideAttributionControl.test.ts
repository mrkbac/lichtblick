/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Map as MapLibreMap } from "maplibre-gl";

import { AutoHideAttributionControl } from "./AutoHideAttributionControl";
import { ATTRIBUTION_AUTO_HIDE_MS } from "./layers";

describe("AutoHideAttributionControl", () => {
  let control: AutoHideAttributionControl | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    control?.onRemove();
    vi.useRealTimers();
  });

  it("collapses the expanded attribution after the auto-hide delay", () => {
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      getCanvasContainer: () => ({ offsetWidth: 800 }),
      _getUIString: () => "",
    } as unknown as MapLibreMap;
    control = new AutoHideAttributionControl();
    const container = control.onAdd(map);

    expect(container.classList.contains("maplibregl-compact-show")).toBe(true);
    vi.advanceTimersByTime(ATTRIBUTION_AUTO_HIDE_MS - 1);
    expect(container.classList.contains("maplibregl-compact-show")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(container.classList.contains("maplibregl-compact-show")).toBe(false);
  });
});
