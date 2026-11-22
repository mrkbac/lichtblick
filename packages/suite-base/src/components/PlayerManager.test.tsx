/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, render } from "@testing-library/react";
import { PropsWithChildren } from "react";

import {
  IDataSourceFactory,
  PlayerSelection,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { Player } from "@lichtblick/suite-base/players/types";

import PlayerManager from "./PlayerManager";

vi.mock("notistack", () => ({
  useSnackbar: () => ({ enqueueSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock("@lichtblick/suite-base/context/AnalyticsContext", () => ({
  useAnalytics: () => ({ logEvent: vi.fn() }),
}));
vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutSelector: () => undefined,
  useCurrentLayoutActions: () => ({ setSelectedLayoutId: vi.fn() }),
}));
vi.mock("@lichtblick/suite-base/context/LayoutManagerContext", () => ({
  useLayoutManager: () => ({}),
}));
vi.mock("@lichtblick/suite-base/context/UserScriptStateContext", () => ({
  useUserScriptState: () => ({}),
}));
vi.mock("@lichtblick/suite-base/hooks/useIndexedDbRecents", () => ({
  default: () => ({
    recents: [],
    recentsLoaded: false,
    addRecent: vi.fn(),
    removeRecent: vi.fn(),
    togglePinRecent: vi.fn(),
    clearRecents: vi.fn(),
  }),
}));
vi.mock("./useTrustedUserScripts", () => ({
  useTrustedUserScripts: () => ({ scripts: {}, prompt: undefined }),
}));
vi.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  MessagePipelineProvider: ({ children }: PropsWithChildren) => <>{children}</>,
}));
vi.mock("@lichtblick/suite-base/components/Compare/CompareContext", () => ({
  CompareProvider: ({ children }: PropsWithChildren) => <>{children}</>,
}));

function source(id: string, initialize: IDataSourceFactory["initialize"]): IDataSourceFactory {
  return { id, type: "file", displayName: id, initialize, supportsMultiFile: true };
}

describe("PlayerManager", () => {
  it("keeps the current selection when a new source fails to initialize", async () => {
    const ok = source("ok", () => undefined);
    const failing = source("failing", () => {
      throw new Error("can't open");
    });
    let selection: PlayerSelection | undefined;
    function Probe() {
      selection = usePlayerSelection();
      return <></>;
    }
    render(
      <PlayerManager playerSources={[ok, failing]}>
        <Probe />
      </PlayerManager>,
    );

    const files = [new File(["a"], "a.bag"), new File(["b"], "b.bag")];
    await act(async () => {
      selection!.selectSource("ok", { type: "file", files });
    });
    expect(selection!.selectedSource).toBe(ok);
    expect(selection!.selectedFiles).toBe(files);

    await act(async () => {
      selection!.selectSource("failing", { type: "connection", params: { url: "x" } });
    });
    expect(selection!.selectedSource).toBe(ok);
    expect(selection!.selectedFiles).toBe(files);
  });

  // Lets a selection that is awaiting something run to its end
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  function renderManager(sources: IDataSourceFactory[]): () => PlayerSelection {
    let selection: PlayerSelection | undefined;
    function Probe() {
      selection = usePlayerSelection();
      return <></>;
    }
    render(
      <PlayerManager playerSources={sources}>
        <Probe />
      </PlayerManager>,
    );
    return () => selection!;
  }

  it("drops a player whose import finished after a newer selection", async () => {
    // Given - a source whose initialize is still loading its player's code
    const loading = Promise.withResolvers<Player | undefined>();
    const close = vi.fn();
    const late = { close } as unknown as Player;
    const slow = source("slow", async () => await loading.promise);
    const fast = source("fast", () => undefined);
    const selection = renderManager([slow, fast]);
    const files = [new File(["a"], "a.bag"), new File(["b"], "b.bag")];

    // When - another source is picked meanwhile, then the slow import finishes
    await act(async () => {
      selection().selectSource("slow", { type: "file", files });
      await settle();
    });
    await act(async () => {
      selection().selectSource("fast", { type: "file", files });
      await settle();
    });
    await act(async () => {
      loading.resolve(late);
      await settle();
    });

    // Then - the newer selection stays and the late player is closed, never used
    expect(selection().selectedSource).toBe(fast);
    expect(close).toHaveBeenCalled();
  });

  it("closes a player whose import finished after the source was closed", async () => {
    // Given
    const loading = Promise.withResolvers<Player | undefined>();
    const close = vi.fn();
    const late = { close } as unknown as Player;
    const slow = source("slow", async () => await loading.promise);
    const selection = renderManager([slow]);

    // When
    await act(async () => {
      selection().selectSource("slow", {
        type: "file",
        files: [new File(["a"], "a.bag"), new File(["b"], "b.bag")],
      });
      await settle();
    });
    act(() => {
      selection().closeSource();
    });
    await act(async () => {
      loading.resolve(late);
      await settle();
    });

    // Then
    expect(selection().selectedSource).toBeUndefined();
    expect(close).toHaveBeenCalled();
  });

  it("starts loading a source's player when it is picked and file sources' players once idle", async () => {
    // Given
    const filePrefetch = vi.fn();
    const connectionPrefetch = vi.fn();
    const file = { ...source("file", () => undefined), prefetch: filePrefetch };
    const connection: IDataSourceFactory = {
      ...source("connection", () => undefined),
      type: "connection",
      prefetch: connectionPrefetch,
    };
    vi.useFakeTimers();
    try {
      const selection = renderManager([file, connection]);

      // When - the app goes idle after starting
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Then - file sources prefetch, connection sources wait until picked
      expect(filePrefetch).toHaveBeenCalledTimes(1);
      expect(connectionPrefetch).not.toHaveBeenCalled();

      vi.useRealTimers();
      await act(async () => {
        selection().selectSource("connection", { type: "connection", params: { url: "x" } });
        await settle();
      });
      expect(connectionPrefetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
