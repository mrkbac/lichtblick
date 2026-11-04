/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import MockPanelContextProvider from "@lichtblick/suite-base/components/MockPanelContextProvider";
import { DiagnosticStatusConfig } from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import {
  DiagnosticsPanelData,
  useDiagnosticsPanelData,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticsPanelData";
import { DiagnosticsById } from "@lichtblick/suite-base/panels/DiagnosticSummary/types";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";
import DiagnosticsBuilder from "@lichtblick/suite-base/testing/builders/DiagnosticsBuilder";
import { BasicBuilder } from "@lichtblick/test-builders";

import DiagnosticStatusPanel from "./DiagnosticStatusPanel";

vi.mock("@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticsPanelData");

// Render every row; jsdom has no layout for the virtualizer to measure.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 26,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: 0 })),
    measureElement: () => {},
  }),
}));

function mockData(diagnostics: DiagnosticsById, subscribed = ["/diagnostics"]) {
  const data: DiagnosticsPanelData = {
    topics: { available: subscribed, selected: subscribed, subscribed },
    diagnostics,
    history: new Map(),
    staleSec: 5,
    range: undefined,
    seek: undefined,
  };
  (useDiagnosticsPanelData as vi.Mock).mockReturnValue(data);
}

describe("DiagnosticStatusPanel", () => {
  const setup = (config: DiagnosticStatusConfig = {}) =>
    render(
      <MockPanelContextProvider>
        <PanelSetup>
          <DiagnosticStatusPanel config={config} saveConfig={vi.fn()} />
        </PanelSetup>
      </MockPanelContextProvider>,
    );

  it("asks to select a node when nothing is selected", () => {
    mockData(new Map());
    setup();
    expect(screen.getByText(/No diagnostic node selected/i)).toBeInTheDocument();
  });

  it("explains when no diagnostics topic exists", () => {
    mockData(new Map(), []);
    setup();
    expect(screen.getByText(/No diagnostics topics available/i)).toBeInTheDocument();
  });

  it("waits for the selected node", () => {
    mockData(new Map());
    const selectedHardwareId = BasicBuilder.string();
    const selectedName = BasicBuilder.string();
    setup({ selectedHardwareId, selectedName });

    expect(screen.getByText(/Waiting for diagnostics from/i)).toBeInTheDocument();
    expect(screen.getByText(`${selectedHardwareId}: ${selectedName}`)).toBeInTheDocument();
  });

  it("renders all checks of the selected hardware id", () => {
    const hardwareId = BasicBuilder.string();
    const a = DiagnosticsBuilder.info({
      status: DiagnosticsBuilder.statusMessage({ hardware_id: hardwareId }),
    });
    const b = DiagnosticsBuilder.info({
      status: DiagnosticsBuilder.statusMessage({ hardware_id: hardwareId }),
    });
    const other = DiagnosticsBuilder.info();
    mockData(new Map([a, b, other].map((info) => [info.id, info])));

    setup({ selectedHardwareId: hardwareId });

    expect(screen.getByTestId("filtered-diagnostics")).toBeInTheDocument();
    expect(screen.getByText(a.status.message)).toBeInTheDocument();
    expect(screen.getByText(b.status.message)).toBeInTheDocument();
    expect(screen.queryByText(other.status.message)).not.toBeInTheDocument();
  });
});
