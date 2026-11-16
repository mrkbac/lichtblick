/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Mock } from "vitest";
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
      buttons: [
        { id: "logCopy", icon: () => <svg data-testid="copy-icon" />, placement: "toolbar" },
      ],
      settings: () => ({
        general: {
          label: "View",
          actions: [
            { type: "action", id: "reset", label: "Reset view", help: "Restores the defaults." },
            { type: "action", id: "silent", label: "Undocumented" },
          ],
          fields: { size: { input: "number", label: "Size", help: "Point size in pixels." } },
        },
      }),
      sections: [{ title: "Data", items: [["Paths", "Any numeric field."]] }],
    },
    {
      shortcuts: [
        {
          id: "s.reset",
          titleKey: "resetView",
          keys: [{ key: "r" }],
          mouse: [{ action: "drag", button: "right" }],
        },
      ],
    },
  ),
  { title: "Extension", type: "Extension", module: vi.fn() },
];

function renderGuide(panels = PANELS) {
  const catalog = {
    getPanels: () => panels,
    getPanelByType: (type: string) => panels.find((info) => info.type === type),
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

  it("opens at the requested panel with its generated buttons, settings, and input", async () => {
    renderGuide();
    act(() => {
      usePanelGuideStore.getState().show("Scene");
    });

    expect(await screen.findByText("Shows everything.")).toBeInTheDocument();
    expect(screen.getByText("sensor_msgs/PointCloud2")).toBeInTheDocument();
    // Buttons: icon from the declaration, title and help from panelButtons.
    expect(screen.getByTestId("copy-icon")).toBeInTheDocument();
    expect(screen.getByText("Copies all messages that pass the filters.")).toBeInTheDocument();
    // Settings: from the builder, under the node's label.
    expect(screen.getByRole("heading", { name: "View" })).toBeInTheDocument();
    expect(screen.getByText("Point size in pixels.")).toBeInTheDocument();
    expect(screen.getByText("Restores the defaults.")).toBeInTheDocument();
    expect(screen.queryByText("Undocumented")).not.toBeInTheDocument();
    expect(screen.getByText("Any numeric field.")).toBeInTheDocument();
    // Keyboard and mouse: keys and gestures of one declaration.
    expect(screen.getByText("R")).toBeInTheDocument();
    expect(screen.getByText("Right-drag")).toBeInTheDocument();
    // Hand-written facts first, then the generated sections, schemas last.
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(["Data", "Buttons", "Settings", "Keyboard and mouse", "Supported schemas"]);
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

  it("skips a panel whose docs fail to load and still shows the others", async () => {
    const broken: PanelInfo = {
      title: "Broken",
      type: "Broken",
      module: vi.fn(),
      docs: async () => await Promise.reject(new Error("chunk failed")),
    };
    renderGuide([...PANELS, broken]);
    act(() => {
      usePanelGuideStore.getState().show("Scene");
    });

    expect(await screen.findByText("Shows everything.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Broken" })).not.toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
    (console.error as Mock).mockClear();
  });
});
