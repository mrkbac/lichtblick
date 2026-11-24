// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import Log from "@lichtblick/log";
import {
  HISTORY_LIMIT,
  type HistorySnapshot,
} from "@lichtblick/suite-base/providers/CurrentLayoutProvider/layoutHistory";
import { createKeyValueStore } from "@lichtblick/suite-base/util/idbKeyValueStore";

const log = Log.getLogger(__filename);

/** Edits land in IndexedDB at most this often; typing must not rewrite the history each key. */
const SAVE_THROTTLE_MS = 1000;

/**
 * Each tab writes its history of a layout under its own key, [layoutId, tab], so tabs editing the
 * same layout don't overwrite each other; reads merge every tab's steps by time. Histories saved
 * before that are under the plain layout id.
 */
const store = createKeyValueStore("lichtblick-layout-history", "history");
const TAB = crypto.randomUUID();

type SavedHistory = HistorySnapshot & { writtenAt?: number };

const layoutRange = (layoutId: string) => IDBKeyRange.bound([layoutId], [layoutId, []]);

let pending: { layoutId: string; history: HistorySnapshot } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Steps of all histories by time, a step in several (loaded by another tab) once. */
function merge(histories: SavedHistory[]): HistorySnapshot | undefined {
  const newestFirst = _.sortBy(histories, (h) => -(h.writtenAt ?? 0));
  const entries = _.sortBy(
    _.uniqBy(
      newestFirst.flatMap((h) => h.entries),
      "savedAt",
    ),
    "savedAt",
  ).slice(-(HISTORY_LIMIT + 1));
  // The current step of the tab that wrote last.
  const latest = newestFirst[0];
  const current = latest?.entries[latest.index];
  const index = entries.findIndex((entry) => entry.savedAt === current?.savedAt);
  return latest && { entries, index: index === -1 ? entries.length - 1 : index };
}

async function write(layoutId: string, history: HistorySnapshot): Promise<void> {
  const tx = await store.readwrite();
  // Drop what this history already has, e.g. a closed tab's steps this tab loaded. Steps older than
  // its oldest would fall off the limit anyway.
  const steps = new Set(history.entries.map((entry) => entry.savedAt));
  const oldest = history.entries[0]?.savedAt ?? Infinity;
  const covered = (saved: SavedHistory) =>
    saved.entries.every((entry) => entry.savedAt < oldest || steps.has(entry.savedAt));
  for (let cursor = await tx.openCursor(layoutRange(layoutId)); cursor; ) {
    if ((cursor.key as string[])[1] !== TAB && covered(cursor.value as SavedHistory)) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  const legacy = (await tx.get(layoutId)) as SavedHistory | undefined;
  if (legacy && covered(legacy)) {
    await tx.delete(layoutId);
  }
  await tx.put({ ...history, writtenAt: Date.now() } satisfies SavedHistory, [layoutId, TAB]);
  await tx.transaction.done;
}

function flush(): void {
  clearTimeout(timer);
  timer = undefined;
  if (pending) {
    const { layoutId, history } = pending;
    pending = undefined;
    write(layoutId, history).catch((error: unknown) => {
      log.error(error);
    });
  }
}

export async function loadLayoutHistory(layoutId: string): Promise<HistorySnapshot | undefined> {
  const tx = await store.readwrite();
  const keys = (await tx.getAllKeys(layoutRange(layoutId))) as string[][];
  const saved = (await tx.getAll(layoutRange(layoutId))) as SavedHistory[];
  const legacy = (await tx.get(layoutId)) as SavedHistory | undefined;
  // This tab's pending save is newer than what it wrote.
  const mine = pending?.layoutId === layoutId ? pending.history : undefined;
  const histories = saved.filter((_history, i) => mine == undefined || keys[i]![1] !== TAB);
  return merge([
    ...histories,
    ...(legacy ? [legacy] : []),
    ...(mine ? [{ ...mine, writtenAt: Date.now() }] : []),
  ]);
}

/** Saves a layout's history soon; a newer save of the same layout replaces a pending one. */
export function saveLayoutHistory(layoutId: string, history: HistorySnapshot): void {
  if (pending != undefined && pending.layoutId !== layoutId) {
    flush();
  }
  pending = { layoutId, history };
  // Write the last edits when the page goes away. Re-adding the same listener is a no-op.
  window.addEventListener("pagehide", flush);
  timer ??= setTimeout(flush, SAVE_THROTTLE_MS);
}

export async function deleteLayoutHistory(layoutId: string): Promise<void> {
  // A pending save must not bring the deleted history back.
  if (pending?.layoutId === layoutId) {
    pending = undefined;
  }
  const tx = await store.readwrite();
  await Promise.all([tx.delete(layoutRange(layoutId)), tx.delete(layoutId), tx.transaction.done]);
}
