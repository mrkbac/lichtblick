// SPDX-License-Identifier: MPL-2.0

import Log from "@lichtblick/log";
import type { HistorySnapshot } from "@lichtblick/suite-base/providers/CurrentLayoutProvider/layoutHistory";
import { createKeyValueStore } from "@lichtblick/suite-base/util/idbKeyValueStore";

const log = Log.getLogger(__filename);

/** Edits land in IndexedDB at most this often; typing must not rewrite the history each key. */
const SAVE_THROTTLE_MS = 1000;

// ponytail: local IndexedDB only, last writer wins across tabs; a server-backed store can
// implement these three calls.
const store = createKeyValueStore("lichtblick-layout-history", "history");

let pending: { layoutId: string; history: HistorySnapshot } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  clearTimeout(timer);
  timer = undefined;
  if (pending) {
    const { layoutId, history } = pending;
    pending = undefined;
    store.set(layoutId, history).catch((error: unknown) => {
      log.error(error);
    });
  }
}

window.addEventListener("pagehide", flush);

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
  timer ??= setTimeout(flush, SAVE_THROTTLE_MS);
}

export async function deleteLayoutHistory(layoutId: string): Promise<void> {
  // A pending save must not bring the deleted history back.
  if (pending?.layoutId === layoutId) {
    pending = undefined;
  }
  await store.delete(layoutId);
}
