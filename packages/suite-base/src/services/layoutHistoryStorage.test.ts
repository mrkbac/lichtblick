// SPDX-License-Identifier: MPL-2.0
/** @vitest-environment jsdom */

import type { HistorySnapshot } from "@lichtblick/suite-base/providers/CurrentLayoutProvider/layoutHistory";
import { createKeyValueStore } from "@lichtblick/suite-base/util/idbKeyValueStore";

import { deleteLayoutHistory, loadLayoutHistory, saveLayoutHistory } from "./layoutHistoryStorage";

// The database itself, to see what was written rather than what is still pending.
const written = createKeyValueStore("lichtblick-layout-history", "history");

const snapshot = (...steps: number[]): HistorySnapshot => ({
  entries: steps.map((n) => ({
    data: { configById: {}, globalVariables: { n }, userNodes: {}, playbackConfig: { speed: 1 } },
    savedAt: n,
  })),
  index: steps.length - 1,
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
      expect(await loadLayoutHistory("a")).toMatchObject(snapshot(2));
    });
  });

  it("writes a pending save of another layout before switching to a new one", async () => {
    saveLayoutHistory("b", snapshot(3));
    saveLayoutHistory("c", snapshot(4));
    await vi.waitFor(async () => {
      expect(await loadLayoutHistory("b")).toMatchObject(snapshot(3));
    });
  });

  it("writes at most once a second", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    saveLayoutHistory("e", snapshot(6));
    vi.advanceTimersByTime(999);
    expect(await written.get("e")).toBeUndefined();
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    await vi.waitFor(async () => {
      expect(await written.get("e")).toMatchObject(snapshot(6));
    });
  });

  it("writes a pending save when the page is hidden", async () => {
    saveLayoutHistory("f", snapshot(7));
    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(async () => {
      expect(await written.get("f")).toMatchObject(snapshot(7));
    });
  });

  it("drops a pending save when the layout is deleted", async () => {
    saveLayoutHistory("d", snapshot(5));
    await deleteLayoutHistory("d");
    window.dispatchEvent(new Event("pagehide"));
    expect(await loadLayoutHistory("d")).toBeUndefined();
  });

  it("keeps the steps of two tabs editing the same layout, but not steps a tab dropped", async () => {
    const tabA = await import("./layoutHistoryStorage");
    vi.resetModules();
    const tabB = await import("./layoutHistoryStorage");
    const savedSteps = async () =>
      (await written.get<HistorySnapshot>("g"))?.entries.map((entry) => entry.savedAt);

    tabA.saveLayoutHistory("g", snapshot(10, 11));
    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(async () => {
      expect(await savedSteps()).toEqual([10, 11]);
    });
    // Tab A undoes 11 and edits again, tab B (opened at 10) edits too
    tabA.saveLayoutHistory("g", snapshot(10, 12));
    tabB.saveLayoutHistory("g", snapshot(10, 13));
    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(async () => {
      expect(await savedSteps()).toEqual([10, 12, 13]);
    });
  });
});
