/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Chart } from "chart.js";

vi.mock("chart.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Chart: { register: vi.fn() },
}));
vi.mock("@foxglove/comlink", () => ({ expose: vi.fn(), proxy: vi.fn() }));
vi.mock("@lichtblick/suite-base/panels/shared/loadFont", () => ({
  loadDefaultFont: vi.fn(async () => undefined),
}));
vi.mock("./ChartRenderer", () => ({ ChartRenderer: vi.fn() }));

describe("ChartRenderer.worker", () => {
  it("registers the Chart.js components the plot needs", async () => {
    await import("./ChartRenderer.worker");

    expect(Chart.register).toHaveBeenCalled();
  });
});
