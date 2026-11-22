/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";

import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";

import { useSaveSessionBeforeReload } from "./useSaveSessionBeforeReload";
import { takeResumePlayback } from "./useServiceWorkerUpdate";

let busy = true;
let saveSession: (() => Promise<void>) | undefined;

vi.mock("@lichtblick/suite-base/hooks/useServiceWorkerUpdate", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setSaveSessionBeforeReload: (save: () => Promise<void>) => {
    saveSession = save;
    return () => {};
  },
}));
vi.mock("@lichtblick/suite-base/context/LayoutManagerContext", () => ({
  useLayoutManager: () => ({ isBusy: () => busy }),
}));
vi.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipelineGetter: () => () => ({
    playerState: {
      capabilities: [PLAYER_CAPABILITIES.setSpeed, PLAYER_CAPABILITIES.playbackControl],
      activeData: { currentTime: { sec: 12, nsec: 345_000_000 }, isPlaying: true },
    },
  }),
}));

describe("useSaveSessionBeforeReload", () => {
  it("waits for the layout save, then writes the exact time and the playing state", async () => {
    vi.useFakeTimers();
    renderHook(() => {
      useSaveSessionBeforeReload();
    });
    let saved = false;
    void saveSession!().then(() => {
      saved = true;
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toBe(false); // the layout manager is still writing
    busy = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(saved).toBe(true);
    expect(new URL(window.location.href).searchParams.get("time")).toBe(
      "1970-01-01T00:00:12.345000000Z",
    );
    expect(takeResumePlayback()).toBe(true);
    vi.useRealTimers();
  });
});
