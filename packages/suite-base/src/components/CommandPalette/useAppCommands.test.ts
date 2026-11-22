/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
  useSelectedPanels,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { ChangePanelLayoutPayload } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { useLayoutTransfer } from "@lichtblick/suite-base/hooks/useLayoutTransfer";
import { LayoutNode } from "@lichtblick/suite-base/types/layouts";
import { findGroup, getPanelIds } from "@lichtblick/suite-base/util/layoutTree";

import { Command } from "./commands";
import { useAppCommands } from "./useAppCommands";

vi.mock("@lichtblick/suite-base/components/MessagePipeline");
vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext");
vi.mock("@lichtblick/suite-base/context/LayoutManagerContext");
vi.mock("@lichtblick/suite-base/context/PanelCatalogContext");
vi.mock("@lichtblick/suite-base/context/PlayerSelectionContext");
vi.mock("@lichtblick/suite-base/hooks/useShareLink", () => ({
  useShareLink: () => ({ availability: "none", copyLink: async () => {} }),
}));
vi.mock("@lichtblick/suite-base/context/Workspace/WorkspaceContext");
vi.mock("@lichtblick/suite-base/context/Workspace/useWorkspaceActions");
vi.mock("@lichtblick/suite-base/hooks/useAddPanel");
vi.mock("@lichtblick/suite-base/hooks/useLayoutTransfer");

// Two tabs in one group; the Plot panel's tab is in the background
const layout: LayoutNode = {
  direction: "row",
  children: [{ panels: ["Plot!a"] }, { panels: ["Log!b", "Plot!c"], active: "Log!b" }],
};

