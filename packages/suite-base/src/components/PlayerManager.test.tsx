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
});
