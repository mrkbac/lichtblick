// SPDX-License-Identifier: MPL-2.0
/** @vitest-environment jsdom */

import type { HistorySnapshot } from "@lichtblick/suite-base/providers/CurrentLayoutProvider/layoutHistory";
import { createKeyValueStore } from "@lichtblick/suite-base/util/idbKeyValueStore";

import { deleteLayoutHistory, loadLayoutHistory, saveLayoutHistory } from "./layoutHistoryStorage";

// The database itself, to see what was written rather than what is still pending.
const db = createKeyValueStore("lichtblick-layout-history", "history");
const written = async (layoutId: string) =>
  await (await db.readwrite()).getAll(IDBKeyRange.bound([layoutId], [layoutId, []]));

const entry = (n: number) => ({
  data: { configById: {}, globalVariables: { n }, userNodes: {}, playbackConfig: { speed: 1 } },
  savedAt: n,
});
const snapshot = (...steps: number[]): HistorySnapshot => ({
  entries: (steps.length > 0 ? steps : [0]).map(entry),
  index: Math.max(steps.length - 1, 0),
});

describe("layoutHistoryStorage", () => {
  it("returns a pending save before it is written, and writes the latest one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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

  it("writes at most once a second", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    saveLayoutHistory("e", snapshot(6));
    vi.advanceTimersByTime(999);
    expect(await written("e")).toEqual([]);
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    await vi.waitFor(async () => {
      expect(await written("e")).toMatchObject([snapshot(6)]);
    });
  });

  it("writes a pending save when the page is hidden", async () => {
    saveLayoutHistory("f", snapshot(7));
    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(async () => {
      expect(await written("f")).toMatchObject([snapshot(7)]);
    });
  });

  it("drops a pending save when the layout is deleted", async () => {
    saveLayoutHistory("d", snapshot(5));
    await deleteLayoutHistory("d");
    window.dispatchEvent(new Event("pagehide"));
    expect(await loadLayoutHistory("d")).toBeUndefined();
  });

  it("keeps the steps of two tabs editing the same layout", async () => {
    const tabA = await import("./layoutHistoryStorage");
    vi.resetModules();
    const tabB = await import("./layoutHistoryStorage");

    tabA.saveLayoutHistory("g", snapshot(10, 11));
    tabB.saveLayoutHistory("g", snapshot(10, 12));
    window.dispatchEvent(new Event("pagehide"));
    // Both tabs' steps, by time.
    await vi.waitFor(async () => {
      expect((await tabA.loadLayoutHistory("g"))?.entries.map((e) => e.savedAt)).toEqual([
        10, 11, 12,
      ]);
    });
    const merged = await tabA.loadLayoutHistory("g");

    // A tab that has every step of another tab's record drops that record.
    tabA.saveLayoutHistory("g", { entries: merged!.entries, index: 2 });
    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(async () => {
      expect(await written("g")).toHaveLength(1);
    });
    expect((await tabB.loadLayoutHistory("g"))?.entries.map((e) => e.savedAt)).toEqual([
      10, 11, 12,
    ]);
  });

  it("reads and replaces a history saved under the plain layout id", async () => {
    await db.set("h", snapshot(20));
    expect(await loadLayoutHistory("h")).toEqual(snapshot(20));
    saveLayoutHistory("h", snapshot(20, 21));
    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(async () => {
      expect(await db.get("h")).toBeUndefined();
    });
    expect(await loadLayoutHistory("h")).toEqual(snapshot(20, 21));
  });
});