describe("useAppCommands", () => {
  const changePanelLayout = vi.fn<(payload: ChangePanelLayoutPayload) => void>();
  const setSelectedPanelIds = vi.fn();
  const addLayoutPanel = vi.fn();
  const closePanel = vi.fn();
  const savePanelConfigs = vi.fn();
  const swapPanel = vi.fn();
  const openPanelSettings = vi.fn();
  // The layout at the time a command runs
  let currentLayout: LayoutNode;
  let currentConfigs: Record<string, Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    currentLayout = layout;
    currentConfigs = {};
    vi.mocked(usePlayerSelection).mockReturnValue({
      availableSources: [],
      recentSources: [],
      selectRecent: vi.fn(),
    } as unknown as ReturnType<typeof usePlayerSelection>);
    vi.mocked(useWorkspaceActions).mockReturnValue({
      dialogActions: { openFile: { open: vi.fn() }, dataSource: { open: vi.fn() } },
      sidebarActions: { left: { selectItem: vi.fn() } },
      openPanelSettings,
    } as unknown as ReturnType<typeof useWorkspaceActions>);
    vi.mocked(useCurrentLayoutActions).mockReturnValue({
      changePanelLayout,
      addPanel: addLayoutPanel,
      closePanel,
      savePanelConfigs,
      swapPanel,
      getCurrentLayoutState: () => ({
        selectedLayout: { data: { layout: currentLayout, configById: currentConfigs } },
      }),
    } as unknown as ReturnType<typeof useCurrentLayoutActions>);
    vi.mocked(useSelectedPanels).mockReturnValue({
      selectedPanelIds: ["Plot!a"],
      setSelectedPanelIds,
    } as unknown as ReturnType<typeof useSelectedPanels>);
    vi.mocked(useCurrentLayoutSelector).mockReturnValue({
      data: { layout, configById: {} },
    });
    vi.mocked(usePanelCatalog).mockReturnValue({
      getPanels: () => [],
      getPanelByType: () => undefined,
    });
    vi.mocked(useLayoutTransfer).mockReturnValue(
      {} as unknown as ReturnType<typeof useLayoutTransfer>,
    );
  });

  async function pick(parentId: string, panelId: string, beforeRun = () => {}) {
    const { result } = renderHook(() => useAppCommands());
    const parent = result.current.commands.find((command) => command.id === parentId)!;
    const children = await parent.children!();
    const child = children.find((command: Command) => command.id === `${parentId}.${panelId}`)!;
    beforeRun();
    child.run!();
  }

  it.each(["panel.focus", "panel.settings"])(
    "%s brings a panel in a background tab to front",
    async (command) => {
      await pick(command, "Plot!c");

      const newLayout = vi.mocked(changePanelLayout).mock.lastCall?.[0].layout;
      expect(findGroup(newLayout, "Plot!c")?.active).toBe("Plot!c");
      expect(getPanelIds(newLayout)).toEqual(getPanelIds(layout));
      expect(setSelectedPanelIds).toHaveBeenLastCalledWith(["Plot!c"]);
    },
  );

  it("uses the layout at the time the panel is picked", async () => {
    const withNewPanel: LayoutNode = {
      direction: "row",
      children: [{ panels: ["Plot!a", "Map!d"] }, { panels: ["Log!b", "Plot!c"], active: "Log!b" }],
    };
    await pick("panel.focus", "Plot!c", () => {
      currentLayout = withNewPanel;
    });
    const newLayout = vi.mocked(changePanelLayout).mock.lastCall?.[0].layout;
    expect(getPanelIds(newLayout)).toContain("Map!d");
    expect(findGroup(newLayout, "Plot!c")?.active).toBe("Plot!c");
  });

  it.each(["panel.focus", "panel.settings"])(
    "%s does nothing for a panel removed meanwhile",
    async (command) => {
      await pick(command, "Plot!c", () => {
        currentLayout = { panels: ["Plot!a"] };
      });
      expect(changePanelLayout).not.toHaveBeenCalled();
      expect(setSelectedPanelIds).not.toHaveBeenCalled();
      expect(openPanelSettings).not.toHaveBeenCalled();
    },
  );

  it("opens settings for a revealed panel", async () => {
    await pick("panel.settings", "Plot!c");
    expect(openPanelSettings).toHaveBeenCalledTimes(1);
  });

  it("offers to add a panel next to the selected panel", () => {
    // Given a catalog with a Map panel while the Plot!a panel is selected
    vi.mocked(usePanelCatalog).mockReturnValue({
      getPanels: () => [{ type: "map", title: "Map", module: vi.fn() }],
      getPanelByType: () => undefined,
    });
    const { result } = renderHook(() => useAppCommands());

    // When picking "to the right of" from the root add-panel command's actions
    const add = result.current.commands.find((cmd) => cmd.id === "panel.add.map")!;
    const place = add.actions!().find((cmd) => cmd.id === "panel.add.map.place.right-of")!;
    place.run!();

    // Then the panel is added next to the selected one
    expect(addLayoutPanel).toHaveBeenCalledWith(
      expect.objectContaining({ position: "right", targetPanelId: "Plot!a" }),
    );
    expect(addLayoutPanel.mock.lastCall?.[0].id).toMatch(/^map!/);
  });

  it("closes a panel from its actions", async () => {
    const { result } = renderHook(() => useAppCommands());
    const focus = result.current.commands.find((cmd) => cmd.id === "panel.focus")!;
    const panel = (await focus.children!()).find((cmd) => cmd.id === "panel.focus.Plot!c")!;

    panel.actions!().find((cmd) => cmd.id.endsWith(".close"))!.run!();

    expect(closePanel).toHaveBeenCalledWith({ id: "Plot!c" });
  });

  it("shows a topic in the selected panel of the same type", async () => {
    // Given a selected Image panel showing another topic, and an image topic in the data
    vi.mocked(useSelectedPanels).mockReturnValue({
      selectedPanelIds: ["Image!a"],
      setSelectedPanelIds,
    } as unknown as ReturnType<typeof useSelectedPanels>);
    vi.mocked(useMessagePipeline).mockImplementation((selector) =>
      selector({
        playerState: {
          activeData: { topics: [{ name: "/cam", schemaName: "sensor_msgs/msg/Image" }] },
        },
      } as unknown as MessagePipelineContext),
    );
    currentConfigs = { "Image!a": { imageMode: { imageTopic: "/old", calibrationTopic: "/c" } } };
    const { result } = renderHook(() => useAppCommands());

    // When picking the topic in the Image panel
    const open = result.current.commands.find((cmd) => cmd.id === "topic.open")!;
    const items = await open.children!();
    items.find((cmd) => cmd.id === "topic.open.Image./cam")!.run!();

    // Then the selected panel is replaced in place with the new topic, keeping its other
    // settings (the Image panel only reads its config on mount), and stays selected
    const swap = swapPanel.mock.lastCall?.[0];
    expect(swap).toMatchObject({
      originalId: "Image!a",
      type: "Image",
      config: { imageMode: { imageTopic: "/cam", calibrationTopic: "/c" } },
    });
    expect(setSelectedPanelIds).toHaveBeenLastCalledWith([swap.newId]);
    expect(addLayoutPanel).not.toHaveBeenCalled();
  });
});
