// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import Log from "@lichtblick/log";
import {
  HISTORY_LIMIT,
  type HistoryEntry,
  type HistorySnapshot,
} from "@lichtblick/suite-base/providers/CurrentLayoutProvider/layoutHistory";
import { createKeyValueStore } from "@lichtblick/suite-base/util/idbKeyValueStore";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";

const log = Log.getLogger(__filename);

/** Edits land in IndexedDB at most this often; typing must not rewrite the history each key. */
const SAVE_THROTTLE_MS = 1000;

const store = createKeyValueStore("lichtblick-layout-history", "history");
/** Saved steps carry the tab that wrote them, so a write keeps only other tabs' steps. */
const TAB = randomUUID();
type SavedEntry = HistoryEntry & { tab?: string };

/**
 * Merges this tab's history into the saved one in one transaction, so tabs editing the same layout
 * keep each other's steps. Steps this tab dropped (redo steps after an edit, coalesced edits) stay
 * dropped.
 */
async function write(layoutId: string, history: HistorySnapshot): Promise<void> {
  const mine: SavedEntry[] = history.entries.map((entry: SavedEntry) =>
    entry.tab != undefined ? entry : { ...entry, tab: TAB },
  );
  const steps = new Set(mine.map((entry) => entry.savedAt));
  const tx = await store.readwrite();
  // A failed get/put aborts the transaction and rejects `done` too, unawaited: handle it here
  tx.transaction.done.catch(() => {});
  const saved = (await tx.get(layoutId)) as HistorySnapshot | undefined;
  const others = (saved?.entries ?? []).filter(
    (entry: SavedEntry) => entry.tab !== TAB && !steps.has(entry.savedAt),
  );
  const entries = _.sortBy([...mine, ...others], "savedAt").slice(-(HISTORY_LIMIT + 1));
  const index = entries.indexOf(mine[history.index]!);
  await tx.put({ entries, index: index === -1 ? entries.length - 1 : index }, layoutId);
  await tx.transaction.done;
}

let pending: { layoutId: string; history: HistorySnapshot } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

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
  if (pending?.layoutId === layoutId) {
    return pending.history;
  }
  return await store.get<HistorySnapshot>(layoutId);
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
  await store.delete(layoutId);
}
