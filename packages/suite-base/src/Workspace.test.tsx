/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom/vitest";
import { act, render, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

import { McapBundleFile } from "@lichtblick/suite-base/api/mcapBundle/types";
import {
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Sidebars from "@lichtblick/suite-base/components/Sidebars";
import { SidebarItem } from "@lichtblick/suite-base/components/Sidebars/types";
import { useCurrentUserType } from "@lichtblick/suite-base/context/CurrentUserContext";
import { useEvents } from "@lichtblick/suite-base/context/EventsContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceStore } from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { useAppConfigurationValue } from "@lichtblick/suite-base/hooks";
import useAlertCount from "@lichtblick/suite-base/hooks/useAlertCount";
import { useHandleFiles } from "@lichtblick/suite-base/hooks/useHandleFiles";
import { useLayoutTransfer } from "@lichtblick/suite-base/hooks/useLayoutTransfer";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";
import { parseAppURLState } from "@lichtblick/suite-base/util/appURLState";

import Workspace from "./Workspace";

// ── style ─────────────────────────────────────────────────────────────────────
vi.mock("@lichtblick/suite-base/Workspace.style", () => ({
  useStyles: () => ({ classes: { container: "" } }),
}));

// ── external libs ─────────────────────────────────────────────────────────────
vi.mock("i18next", () => ({ t: (key: string) => key }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock("@lichtblick/log", () => ({
  __esModule: true,
  default: { getLogger: () => ({ debug: vi.fn(), error: vi.fn() }) },
}));

const mockEnqueueSnackbar = vi.fn();
vi.mock("notistack", () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}));

// ── api ───────────────────────────────────────────────────────────────────────
const mockGetMcapBundle = vi.fn();
vi.mock("@lichtblick/suite-base/api/mcapBundle/McapBundleAPI", () => ({
  __esModule: true,
  default: { getMcapBundle: (...args: unknown[]) => mockGetMcapBundle(...args) },
}));

// ── components (rendered as null — Sidebars is the exception below) ────────────
vi.mock("@lichtblick/suite-base/components/Sidebars", () => ({
  __esModule: true,
  default: vi.fn(() => undefined),
}));
vi.mock("@lichtblick/suite-base/components/AppBar", () => ({
  AppBar: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/AlertList/AlertsList", () => ({
  AlertsList: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/DataSourceDialog", () => ({
  DataSourceDialog: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/DataSourceSidebar/DataSourceSidebar", () => ({
  __esModule: true,
  default: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/DocumentDropListener", () => ({
  __esModule: true,
  default: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/EventsList", () => ({
  EventsList: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/KeyListener", () => ({
  __esModule: true,
  default: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/LayoutBrowser", () => ({
  __esModule: true,
  default: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/LayoutTemplates", () => ({
  LayoutTemplateCommands: () => undefined,
}));
const { mockPanelLayoutMount } = vi.hoisted(() => ({ mockPanelLayoutMount: vi.fn() }));
vi.mock("@lichtblick/suite-base/components/PanelLayout", async () => {
  const { useEffect } = await import("react");
  return {
    __esModule: true,
    default: function MockPanelLayout() {
      useEffect(() => {
        mockPanelLayoutMount();
      }, []);
      return undefined;
    },
  };
});
vi.mock("@lichtblick/suite-base/components/PanelSettings", () => ({
  __esModule: true,
  default: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/PlaybackControls", () => ({
  __esModule: true,
  default: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/Stack", () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock("@lichtblick/suite-base/components/StudioLogsSettings", () => ({
  StudioLogsSettings: () => undefined,
  StudioLogsSettingsSidebar: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/SyncAdapters", () => ({
  SyncAdapters: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/TopicList", () => ({
  TopicList: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/VariablesList", () => ({
  __esModule: true,
  default: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/WorkspaceDialogs", () => ({
  WorkspaceDialogs: () => undefined,
}));

// ── providers ─────────────────────────────────────────────────────────────────
vi.mock("@lichtblick/suite-base/providers/WorkspaceContextProvider", () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock("@lichtblick/suite-base/providers/PanelStateContextProvider", () => ({
  PanelStateContextProvider: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// ── hooks ─────────────────────────────────────────────────────────────────────
vi.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipeline: vi.fn(),
  useMessagePipelineGetter: vi.fn(),
}));
vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutSelector: vi.fn().mockReturnValue(undefined),
  useCurrentLayoutActions: vi.fn().mockReturnValue({
    setSelectedLayoutId: vi.fn(),
  }),
}));
vi.mock("@lichtblick/suite-base/context/CurrentUserContext", () => ({
  useCurrentUserType: vi.fn(),
}));
vi.mock("@lichtblick/suite-base/context/EventsContext", () => ({
  useEvents: vi.fn(),
}));
vi.mock("@lichtblick/suite-base/context/LayoutManagerContext", () => ({
  useLayoutManager: vi.fn().mockReturnValue({
    getLayouts: vi.fn().mockResolvedValue([]),
    deleteLayout: vi.fn().mockResolvedValue(undefined),
    saveNewLayout: vi.fn().mockResolvedValue({ id: "test-layout-id" }),
  }),
}));
vi.mock("@lichtblick/suite-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: vi.fn(),
}));
vi.mock("@lichtblick/suite-base/context/Workspace/WorkspaceContext", () => ({
  useWorkspaceStore: vi.fn(),
}));
vi.mock("@lichtblick/suite-base/context/Workspace/useWorkspaceActions", () => ({
  useWorkspaceActions: vi.fn(),
}));
vi.mock("@lichtblick/suite-base/hooks", () => ({
  useAppConfigurationValue: vi.fn(),
}));
vi.mock("@lichtblick/suite-base/hooks/useAlertCount", () => ({
  __esModule: true,
  default: vi.fn(),
}));
vi.mock("@lichtblick/suite-base/hooks/useDefaultWebLaunchPreference", () => ({
  useDefaultWebLaunchPreference: vi.fn(),
}));
vi.mock("@lichtblick/suite-base/hooks/useElectronFilesToOpen", () => ({
  __esModule: true,
  default: vi.fn().mockReturnValue(undefined),
}));
vi.mock("@lichtblick/suite-base/hooks/useHandleFiles", () => ({
  useHandleFiles: vi.fn(),
}));
vi.mock("@lichtblick/suite-base/hooks/useLayoutTransfer", () => ({
  useLayoutTransfer: vi.fn().mockReturnValue({
    parseAndInstallLayout: vi.fn().mockResolvedValue({ id: "default-layout-id" }),
    importLayout: vi.fn(),
    exportLayout: vi.fn(),
  }),
}));
vi.mock("@lichtblick/suite-base/hooks/useSeekTimeFromCLI", () => ({
  __esModule: true,
  default: vi.fn(),
}));
vi.mock("@lichtblick/suite-base/panels/Plot/hooks/useStructureItemsStoreManager", () => ({
  useStructureItemsStoreManager: vi.fn(),
}));
vi.mock("@lichtblick/suite-base/util/appURLState", () => ({
  parseAppURLState: vi.fn().mockReturnValue(undefined),
}));
vi.mock("@lichtblick/suite-base/util/broadcast/useBroadcast", () => ({
  __esModule: true,
  default: vi.fn(),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

const MockedSidebars = Sidebars as unknown as Mock;

const mockPipelineContext = {
  playerState: {
    presence: PlayerPresence.NOT_PRESENT,
    playerId: "",
    activeData: undefined,
    alerts: [],
  },
  startPlayback: undefined,
  pausePlayback: undefined,
  seekPlayback: undefined,
  playUntil: undefined,
};

const mockWorkspaceStore = {
  dialogs: {
    dataSource: { open: false, activeDataSource: undefined, item: undefined },
    preferences: { open: false, initialTab: undefined },
  },
  sidebars: {
    left: { item: undefined, open: false, size: undefined },
    right: { item: undefined, open: false, size: undefined },
  },
};

const mockWorkspaceActions = {
  dialogActions: {
    dataSource: { open: vi.fn(), close: vi.fn() },
    preferences: { open: vi.fn() },
    openFile: { open: vi.fn().mockResolvedValue(undefined) },
  },
  sidebarActions: {
    left: { setOpen: vi.fn(), selectItem: vi.fn(), setSize: vi.fn() },
    right: { setOpen: vi.fn(), selectItem: vi.fn(), setSize: vi.fn() },
  },
  openLayoutBrowser: vi.fn(),
};

describe("Workspace - alerts badge in leftSidebarItems", () => {
  beforeEach(() => {
    (useMessagePipeline as Mock).mockImplementation(
      (selector: (ctx: typeof mockPipelineContext) => unknown) => selector(mockPipelineContext),
    );
    (useMessagePipelineGetter as Mock).mockReturnValue(() => mockPipelineContext);
    (useWorkspaceStore as Mock).mockImplementation(
      (selector: (store: typeof mockWorkspaceStore) => unknown) => selector(mockWorkspaceStore),
    );
    (useWorkspaceActions as Mock).mockReturnValue(mockWorkspaceActions);
    (usePlayerSelection as Mock).mockReturnValue({
      availableSources: [],
      selectSource: vi.fn(),
    });
    (useAlertCount as Mock).mockReturnValue({
      playerAlerts: [],
      sessionAlerts: [],
      alertCount: 0,
    });
    (useHandleFiles as Mock).mockReturnValue({ handleFiles: vi.fn() });
    (useAppConfigurationValue as Mock).mockReturnValue([false]);
    (useCurrentUserType as Mock).mockReturnValue("unauthenticated");
    (useEvents as Mock).mockImplementation(
      (selector: (store: { eventsSupported: boolean; selectEvent: Mock }) => unknown) =>
        selector({ eventsSupported: false, selectEvent: vi.fn() }),
    );
  });

  afterEach(() => {
    MockedSidebars.mockClear();
  });

  it("remounts the panels when the player changes and keeps them for the same player", () => {
    // Given: Sidebars renders its children so the panel layout mounts
    MockedSidebars.mockImplementation(({ children }: React.PropsWithChildren) => <>{children}</>);
    mockPanelLayoutMount.mockClear();
    let pipeline = {
      ...mockPipelineContext,
      playerState: { ...mockPipelineContext.playerState, playerId: "first" },
    };
    (useMessagePipeline as Mock).mockImplementation((selector: (ctx: typeof pipeline) => unknown) =>
      selector(pipeline),
    );
    const { rerender } = render(<Workspace />);
    expect(mockPanelLayoutMount).toHaveBeenCalledTimes(1);

    // When: the same player re-renders
    pipeline = { ...pipeline };
    rerender(<Workspace />);

    // Then: the panels are kept
    expect(mockPanelLayoutMount).toHaveBeenCalledTimes(1);

    // When: a different player takes over
    pipeline = { ...pipeline, playerState: { ...pipeline.playerState, playerId: "second" } };
    rerender(<Workspace />);

    // Then: the panels remount
    expect(mockPanelLayoutMount).toHaveBeenCalledTimes(2);
    MockedSidebars.mockImplementation(() => undefined);
  });

  it("should not set badge on alerts sidebar item when alertCount is 0", () => {
    // Given
    (useAlertCount as Mock).mockReturnValue({
      playerAlerts: [],
      sessionAlerts: [],
      alertCount: 0,
    });

    // When
    render(<Workspace />);

    // Then
    const leftItems = MockedSidebars.mock.lastCall?.[0]?.leftItems as Map<string, SidebarItem>;
    expect(leftItems.get("alerts")?.badge).toBeUndefined();
  });

  it("should set badge with count and error color on alerts sidebar item when alertCount > 0", () => {
    // Given
    (useAlertCount as Mock).mockReturnValue({
      playerAlerts: [{ message: "err", severity: "error" }],
      sessionAlerts: [],
      alertCount: 1,
    });

    // When
    render(<Workspace />);

    // Then
    const leftItems = MockedSidebars.mock.lastCall?.[0]?.leftItems as Map<string, SidebarItem>;
    expect(leftItems.get("alerts")?.badge).toEqual({ count: 1, color: "error" });
  });

  it("should reflect the exact alertCount in the badge", () => {
    // Given
    (useAlertCount as Mock).mockReturnValue({
      playerAlerts: [],
      sessionAlerts: [],
      alertCount: 5,
    });

    // When
    render(<Workspace />);

    // Then
    const leftItems = MockedSidebars.mock.lastCall?.[0]?.leftItems as Map<string, SidebarItem>;
    expect(leftItems.get("alerts")?.badge?.count).toBe(5);
  });
});

describe("Workspace - session-based MCAP resolution", () => {
  const mockSelectSource = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    (useMessagePipeline as Mock).mockImplementation(
      (selector: (ctx: typeof mockPipelineContext) => unknown) => selector(mockPipelineContext),
    );
    (useMessagePipelineGetter as Mock).mockReturnValue(() => mockPipelineContext);
    (useWorkspaceStore as Mock).mockImplementation(
      (selector: (store: typeof mockWorkspaceStore) => unknown) => selector(mockWorkspaceStore),
    );
    (useWorkspaceActions as Mock).mockReturnValue(mockWorkspaceActions);
    (usePlayerSelection as Mock).mockReturnValue({
      availableSources: [],
      selectSource: mockSelectSource,
    });
    (useAlertCount as Mock).mockReturnValue({
      playerAlerts: [],
      sessionAlerts: [],
      alertCount: 0,
    });
    (useHandleFiles as Mock).mockReturnValue({ handleFiles: vi.fn() });
    (useAppConfigurationValue as Mock).mockReturnValue([false]);
    (useCurrentUserType as Mock).mockReturnValue("unauthenticated");
    (useEvents as Mock).mockImplementation(
      (selector: (store: { eventsSupported: boolean; selectEvent: Mock }) => unknown) =>
        selector({ eventsSupported: false, selectEvent: vi.fn() }),
    );
  });

  const protocolCallback = (query: string) =>
    `http://localhost/?protocol=${encodeURIComponent(`web+lichtblick://open?${query}`)}`;

  afterEach(() => {
    delete window.launchQueue;
    window.history.replaceState(undefined, "", "/");
  });

  it("opens a cold protocol launch once even when launchQueue delivers its initial URL", async () => {
    const url = protocolCallback("ds=remote-file&ds.url=https://example.com/data.mcap");
    window.history.replaceState(undefined, "", url);
    const setConsumer = vi.fn();
    window.launchQueue = { setConsumer };
    (parseAppURLState as Mock).mockReturnValue({
      ds: "remote-file",
      dsParams: { url: "https://example.com/data.mcap" },
    });
    render(<Workspace deepLinks={[url]} />);
    expect(mockSelectSource).toHaveBeenCalledTimes(1);
    expect(window.location.search).not.toContain("protocol=");
    await act(async () => {
      await setConsumer.mock.calls[0]![0]({ files: [], targetURL: url });
    });
    expect(mockSelectSource).toHaveBeenCalledTimes(1);
    expect(parseAppURLState).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "http:",
        search: "?ds=remote-file&ds.url=https://example.com/data.mcap",
      }),
    );
  });

  it("routes repeated protocol launches in the existing workspace and preserves ordinary launches", async () => {
    const setConsumer = vi.fn();
    window.launchQueue = { setConsumer };
    (parseAppURLState as Mock).mockReturnValue(undefined);
    render(<Workspace />);
    const consume = setConsumer.mock.calls[0]![0] as (params: LaunchParams) => Promise<void>;
    (parseAppURLState as Mock).mockReturnValue({
      ds: "remote-file",
      dsParams: { url: "https://example.com/data.mcap" },
    });
    await act(async () => {
      await consume({
        files: [],
        targetURL: protocolCallback("ds=remote-file&ds.url=https://example.com/data.mcap"),
      });
    });
    expect(mockSelectSource).toHaveBeenCalledTimes(1);
    await act(async () => {
      await consume({ files: [], targetURL: "https://untrusted.example/?protocol=bad" });
      await consume({ files: [], targetURL: "http://localhost/" });
    });
    expect(mockSelectSource).toHaveBeenCalledTimes(1);
    await act(async () => {
      await consume({
        files: [],
        targetURL: protocolCallback("ds=remote-file&ds.url=https://example.com/data.mcap"),
      });
    });
    expect(mockSelectSource).toHaveBeenCalledTimes(2);
  });

  it("applies a launch once across a pipeline change and seeks only the new source", async () => {
    const setConsumer = vi.fn();
    const seek = vi.fn();
    window.launchQueue = { setConsumer };
    let pipeline = {
      ...mockPipelineContext,
      playerState: {
        ...mockPipelineContext.playerState,
        presence: PlayerPresence.PRESENT,
        playerId: "old",
      },
      seekPlayback: seek,
    };
    (useMessagePipeline as Mock).mockImplementation((selector: (ctx: typeof pipeline) => unknown) =>
      selector(pipeline),
    );
    (useMessagePipelineGetter as Mock).mockReturnValue(() => pipeline);
    (parseAppURLState as Mock).mockReturnValue(undefined);
    const { rerender } = render(<Workspace />);
    const consume = setConsumer.mock.calls[0]![0] as (params: LaunchParams) => Promise<void>;
    (parseAppURLState as Mock).mockReturnValue({
      ds: "remote-file",
      dsParams: { url: "https://example.com/data.mcap" },
      time: { sec: 123, nsec: 0 },
    });
    await act(async () => {
      await consume({
        files: [],
        targetURL: protocolCallback("ds=remote-file&ds.url=https://example.com/data.mcap&time=123"),
      });
    });
    expect(mockSelectSource).toHaveBeenCalledTimes(1);
    expect(seek).not.toHaveBeenCalled();
    pipeline = { ...pipeline, playerState: { ...pipeline.playerState, playerId: "new" } };
    (useMessagePipelineGetter as Mock).mockReturnValue(() => pipeline);
    rerender(<Workspace />);
    expect(mockSelectSource).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledExactlyOnceWith({ sec: 123, nsec: 0 });
  });

  it("preserves file launches and reports file read errors", async () => {
    const setConsumer = vi.fn();
    const handleFiles = vi.fn();
    window.launchQueue = { setConsumer };
    (useHandleFiles as Mock).mockReturnValue({ handleFiles });
    (parseAppURLState as Mock).mockReturnValue(undefined);
    render(<Workspace />);
    const consume = setConsumer.mock.calls[0]![0] as (params: LaunchParams) => Promise<void>;
    const file = new File(["data"], "data.mcap");
    const handle = {
      kind: "file",
      getFile: vi.fn().mockResolvedValue(file),
    } as unknown as FileSystemFileHandle;
    await act(async () => {
      await consume({ files: [handle], targetURL: "http://localhost/" });
    });
    expect(handleFiles).toHaveBeenCalledWith([file]);
    (handle.getFile as Mock).mockRejectedValue(new Error("denied"));
    await act(async () => {
      await consume({ files: [handle] });
    });
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith("Failed to open the launched file", {
      variant: "error",
    });
  });

  it("drops a pending protocol bundle and seek when a file launch arrives", async () => {
    const stale = Promise.withResolvers<McapBundleFile[]>();
    const setConsumer = vi.fn();
    const seek = vi.fn();
    window.launchQueue = { setConsumer };
    let pipeline = {
      ...mockPipelineContext,
      playerState: {
        ...mockPipelineContext.playerState,
        presence: PlayerPresence.PRESENT,
        playerId: "old",
      },
      seekPlayback: seek,
    };
    (useMessagePipeline as Mock).mockImplementation((selector: (ctx: typeof pipeline) => unknown) =>
      selector(pipeline),
    );
    (useMessagePipelineGetter as Mock).mockReturnValue(() => pipeline);
    mockGetMcapBundle.mockReturnValue(stale.promise);
    (parseAppURLState as Mock).mockReturnValue(undefined);
    const { rerender } = render(<Workspace />);
    const consume = setConsumer.mock.calls[0]![0] as (params: LaunchParams) => Promise<void>;
    (parseAppURLState as Mock).mockReturnValue({
      mcapBundleId: "session",
      time: { sec: 123, nsec: 0 },
    });
    await act(async () => {
      await consume({ files: [], targetURL: protocolCallback("mcap-bundle=session&time=123") });
    });
    const signal = mockGetMcapBundle.mock.calls[0]![1] as AbortSignal;
    const handle = {
      kind: "file",
      getFile: vi.fn().mockResolvedValue(new File(["data"], "data.mcap")),
    } as unknown as FileSystemFileHandle;
    await act(async () => {
      await consume({ files: [handle], targetURL: "http://localhost/" });
    });
    expect(signal.aborted).toBe(true);
    pipeline = { ...pipeline, playerState: { ...pipeline.playerState, playerId: "file" } };
    rerender(<Workspace />);
    await act(async () => {
      stale.resolve([{ url: "https://example.com/old.mcap", metadata: {} }]);
      await stale.promise;
    });
    expect(mockSelectSource).not.toHaveBeenCalled();
    expect(seek).not.toHaveBeenCalled();
  });

  it("should fetch session and call selectSource with resolved URLs and metadata", async () => {
    // Given
    const mcapBundleId = "test-session-123";
    const mockMcaps = [
      { url: "https://example.com/file1.mcap", metadata: { robot: "r1" } },
      { url: "https://example.com/file2.mcap", metadata: { robot: "r2" } },
    ];
    mockGetMcapBundle.mockResolvedValue(mockMcaps);
    (parseAppURLState as Mock).mockReturnValue({ mcapBundleId });

    // When
    render(<Workspace deepLinks={["https://app.example.com/?mcap-bundle=test-session-123"]} />);

    // Then
    await waitFor(() => {
      expect(mockGetMcapBundle).toHaveBeenCalledWith(mcapBundleId, expect.any(AbortSignal));
    });
    await waitFor(() => {
      expect(mockSelectSource).toHaveBeenCalledWith("remote-file", {
        type: "connection",
        params: { url: "https://example.com/file1.mcap,https://example.com/file2.mcap" },
        sourceMetadata: [{ robot: "r1" }, { robot: "r2" }],
      });
    });
  });

  it("does not refetch a bundle for a cold URL rewrite but handles repeated queued launches", async () => {
    const setConsumer = vi.fn();
    window.launchQueue = { setConsumer };
    mockGetMcapBundle.mockResolvedValue([{ url: "https://example.com/data.mcap", metadata: {} }]);
    (parseAppURLState as Mock).mockImplementation(() => ({ mcapBundleId: "session" }));
    const { rerender } = render(
      <Workspace deepLinks={[protocolCallback("mcap-bundle=session")]} />,
    );
    await waitFor(() => {
      expect(mockSelectSource).toHaveBeenCalledTimes(1);
    });
    rerender(<Workspace deepLinks={["http://localhost/?mcap-bundle=session"]} />);
    expect(mockGetMcapBundle).toHaveBeenCalledTimes(1);
    const consume = setConsumer.mock.calls[0]![0] as (params: LaunchParams) => Promise<void>;
    await act(async () => {
      await consume({ files: [], targetURL: protocolCallback("mcap-bundle=session") });
    });
    expect(mockGetMcapBundle).toHaveBeenCalledTimes(1);
    for (const count of [2, 3]) {
      await act(async () => {
        await consume({ files: [], targetURL: protocolCallback("mcap-bundle=session") });
      });
      await waitFor(() => {
        expect(mockSelectSource).toHaveBeenCalledTimes(count);
      });
      expect(mockGetMcapBundle).toHaveBeenCalledTimes(count);
    }
  });

  it("ignores a superseded bundle response that resolves after cancellation", async () => {
    const stale = Promise.withResolvers<McapBundleFile[]>();
    const setConsumer = vi.fn();
    window.launchQueue = { setConsumer };
    mockGetMcapBundle.mockReturnValue(stale.promise);
    (parseAppURLState as Mock).mockReturnValue({ mcapBundleId: "old-session" });
    render(<Workspace deepLinks={["http://localhost/?mcap-bundle=old-session"]} />);
    const signal = mockGetMcapBundle.mock.calls[0]![1] as AbortSignal;
    (parseAppURLState as Mock).mockReturnValue({
      ds: "remote-file",
      dsParams: { url: "https://example.com/new.mcap" },
    });
    const consume = setConsumer.mock.calls[0]![0] as (params: LaunchParams) => Promise<void>;
    await act(async () => {
      await consume({
        files: [],
        targetURL: protocolCallback("ds=remote-file&ds.url=https://example.com/new.mcap"),
      });
    });
    expect(signal.aborted).toBe(true);
    expect(mockSelectSource).toHaveBeenCalledExactlyOnceWith("remote-file", {
      type: "connection",
      params: { url: "https://example.com/new.mcap" },
      sourceMetadata: undefined,
    });
    await act(async () => {
      stale.resolve([{ url: "https://example.com/old.mcap", metadata: {} }]);
      await stale.promise;
    });
    expect(mockSelectSource).toHaveBeenCalledTimes(1);
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
  });

  it("should show error snackbar when session fetch fails", async () => {
    // Given
    const mcapBundleId = "failing-session";
    mockGetMcapBundle.mockRejectedValue(new Error("Network error"));
    (parseAppURLState as Mock).mockReturnValue({ mcapBundleId });

    // When
    render(<Workspace deepLinks={["https://app.example.com/?mcap-bundle=failing-session"]} />);

    // Then
    await waitFor(() => {
      expect(mockGetMcapBundle).toHaveBeenCalledWith(mcapBundleId, expect.any(AbortSignal));
    });
    await waitFor(() => {
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith("Failed to load session data sources", {
        variant: "error",
      });
    });
  });

  it("should not fetch session when mcapBundleId is not present", () => {
    // Given
    (parseAppURLState as Mock).mockReturnValue({
      ds: "remote-file",
      dsParams: { url: "https://example.com/file.mcap" },
    });

    // When
    render(<Workspace deepLinks={["https://app.example.com/?ds=remote-file"]} />);

    // Then
    expect(mockGetMcapBundle).not.toHaveBeenCalled();
  });
});

