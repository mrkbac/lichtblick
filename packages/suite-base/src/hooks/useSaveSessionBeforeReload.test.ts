/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";

import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";

import { useSaveSessionBeforeReload } from "./useSaveSessionBeforeReload";
import { takeResumePlayback } from "./useServiceWorkerUpdate";

let busy = false;
let saveSession: (() => Promise<string | undefined>) | undefined;

vi.mock("@lichtblick/suite-base/hooks/useServiceWorkerUpdate", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setSaveSessionBeforeReload: (save: () => Promise<string | undefined>) => {
    saveSession = save;
    return () => {};
  },
}));
// an edit was pending; its write starts only once React renders it, later than any fixed delay
const flushPendingLayoutSave = vi.fn(() => {
  setTimeout(() => {
    busy = true;
  }, 200);
  return true;
});
vi.mock("@lichtblick/suite-base/components/CurrentLayoutLocalStorageSyncAdapter", () => ({
  flushPendingLayoutSave: () => flushPendingLayoutSave(),
}));
vi.mock("@lichtblick/suite-base/context/LayoutManagerContext", () => ({
  useLayoutManager: () => ({ isBusy: () => busy }),
}));
vi.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipelineGetter: () => () => ({
    playerState: {
      capabilities: [PLAYER_CAPABILITIES.setSpeed, PLAYER_CAPABILITIES.playbackControl],
      activeData: { currentTime: { sec: 12, nsec: 345_000_000 }, isPlaying: true },
      urlState: { sourceId: "mcap-local-file" },
      name: "example.mcap",
    },
  }),
}));

describe("useSaveSessionBeforeReload", () => {
  it("flushes and waits for the layout save, then writes the exact time and returns what was playing", async () => {
    vi.useFakeTimers();
    renderHook(() => {
      useSaveSessionBeforeReload();
    });
    let saved = false;
    let resumeSource: string | undefined;
    void saveSession!().then((source) => {
      saved = true;
      resumeSource = source;
    });

    expect(flushPendingLayoutSave).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(150);
    expect(saved).toBe(false); // waiting for the flushed write to start
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toBe(false); // the layout manager is still writing the flushed edit
    busy = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(saved).toBe(true);
    expect(new URL(window.location.href).searchParams.get("time")).toBe(
      "1970-01-01T00:00:12.345000000Z",
    );
    expect(resumeSource).toBe(JSON.stringify(["mcap-local-file", "example.mcap"]));
    // stored only right before the reload
    expect(takeResumePlayback()).toBeUndefined();
    vi.useRealTimers();
  });
});
