/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import type { Mock } from "vitest";

import { MessagePipelineProvider } from "@lichtblick/suite-base/components/MessagePipeline";
import Panel from "@lichtblick/suite-base/components/Panel";
import AppConfigurationContext from "@lichtblick/suite-base/context/AppConfigurationContext";
import PanelCatalogContext, {
  PanelCatalog,
  PanelInfo,
} from "@lichtblick/suite-base/context/PanelCatalogContext";
import MockCurrentLayoutProvider from "@lichtblick/suite-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import ExtensionCatalogProvider from "@lichtblick/suite-base/providers/ExtensionCatalogProvider/ExtensionCatalogProvider";
import { PanelStateContextProvider } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import WorkspaceContextProvider from "@lichtblick/suite-base/providers/WorkspaceContextProvider";
import { LayoutNode } from "@lichtblick/suite-base/types/layouts";
import { getPanelIds } from "@lichtblick/suite-base/util/layoutTree";
import { makeMockAppConfiguration } from "@lichtblick/suite-base/util/makeMockAppConfiguration";
import * as containerSize from "@lichtblick/suite-base/util/observeContainerSize";

import { UnconnectedPanelLayout } from "./PanelLayout";

class MockPanelCatalog implements PanelCatalog {
  public constructor(private allPanels: PanelInfo[]) {}
  public getPanels(): readonly PanelInfo[] {
    return this.allPanels;
  }
  public getPanelByType(type: string): PanelInfo | undefined {
    return this.allPanels.find((panel) => !panel.config && panel.type === type);
  }
}

/** Provide the real layout contexts with a small panel catalog. */
function wrapperFor(panelCatalog: PanelCatalog) {
  return function Wrapper({ children }: React.PropsWithChildren) {
    const [config] = useState(() => makeMockAppConfiguration());

    return (
      <WorkspaceContextProvider>
        <AppConfigurationContext.Provider value={config}>
          <MockCurrentLayoutProvider>
            <MessagePipelineProvider>
              <PanelStateContextProvider>
                <ExtensionCatalogProvider loaders={[]}>
                  <PanelCatalogContext.Provider value={panelCatalog}>
                    {children}
                  </PanelCatalogContext.Provider>
                </ExtensionCatalogProvider>
              </PanelStateContextProvider>
            </MessagePipelineProvider>
          </MockCurrentLayoutProvider>
        </AppConfigurationContext.Provider>
      </WorkspaceContextProvider>
    );
  };
}

