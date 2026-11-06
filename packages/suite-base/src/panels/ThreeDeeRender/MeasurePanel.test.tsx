/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import type { IRenderer } from "./IRenderer";
import { MeasurePanel } from "./MeasurePanel";
import type { MeasurementInfo } from "./renderables/MeasurementTool";

function renderPanel({ unavailable }: { unavailable: boolean }) {
  const info: MeasurementInfo = {
    id: 1,
    kind: "distance",
    summary: {
      label: unavailable ? "— (missing transform base)" : "5.000 m",
      segmentLabels: [],
      details: [],
    },
    complete: true,
    unavailable,
  };
  const renderer = {
    measurementTool: {
      kind: "distance",
      measurements: [info],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    transformTree: { frameList: () => [] },
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as IRenderer;
  render(
    <ThemeProvider isDark>
      <MeasurePanel renderer={renderer} />
    </ThemeProvider>,
  );
}

describe("MeasurePanel", () => {
  it.each([true, false])("copy is disabled iff unavailable=%s", (unavailable) => {
    renderPanel({ unavailable });
    expect(screen.getByRole("button", { name: "Copy" })).toHaveProperty("disabled", unavailable);
    expect(screen.getByRole("button", { name: "Copy all" })).toHaveProperty(
      "disabled",
      unavailable,
    );
  });
});