describe("Workspace - fetchLayoutFromUrl", () => {
  const mockParseAndInstallLayout = vi.fn();
  const mockGetLayouts = vi.fn();
  const mockDeleteLayout = vi.fn();
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const setupWorkspaceMocks = () => {
    (useMessagePipeline as Mock).mockImplementation(
      (selector: (ctx: typeof mockPipelineContext) => unknown) => selector(mockPipelineContext),
    );
    (useMessagePipelineGetter as Mock).mockReturnValue(() => mockPipelineContext);
    (useWorkspaceStore as Mock).mockImplementation(
      (selector: (store: typeof mockWorkspaceStore) => unknown) => selector(mockWorkspaceStore),
    );
    (useWorkspaceActions as Mock).mockReturnValue(mockWorkspaceActions);
    (usePlayerSelection as Mock).mockReturnValue({
      availableSources: [],
      selectSource: vi.fn(),
    });
    (useAlertCount as Mock).mockReturnValue({
      playerAlerts: [],
      sessionAlerts: [],
      alertCount: 0,
    });
    (useHandleFiles as Mock).mockReturnValue({ handleFiles: vi.fn() });
    (useAppConfigurationValue as Mock).mockReturnValue([false]);
    (useCurrentUserType as Mock).mockReturnValue("unauthenticated");
    (useEvents as Mock).mockImplementation(
      (selector: (store: { eventsSupported: boolean; selectEvent: Mock }) => unknown) =>
        selector({ eventsSupported: false, selectEvent: vi.fn() }),
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLayouts.mockResolvedValue([]);
    mockDeleteLayout.mockResolvedValue(undefined);
    mockParseAndInstallLayout.mockResolvedValue({ id: "new-layout-id" });
    (useLayoutManager as Mock).mockReturnValue({
      getLayouts: mockGetLayouts,
      deleteLayout: mockDeleteLayout,
      saveNewLayout: vi.fn().mockResolvedValue({ id: "test-layout-id" }),
    });
    (useLayoutTransfer as Mock).mockReturnValue({
      parseAndInstallLayout: mockParseAndInstallLayout,
      importLayout: vi.fn(),
      exportLayout: vi.fn(),
    });
    setupWorkspaceMocks();
  });

  it("does not install or delete layouts when an earlier download resolves after a new launch", async () => {
    const pending = Promise.withResolvers<{ ok: boolean; text: () => Promise<string> }>();
    const setConsumer = vi.fn();
    window.launchQueue = { setConsumer };
    global.fetch = vi.fn().mockReturnValue(pending.promise);
    (parseAppURLState as Mock).mockReturnValue({ layoutUrl: "https://example.com/old.json" });
    const view = render(
      <Workspace deepLinks={["http://localhost/?layoutUrl=https://example.com/old.json"]} />,
    );
    const consume = setConsumer.mock.calls[0]![0] as (params: LaunchParams) => Promise<void>;
    (parseAppURLState as Mock).mockReturnValue({
      ds: "remote-file",
      dsParams: { url: "https://example.com/new.mcap" },
    });
    await act(async () => {
      await consume({
        files: [],
        targetURL: `http://localhost/?protocol=${encodeURIComponent("web+lichtblick://open?ds=remote-file&ds.url=https://example.com/new.mcap")}`,
      });
    });
    await act(async () => {
      pending.resolve({ ok: true, text: async () => "{}" });
      await pending.promise;
    });
    expect(mockParseAndInstallLayout).not.toHaveBeenCalled();
    expect(mockDeleteLayout).not.toHaveBeenCalled();
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
    view.unmount();
    delete window.launchQueue;
  });

  it("should fetch and install layout from valid https URL", async () => {
    // Given
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{"configById":{}}'),
    });
    (parseAppURLState as Mock).mockReturnValue({
      layoutUrl: "https://example.com/my-layout.json",
    });

    // When
    render(
      <Workspace
        deepLinks={["https://app.example.com/?layoutUrl=https://example.com/my-layout.json"]}
      />,
    );

    // Then
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("https://example.com/my-layout.json", {
        signal: expect.any(AbortSignal),
      });
    });
    await waitFor(() => {
      expect(mockParseAndInstallLayout).toHaveBeenCalledWith(
        expect.objectContaining({ name: "my-layout.json" }),
        "local",
        expect.any(AbortSignal),
      );
    });
  });

  it("should delete existing layouts with same name after successful install", async () => {
    // Given
    mockGetLayouts.mockResolvedValue([{ id: "old-id", name: "my-layout" }]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue("{}"),
    });
    (parseAppURLState as Mock).mockReturnValue({
      layoutUrl: "https://example.com/my-layout.json",
    });

    // When
    render(
      <Workspace
        deepLinks={["https://app.example.com/?layoutUrl=https://example.com/my-layout.json"]}
      />,
    );

    // Then
    await waitFor(() => {
      expect(mockDeleteLayout).toHaveBeenCalledWith({ id: "old-id" });
    });
  });

  it("should not delete existing layouts if parseAndInstallLayout returns undefined", async () => {
    // Given
    mockGetLayouts.mockResolvedValue([{ id: "old-id", name: "my-layout" }]);
    mockParseAndInstallLayout.mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue("{}"),
    });
    (parseAppURLState as Mock).mockReturnValue({
      layoutUrl: "https://example.com/my-layout.json",
    });

    // When
    render(
      <Workspace
        deepLinks={["https://app.example.com/?layoutUrl=https://example.com/my-layout.json"]}
      />,
    );

    // Then
    await waitFor(() => {
      expect(mockParseAndInstallLayout).toHaveBeenCalled();
    });
    expect(mockDeleteLayout).not.toHaveBeenCalled();
  });

  it("should show error snackbar for non-http(s) URL", async () => {
    // Given
    (parseAppURLState as Mock).mockReturnValue({
      layoutUrl: "file:///local/layout.json",
    });

    // When
    render(
      <Workspace deepLinks={["https://app.example.com/?layoutUrl=file:///local/layout.json"]} />,
    );

    // Then
    await waitFor(() => {
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        "Layout URL must use http or https protocol",
        {
          variant: "error",
        },
      );
    });
  });

  it("should show error snackbar on HTTP error response", async () => {
    // Given
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    (parseAppURLState as Mock).mockReturnValue({
      layoutUrl: "https://example.com/layout.json",
    });

    // When
    render(
      <Workspace
        deepLinks={["https://app.example.com/?layoutUrl=https://example.com/layout.json"]}
      />,
    );

    // Then
    await waitFor(() => {
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith("Failed to load layout (HTTP 404)", {
        variant: "error",
      });
    });
  });

  it("should show error snackbar on network error", async () => {
    // Given
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    (parseAppURLState as Mock).mockReturnValue({
      layoutUrl: "https://example.com/layout.json",
    });

    // When
    render(
      <Workspace
        deepLinks={["https://app.example.com/?layoutUrl=https://example.com/layout.json"]}
      />,
    );

    // Then
    await waitFor(() => {
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith("Failed to load layout from URL", {
        variant: "error",
      });
    });
  });

  it("should not fetch layout when layoutUrl is absent from URL state", () => {
    // Given
    global.fetch = vi.fn();
    (parseAppURLState as Mock).mockReturnValue({
      ds: "remote-file",
      dsParams: { url: "https://example.com/file.mcap" },
    });

    // When
    render(<Workspace deepLinks={["https://app.example.com/?ds=remote-file"]} />);

    // Then
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should show error snackbar for malformed URL that cannot be parsed", async () => {
    // Given
    (parseAppURLState as Mock).mockReturnValue({
      layoutUrl: "not a valid url ://",
    });

    // When
    render(<Workspace deepLinks={["https://app.example.com/?layoutUrl=not+a+valid+url"]} />);

    // Then
    await waitFor(() => {
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith("Invalid layout URL", { variant: "error" });
    });
  });
});
