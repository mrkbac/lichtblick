// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { isSelfDrop } from "./index";

describe("isSelfDrop", () => {
  const fromPlotA = { lichtblickSourcePanelId: "plot-a" };

  it("rejects a drop onto the panel the drag started in", () => {
    expect(isSelfDrop(fromPlotA, "plot-a")).toBe(true);
  });

  it("allows drops onto other panels", () => {
    expect(isSelfDrop(fromPlotA, "plot-b")).toBe(false);
    expect(isSelfDrop(fromPlotA, undefined)).toBe(false);
  });

  it("allows drags that don't come from a panel", () => {
    expect(isSelfDrop({}, "plot-a")).toBe(false);
    expect(isSelfDrop({}, undefined)).toBe(false);
  });
});
