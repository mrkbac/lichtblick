/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import DiagnosticSummary from "@lichtblick/suite-base/panels/DiagnosticSummary";
import { DEFAULT_CONFIG, LEVELS } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import {
  DiagnosticsPanelData,
  useDiagnosticsPanelData,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticsPanelData";
import {
  DiagnosticsById,
  DiagnosticSummaryConfig,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/types";
import { getDiagnosticId } from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/util";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";
import DiagnosticsBuilder from "@lichtblick/suite-base/testing/builders/DiagnosticsBuilder";

vi.mock("@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticsPanelData");

vi.mock("react-virtualized-auto-sizer", () => ({
  __esModule: true,
  default: ({
    children,
  }: {
    children: (size: { height: number; width: number }) => React.JSX.Element;
  }) => children({ height: 500, width: 500 }),
}));

function mockData(data: Partial<DiagnosticsPanelData>) {
  const subscribed = ["/diagnostics"];
  (useDiagnosticsPanelData as vi.Mock).mockReturnValue({
    topics: { available: subscribed, selected: subscribed, subscribed },
    diagnostics: new Map(),
    history: new Map(),
    staleSec: 5,
    range: undefined,
    seek: undefined,
    ...data,
  });
}

const info = (hardwareId: string, name: string, level: number = LEVELS.OK) =>
  DiagnosticsBuilder.info({
    id: getDiagnosticId(hardwareId, name),
    displayName: `${hardwareId}: ${name}`,
    status: DiagnosticsBuilder.statusMessage({ hardware_id: hardwareId, name, level }),
  });

const byId = (...infos: ReturnType<typeof info>[]): DiagnosticsById =>
  new Map(infos.map((i) => [i.id, i]));

describe("DiagnosticSummary", () => {
  function setup(config: Partial<DiagnosticSummaryConfig> = {}) {
    return render(
      <div style={{ width: 800, height: 500 }}>
        <PanelSetup>
          <DiagnosticSummary overrideConfig={{ ...DEFAULT_CONFIG, ...config }} />
        </PanelSetup>
      </div>,
    );
  }

  it("waits for messages", () => {
    mockData({});
    setup();
    expect(screen.getByText(/Waiting for diagnostics/i)).toBeInTheDocument();
  });

  it("explains when no diagnostics topic exists", () => {
    mockData({ topics: { available: [], selected: [], subscribed: [] } });
    setup();
    expect(screen.getByText(/No diagnostics topics available/i)).toBeInTheDocument();
  });

  it("renders pinned items first, even when the name contains '|'", () => {
    const pinned = info("motor", "temp | left");
    const other = info("camera", "fps");
    mockData({ diagnostics: byId(other, pinned) });

    setup({ pinnedIds: [pinned.id] });

    expect(screen.getByTestId("diagnostic-summary-node-row-0")).toHaveTextContent(
      pinned.displayName,
    );
    expect(screen.getByTestId("diagnostic-summary-node-row-1")).toHaveTextContent(
      other.displayName,
    );
  });

  it("sorts by level, worst first, and filters by min level", () => {
    const ok = info("a", "ok", LEVELS.OK);
    const error = info("b", "error", LEVELS.ERROR);
    const warn = info("c", "warn", LEVELS.WARN);
    mockData({ diagnostics: byId(ok, error, warn) });

    setup({ minLevel: LEVELS.WARN });

    expect(screen.getByTestId("diagnostic-summary-node-row-0")).toHaveTextContent(
      error.displayName,
    );
    expect(screen.getByTestId("diagnostic-summary-node-row-1")).toHaveTextContent(warn.displayName);
    expect(screen.queryByTestId("diagnostic-summary-node-row-2")).not.toBeInTheDocument();
  });

  it("shows how long a check has been in its level and its timeline", () => {
    const error = info("b", "error", LEVELS.ERROR);
    mockData({
      diagnostics: byId(error),
      history: new Map([
        [
          error.id,
          {
            changes: [
              { t: 0, level: LEVELS.OK },
              { t: 10, level: LEVELS.ERROR },
            ],
            lastSeen: 70,
          },
        ],
      ]),
      range: { start: 0, end: 100, current: 72 },
    });

    setup();

    expect(screen.getByTestId("diagnostic-row-level-since")).toHaveTextContent("1m 02s");
    expect(screen.getByTestId("diagnostic-timeline")).toBeInTheDocument();
  });
});
