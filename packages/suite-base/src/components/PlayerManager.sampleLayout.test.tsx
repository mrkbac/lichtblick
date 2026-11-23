/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, render, waitFor } from "@testing-library/react";
import { PropsWithChildren, useContext } from "react";

import PlayerSelectionContext, {
  DataSourceArgs,
  IDataSourceFactory,
  PlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";

import PlayerManager from "./PlayerManager";

const saveNewLayout = vi.fn(async () => ({ id: "sample-layout-id" }));
const setSelectedLayoutId = vi.fn();

vi.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  MessagePipelineProvider: ({ children }: PropsWithChildren) => <>{children}</>,
}));
vi.mock("@lichtblick/suite-base/components/Compare/CompareContext", () => ({
  CompareProvider: ({ children }: PropsWithChildren) => <>{children}</>,
}));
vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutSelector: () => undefined,
  useCurrentLayoutActions: () => ({ setSelectedLayoutId }),
}));
vi.mock("@lichtblick/suite-base/context/LayoutManagerContext", () => ({
  useLayoutManager: () => ({ saveNewLayout, getLayout: vi.fn(async () => undefined) }),
}));
vi.mock("@lichtblick/suite-base/context/UserScriptStateContext", () => ({
  useUserScriptState: () => ({}),
}));
vi.mock("@lichtblick/suite-base/hooks/useIndexedDbRecents", () => ({
  default: () => ({ recents: [], recentsLoaded: true, addRecent: vi.fn() }),
}));
vi.mock("./useTrustedUserScripts", () => ({
  useTrustedUserScripts: () => ({ scripts: {}, prompt: undefined }),
}));
vi.mock("notistack", () => ({
  useSnackbar: () => ({ enqueueSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));

const sample = {
  id: "sample-demo",
  type: "sample",
  displayName: "Demo",
  sampleLayout: { configById: {}, globalVariables: {}, userNodes: {}, playbackConfig: {} },
  initialize: () => undefined,
} as unknown as IDataSourceFactory;

function openSample(args?: DataSourceArgs) {
  let selection: PlayerSelection | undefined;
  function Capture() {
    selection = useContext(PlayerSelectionContext);
    return <></>;
  }
  render(
    <PlayerManager playerSources={[sample]}>
      <Capture />
    </PlayerManager>,
  );
  act(() => {
    selection!.selectSource("sample-demo", args);
  });
}

describe("PlayerManager sample sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows a sample in its own layout", async () => {
    openSample({ type: "connection" });
    await waitFor(() => {
      expect(setSelectedLayoutId).toHaveBeenCalledWith("sample-layout-id");
    });
  });

  it("keeps the layout a link brings instead of the sample's", async () => {
    openSample({ type: "connection", keepLayout: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(saveNewLayout).not.toHaveBeenCalled();
    expect(setSelectedLayoutId).not.toHaveBeenCalled();
  });
});