describe("UnconnectedPanelLayout", () => {
  beforeEach(() => {
    // jsdom can't parse our @container CSS so we have to silence console.error for this test.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as Mock).mockRestore();
  });

  it("observes the replacement Dockview after dismissing a layout error", async () => {
    // Given
    const cleanup = vi.fn();
    const observe = vi.spyOn(containerSize, "observeContainerSize").mockReturnValue(cleanup);
    const catalog = new MockPanelCatalog([
      {
        type: "recover",
        title: "Recover",
        module: async () => ({
          default: Panel(
            Object.assign(() => <div>Recovered panel</div>, {
              panelType: "recover",
              defaultConfig: {},
            }),
          ),
        }),
      },
    ]);
    let crash = false;
    function LoadingComponent() {
      if (crash) {
        throw new Error("Layout error for recovery test");
      }
      return <></>;
    }
    const props = { layout: { panels: ["recover"] }, onChange: vi.fn() };
    const { rerender, unmount } = render(
      <UnconnectedPanelLayout {...props} loadingComponent={<LoadingComponent />} />,
      { wrapper: wrapperFor(catalog) },
    );
    await screen.findByText("Recovered panel");
    expect(observe).toHaveBeenCalledTimes(1);
    const first = observe.mock.calls[0]!;

    // When
    crash = true;
    rerender(<UnconnectedPanelLayout {...props} loadingComponent={<LoadingComponent />} />);
    const dismiss = await screen.findByRole("button", { name: "Dismiss" });
    expect(cleanup).toHaveBeenCalledTimes(1);
    crash = false;
    fireEvent.click(dismiss);

    // Then
    await screen.findByText("Recovered panel");
    expect(observe).toHaveBeenCalledTimes(2);
    expect(observe.mock.calls[1]![0]).not.toBe(first[0]);
    expect(observe.mock.calls[1]![1]).not.toBe(first[1]);
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("does not remount panels when the layout changes", async () => {
    // vi.spyOn(console, "error").mockImplementation(() => undefined);

    const mountA = vi.fn();
    const unmountA = vi.fn();
    const renderA = vi.fn(function StatefulPanel() {
      const [value, setValue] = useState("");
      useEffect(() => {
        mountA();
        return unmountA;
      }, []);
      return (
        <input
          aria-label="Panel A state"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      );
    });
    const moduleA = vi.fn().mockResolvedValue({
      default: Panel(Object.assign(renderA, { panelType: "a", defaultConfig: {} })),
    });

    const renderB = vi.fn().mockReturnValue(<>B</>);
    const moduleB = vi.fn().mockResolvedValue({
      default: Panel(Object.assign(renderB, { panelType: "b", defaultConfig: {} })),
    });

    const renderC = vi.fn().mockReturnValue(<>C</>);
    const moduleC = vi.fn().mockResolvedValue({
      default: Panel(Object.assign(renderC, { panelType: "c", defaultConfig: {} })),
    });

    const panels: PanelInfo[] = [
      { title: "A", type: "a", module: moduleA },
      { title: "B", type: "b", module: moduleB },
      { title: "C", type: "c", module: moduleC },
    ];

    const panelCatalog = new MockPanelCatalog(panels);

    // Dockview may report adjusted split sizes back (the test container is tiny)
    const onChange = vi.fn<(layout: LayoutNode | undefined) => void>();
    const { rerender, unmount } = render(
      <UnconnectedPanelLayout
        layout={{
          direction: "row",
          children: [{ panels: ["a"] }, { panels: ["b"] }],
          sizes: [50, 50],
        }}
        onChange={onChange}
      />,
      {
        wrapper: wrapperFor(panelCatalog),
      },
    );

    await waitFor(() => {
      expect(renderA).toHaveBeenCalled();
    });
    // Each panel module should have only been loaded once
    expect(moduleA).toHaveBeenCalledTimes(1);
    expect(moduleB).toHaveBeenCalledTimes(1);
    expect(moduleC).toHaveBeenCalledTimes(0);
    expect(renderC).toHaveBeenCalledTimes(0);
    const input = await screen.findByRole("textbox", { name: "Panel A state" });
    fireEvent.change(input, { target: { value: "unsaved panel state" } });
    for (const active of ["b", "a", "b", "a"]) {
      rerender(
        <UnconnectedPanelLayout layout={{ panels: ["a", "b"], active }} onChange={onChange} />,
      );
      await waitFor(() => {
        expect(input.isConnected).toBe(active === "a");
      });
      expect(unmountA).not.toHaveBeenCalled();
    }
    expect(screen.getByRole("textbox", { name: "Panel A state" })).toBe(input);
    expect((input as HTMLInputElement).value).toBe("unsaved panel state");
    expect(mountA).toHaveBeenCalledTimes(1);
    // Showing an outside layout may only report adjusted split sizes back, never other panels.
    const panelsReported = (from: number) =>
      onChange.mock.calls.slice(from).map(([reported]) => getPanelIds(reported));
    for (const ids of panelsReported(0)) {
      expect(ids).toEqual(["a", "b"]);
    }
    const callsBeforeRerender = onChange.mock.calls.length;

    rerender(
      <UnconnectedPanelLayout
        layout={{
          direction: "row",
          children: [{ panels: ["a"] }, { panels: ["c"] }],
          sizes: [40, 60],
        }}
        onChange={onChange}
      />,
    );
    await waitFor(() => {
      expect(renderC).toHaveBeenCalled();
    });
    // Each panel module should have only been loaded once, so A and B were not remounted. (They
    // may render again: React 19 pre-renders siblings while panel C suspends.)
    expect(moduleA).toHaveBeenCalledTimes(1);
    expect(moduleB).toHaveBeenCalledTimes(1);
    expect(moduleC).toHaveBeenCalledTimes(1);
    for (const ids of panelsReported(callsBeforeRerender)) {
      expect(ids).toEqual(["a", "c"]);
    }

    unmount();
    expect(unmountA).toHaveBeenCalledTimes(1);
  });
});
