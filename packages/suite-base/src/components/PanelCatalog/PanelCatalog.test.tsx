/** @jest-environment jsdom */

// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom/vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PanelCatalogContext, {
  PanelCatalog as PanelCatalogType,
  PanelInfo,
} from "@lichtblick/suite-base/context/PanelCatalogContext";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { PanelCatalog } from "./PanelCatalog";

const panel = (title: string, extra: Partial<PanelInfo> = {}): PanelInfo => ({
  title,
  type: title,
  module: vi.fn(),
  ...extra,
});
const panels = [
  panel("Audio"),
  panel("Log", {
    openIn: { kind: "topic" },
    docs: async () => await Promise.resolve({ default: { intro: "", schemas: ["pkg/Log"] } }),
  }),
  panel("Plot"),
];
const catalog = {
  getPanels: () => panels,
  getPanelByType: (type: string) => panels.find((p) => p.type === type),
} as unknown as PanelCatalogType;

function renderCatalog(
  topics: { name: string; schemaName: string }[],
  onPanelSelect: (selection: { type: string }) => void = vi.fn(),
  value: PanelCatalogType = catalog,
) {
  return render(
    <ThemeProvider isDark={false}>
      <PanelCatalogContext.Provider value={value}>
        <PanelCatalog onPanelSelect={onPanelSelect} topics={topics} />
      </PanelCatalogContext.Provider>
    </ThemeProvider>,
  );
}

const itemTitles = () => screen.getAllByTestId(/^panel-menu-item /).map((item) => item.textContent);

describe("PanelCatalog suggestions", () => {
  it("lists panels for the data's schemas first, with their topic count", async () => {
    renderCatalog([
      { name: "/log", schemaName: "pkg/Log" },
      { name: "/other", schemaName: "pkg/Other" },
    ]);

    expect(await screen.findByText("Suggested for this data")).toBeInTheDocument();
    expect(itemTitles()).toEqual(["Log", "Audio", "Plot"]);
    const log = screen.getByTestId("panel-menu-item Log").closest("li")!;
    expect(within(log).getByText("1 topic")).toBeInTheDocument();
  });

  it("shows no suggestions while searching", async () => {
    renderCatalog([{ name: "/log", schemaName: "pkg/Log" }]);
    await screen.findByText("Suggested for this data");

    await userEvent.type(screen.getByPlaceholderText("Search panels"), "o");

    expect(screen.queryByText("Suggested for this data")).toBeNull();
  });

  it("shows no suggestions without matching topics", async () => {
    renderCatalog([{ name: "/other", schemaName: "pkg/Other" }]);
    // Let the panels' schemas load
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText("Suggested for this data")).toBeNull();
    expect(itemTitles()).toEqual(["Audio", "Log", "Plot"]);
  });

  it("keeps the highlighted panel when suggestions load and reorder the list", async () => {
    // Fresh panels whose schemas load only when released (loaded schemas are cached per panel)
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowPanels = [
      panel("Audio"),
      panel("Log", {
        openIn: { kind: "topic" },
        docs: async () => {
          await gate;
          return { default: { intro: "", schemas: ["pkg/Log"] } };
        },
      }),
    ];
    const slowCatalog = {
      getPanels: () => slowPanels,
      getPanelByType: (type: string) => slowPanels.find((p) => p.type === type),
    } as unknown as PanelCatalogType;
    const onPanelSelect = vi.fn();
    renderCatalog([{ name: "/log", schemaName: "pkg/Log" }], onPanelSelect, slowCatalog);
    const search = screen.getByPlaceholderText("Search panels");

    // Highlight the first panel (Audio) before the suggestions move Log to the top
    await userEvent.type(search, "{ArrowDown}");
    release();
    await screen.findByText("Suggested for this data");
    await userEvent.type(search, "{Enter}");

    expect(onPanelSelect).toHaveBeenCalledWith(expect.objectContaining({ type: "Audio" }));
  });
});
