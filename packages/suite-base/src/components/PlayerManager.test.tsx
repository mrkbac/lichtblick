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
import type { RecentRecord } from "@lichtblick/suite-base/hooks/useIndexedDbRecents";
import { useSourcePick } from "@lichtblick/suite-base/util/sourcePick";

import PlayerManager from "./PlayerManager";

const storedRecents = vi.hoisted(() => ({
  recents: [] as RecentRecord[],
  recentsLoaded: false,
}));

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
    recents: storedRecents.recents,
    recentsLoaded: storedRecents.recentsLoaded,
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
    expect(selection!.selectedRecordings).toBe(files);

    await act(async () => {
      selection!.selectSource("failing", { type: "connection", params: { url: "x" } });
    });
    expect(selection!.selectedSource).toBe(ok);
    expect(selection!.selectedRecordings).toBe(files);
  });

  it("restores the last file as itself, not into a pending comparison pick", async () => {
    const file = new File(["a"], "r.bag");
    const handle = {
      name: "r.bag",
      queryPermission: async () => "granted",
      getFile: async () => file,
    } as unknown as FileSystemFileHandle;
    storedRecents.recents = [
      { id: "r1", type: "file", sourceId: "ok", title: "r.bag", handles: [handle] },
    ];
    storedRecents.recentsLoaded = true;
    sessionStorage.setItem(
      "lichtblick.lastFileSource",
      JSON.stringify({ sourceId: "ok", title: "r.bag", recentId: "r1" }),
    );
    const deliver = vi.fn();
    useSourcePick.setState({ pick: { label: "recording B", deliver } });
    const ok = source("ok", () => undefined);
    let selection: PlayerSelection | undefined;
    function Probe() {
      selection = usePlayerSelection();
      return <></>;
    }
    try {
      render(
        <PlayerManager playerSources={[ok]}>
          <Probe />
        </PlayerManager>,
      );
      await act(async () => {});

      expect(deliver).not.toHaveBeenCalled();
      expect(useSourcePick.getState().pick).toBeDefined();
      expect(selection!.selectedSource).toBe(ok);
      expect(selection!.selectedRecordings).toEqual([file]);
    } finally {
      useSourcePick.setState({ pick: undefined });
      storedRecents.recents = [];
      storedRecents.recentsLoaded = false;
      sessionStorage.clear();
    }
  });
});
