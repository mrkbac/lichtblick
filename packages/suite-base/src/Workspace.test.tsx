/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom/vitest";
import { act, render, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

import {
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Sidebars from "@lichtblick/suite-base/components/Sidebars";
import { SidebarItem } from "@lichtblick/suite-base/components/Sidebars/types";
import { useEvents } from "@lichtblick/suite-base/context/EventsContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceStore } from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { useAppConfigurationValue } from "@lichtblick/suite-base/hooks";
import useAlertCount from "@lichtblick/suite-base/hooks/useAlertCount";
import { useHandleFiles } from "@lichtblick/suite-base/hooks/useHandleFiles";
import { useLayoutTransfer } from "@lichtblick/suite-base/hooks/useLayoutTransfer";
import { rememberPlaybackForReload } from "@lichtblick/suite-base/hooks/useServiceWorkerUpdate";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";
import { parseAppURLState } from "@lichtblick/suite-base/util/appURLState";
import { encodeSharedLayout } from "@lichtblick/suite-base/util/shareLink";

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
vi.mock("@lichtblick/suite-base/components/DataSourceDialog/DataSourceDialog", () => ({
  DataSourceDialog: () => undefined,
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
vi.mock("@lichtblick/suite-base/components/StudioLogsSettings/StudioLogsSettings", () => ({
  StudioLogsSettings: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/SyncAdapters", () => ({
  SyncAdapters: () => undefined,
}));
vi.mock("@lichtblick/suite-base/components/TopicList/TopicList", () => ({
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

  it.each([
    { name: "example.mcap", resumes: true },
    // the original file failed to reopen and the user opened another one
    { name: "other.mcap", resumes: false },
  ])(
    "after an update reload, resumes playback only of the same recording ($name)",
    ({ name, resumes }) => {
      const seek = vi.fn();
      const play = vi.fn();
      const pipeline = {
        ...mockPipelineContext,
        playerState: {
          ...mockPipelineContext.playerState,
          presence: PlayerPresence.PRESENT,
          urlState: { sourceId: "mcap-local-file" },
          name,
        },
        seekPlayback: seek,
        startPlayback: play,
      };
      (useMessagePipeline as Mock).mockImplementation(
        (selector: (ctx: typeof pipeline) => unknown) => selector(pipeline),
      );
      (useMessagePipelineGetter as Mock).mockReturnValue(() => pipeline);
      (parseAppURLState as Mock).mockReturnValue({ time: { sec: 7, nsec: 0 } });
      rememberPlaybackForReload(JSON.stringify(["mcap-local-file", "example.mcap"]));

      render(<Workspace deepLinks={["http://localhost/?time=7"]} />);

      expect(seek).toHaveBeenCalledExactlyOnceWith({ sec: 7, nsec: 0 });
      expect(play).toHaveBeenCalledTimes(resumes ? 1 : 0);
    },
  );

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
    expect(handleFiles).toHaveBeenCalledWith([file], [handle]);
    (handle.getFile as Mock).mockRejectedValue(new Error("denied"));
    await act(async () => {
      await consume({ files: [handle] });
    });
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith("Failed to open the launched file", {
      variant: "error",
    });
  });

  it("drops a pending protocol seek when a file launch arrives", async () => {
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
      dsParams: { url: "https://example.com/old.mcap" },
      time: { sec: 123, nsec: 0 },
    });
    await act(async () => {
      await consume({
        files: [],
        targetURL: protocolCallback("ds=remote-file&ds.url=https://example.com/old.mcap&time=123"),
      });
    });
    const handle = {
      kind: "file",
      getFile: vi.fn().mockResolvedValue(new File(["data"], "data.mcap")),
    } as unknown as FileSystemFileHandle;
    await act(async () => {
      await consume({ files: [handle], targetURL: "http://localhost/" });
    });
    pipeline = { ...pipeline, playerState: { ...pipeline.playerState, playerId: "file" } };
    rerender(<Workspace />);
    expect(seek).not.toHaveBeenCalled();
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
        // Anyone can make a link: its user scripts need approval.
        { untrusted: true, from: "link" },
      );
    });
  });

  it("should delete only earlier link-installed copies after successful install", async () => {
    // Given an earlier link copy plus an own, an imported (untrusted) and a shared layout with the
    // same name
    mockGetLayouts.mockResolvedValue([
      {
        id: "old-id",
        name: "my-layout",
        permission: "CREATOR_WRITE",
        untrusted: true,
        from: "link",
      },
      { id: "own-id", name: "my-layout", permission: "CREATOR_WRITE" },
      { id: "imported-id", name: "my-layout", permission: "CREATOR_WRITE", untrusted: true },
      {
        id: "shared-id",
        name: "my-layout",
        permission: "ORG_WRITE",
        untrusted: true,
        from: "link",
      },
    ]);
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
    expect(mockDeleteLayout).toHaveBeenCalledTimes(1);
  });

  it("should not delete existing layouts if parseAndInstallLayout returns undefined", async () => {
    // Given
    mockGetLayouts.mockResolvedValue([
      {
        id: "old-id",
        name: "my-layout",
        permission: "CREATOR_WRITE",
        untrusted: true,
        from: "link",
      },
    ]);
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

  it("installs a share link's layout as untrusted and keeps it over a sample's", async () => {
    const selectSource = vi.fn();
    (usePlayerSelection as Mock).mockReturnValue({ availableSources: [], selectSource });
    (parseAppURLState as Mock).mockReturnValue({ ds: "sample-demo" });
    const encoded = await encodeSharedLayout({ configById: {}, layout: "Plot!1" });

    // A desktop deep link: the fragment comes with the launch link, not the page URL.
    render(<Workspace deepLinks={[`lichtblick://open?ds=sample-demo#layout=${encoded}`]} />);

    await waitFor(() => {
      expect(mockParseAndInstallLayout).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Shared layout.json" }),
        "local",
        expect.any(AbortSignal),
        { untrusted: true, from: "link" },
      );
    });
    await waitFor(() => {
      expect(selectSource).toHaveBeenCalledWith(
        "sample-demo",
        expect.objectContaining({ keepLayout: true }),
      );
    });
  });

  it("replaces the layout from an earlier share link", async () => {
    mockGetLayouts.mockResolvedValue([
      {
        id: "old-id",
        name: "Shared layout",
        permission: "CREATOR_WRITE",
        untrusted: true,
        from: "link",
      },
    ]);
    const encoded = await encodeSharedLayout({ configById: {} });

    render(<Workspace deepLinks={[`lichtblick://open#layout=${encoded}`]} />);

    await waitFor(() => {
      expect(mockDeleteLayout).toHaveBeenCalledWith({ id: "old-id" });
    });
    expect(mockDeleteLayout).toHaveBeenCalledTimes(1);
  });

  it("only keeps the link's layout for the launch that installed it", async () => {
    const selectSource = vi.fn();
    (usePlayerSelection as Mock).mockReturnValue({ availableSources: [], selectSource });
    const setConsumer = vi.fn();
    window.launchQueue = { setConsumer };
    (parseAppURLState as Mock).mockReturnValue({ ds: "sample-demo" });
    // The linked layout is invalid, so the import fails.
    mockParseAndInstallLayout.mockResolvedValue(undefined);
    const encoded = await encodeSharedLayout({ configById: {} });

    const view = render(
      <Workspace deepLinks={[`lichtblick://open?ds=sample-demo#layout=${encoded}`]} />,
    );
    await waitFor(() => {
      expect(selectSource).toHaveBeenCalledTimes(1);
    });
    expect(selectSource.mock.calls[0]![1]).not.toHaveProperty("keepLayout");

    // A later, unrelated launch shows the sample's own layout.
    mockParseAndInstallLayout.mockResolvedValue({ id: "new-layout-id" });
    const consume = setConsumer.mock.calls[0]![0] as (params: LaunchParams) => Promise<void>;
    (parseAppURLState as Mock).mockReturnValue({ ds: "sample-other" });
    await act(async () => {
      await consume({
        files: [],
        targetURL: `http://localhost/?protocol=${encodeURIComponent("web+lichtblick://open?ds=sample-other")}`,
      });
    });
    await waitFor(() => {
      expect(selectSource).toHaveBeenCalledTimes(2);
    });
    expect(selectSource.mock.calls[1]![1]).not.toHaveProperty("keepLayout");
    view.unmount();
    delete window.launchQueue;
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
