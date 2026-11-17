// SPDX-License-Identifier: MPL-2.0
/** @vitest-environment jsdom */

import type { HistorySnapshot } from "@lichtblick/suite-base/providers/CurrentLayoutProvider/layoutHistory";

import { deleteLayoutHistory, loadLayoutHistory, saveLayoutHistory } from "./layoutHistoryStorage";

const snapshot = (n: number): HistorySnapshot => ({
  entries: [
    {
      data: { configById: {}, globalVariables: { n }, userNodes: {}, playbackConfig: { speed: 1 } },
      savedAt: n,
    },
  ],
  index: 0,
});

describe("layoutHistoryStorage", () => {
  it("returns a pending save before it is written, and writes the latest one", async () => {
    vi.useFakeTimers();
    saveLayoutHistory("a", snapshot(1));
    saveLayoutHistory("a", snapshot(2));
    expect(await loadLayoutHistory("a")).toEqual(snapshot(2));
    vi.runAllTimers();
    vi.useRealTimers();
    await vi.waitFor(async () => {
      expect(await loadLayoutHistory("a")).toEqual(snapshot(2));
    });
  });

  it("writes a pending save of another layout before switching to a new one", async () => {
    saveLayoutHistory("b", snapshot(3));
    saveLayoutHistory("c", snapshot(4));
    await vi.waitFor(async () => {
      expect(await loadLayoutHistory("b")).toEqual(snapshot(3));
    });
  });

  it("drops a pending save when the layout is deleted", async () => {
    saveLayoutHistory("d", snapshot(5));
    await deleteLayoutHistory("d");
    window.dispatchEvent(new Event("pagehide"));
    expect(await loadLayoutHistory("d")).toBeUndefined();
  });
});
