/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import {
  PanelDocs,
  PanelGuide,
  schemaDisplayNames,
  usePanelGuideStore,
} from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import PanelCatalogContext, { PanelInfo } from "@lichtblick/suite-base/context/PanelCatalogContext";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

function panel(type: string, docs: PanelDocs, extra: Partial<PanelInfo> = {}): PanelInfo {
  return {
    title: type,
    type,
    module: vi.fn(),
    docs: async () => ({ default: docs }),
    ...extra,
  };
}

const PANELS: PanelInfo[] = [
  panel("Grid", {
    intro: "Shows cameras.",
    schemas: ["sensor_msgs/Image", "sensor_msgs/msg/Image"],
  }),
  panel(
    "Scene",
    {
      intro: "Shows everything.",
      schemas: ["sensor_msgs/PointCloud2"],
      sections: [
        { title: "Mouse", items: [["Drag", "Pans.", () => <svg data-testid="drag-icon" />]] },
      ],
    },
    { shortcuts: [{ id: "s.reset", titleKey: "resetView", keys: [{ key: "r" }] }] },
  ),
  { title: "Extension", type: "Extension", module: vi.fn() },
];

function renderGuide() {
  const catalog = {
    getPanels: () => PANELS,
    getPanelByType: (type: string) => PANELS.find((info) => info.type === type),
  };
  render(
    <ThemeProvider isDark={false}>
      <PanelCatalogContext.Provider value={catalog}>
        <PanelGuide />
      </PanelCatalogContext.Provider>
    </ThemeProvider>,
  );
}

describe("schemaDisplayNames", () => {
  it("merges encoding variants of one schema", () => {
    expect(
      schemaDisplayNames([
        "sensor_msgs/NavSatFix",
        "sensor_msgs/msg/NavSatFix",
        "ros.sensor_msgs.NavSatFix",
        "foxglove_msgs/LocationFix",
        "foxglove::LocationFix",
        "foxglove.LocationFix",
      ]),
    ).toEqual(["foxglove.LocationFix", "sensor_msgs/NavSatFix"]);
  });
});

describe("PanelGuide", () => {
  beforeEach(() => {
    usePanelGuideStore.setState({ open: false, panelType: undefined });
  });

  it("renders nothing while closed", () => {
    renderGuide();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens at the requested panel with its schemas, sections, and shortcuts", async () => {
    renderGuide();
    act(() => {
      usePanelGuideStore.getState().show("Scene");
    });

    expect(await screen.findByText("Shows everything.")).toBeInTheDocument();
    expect(screen.getByText("sensor_msgs/PointCloud2")).toBeInTheDocument();
    expect(screen.getByText("Pans.")).toBeInTheDocument();
    expect(screen.getByTestId("drag-icon")).toBeInTheDocument();
    expect(screen.getByText("R")).toBeInTheDocument();
    // Panels without docs aren't listed.
    expect(screen.queryByRole("button", { name: "Extension" })).not.toBeInTheDocument();
  });

  it("finds panels by schema and switches between them", async () => {
    renderGuide();
    act(() => {
      usePanelGuideStore.getState().show("Scene");
    });
    await screen.findByText("Shows everything.");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "image" } });
    expect(screen.queryByRole("button", { name: "Scene" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(screen.getByText("Shows cameras.")).toBeInTheDocument();
    expect(screen.getByText("sensor_msgs/Image")).toBeInTheDocument();
  });
});
