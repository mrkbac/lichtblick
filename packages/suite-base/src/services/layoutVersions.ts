// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { createKeyValueStore } from "@lichtblick/suite-base/util/idbKeyValueStore";

/** Versions kept per layout; the oldest drop off. */
export const MAX_VERSIONS = 100;
/** A pause in editing this long ends a version; the next save starts a new one. */
export const VERSION_IDLE_MS = 60_000;
/** A version never spans more editing than this, so a long session still leaves checkpoints. */
export const VERSION_MAX_SPAN_MS = 10 * 60_000;

export type LayoutVersion = {
  savedAt: number;
  /** When the editing burst this version sums up began; missing means `savedAt`. */
  startedAt?: number;
  data: LayoutData;
  /**
   * A checkpoint that saves never merge into or out of: the layout as it was opened, or as an
   * older version was restored. Missing for an ordinary editing burst.
   */
  kind?: "opened" | "restored";
};

/**
 * Pure step: the version list after saving `next`. Returns undefined when nothing changed.
 * A version is the end state of an editing burst (saves without a long pause, up to a maximum
 * span), plus checkpoints for opening the layout and for restoring a version.
 */
export function addVersion(
  versions: readonly LayoutVersion[],
  next: LayoutVersion,
): LayoutVersion[] | undefined {
  const last = versions.at(-1);
  if (last && _.isEqual(last.data, next.data)) {
    return undefined;
  }
  if (
    next.kind == undefined &&
    last != undefined &&
    last.kind == undefined &&
    next.savedAt - last.savedAt < VERSION_IDLE_MS &&
    next.savedAt - (last.startedAt ?? last.savedAt) < VERSION_MAX_SPAN_MS
  ) {
    const merged = { ...next, startedAt: last.startedAt ?? last.savedAt };
    return [...versions.slice(0, -1), merged];
  }
  return [...versions, next].slice(-MAX_VERSIONS);
}

// ponytail: local IndexedDB only; a server-backed store can implement the same three calls.
const store = createKeyValueStore("lichtblick-layout-versions", "versions");
const listeners = new Set<(layoutId: string) => void>();

export async function getLayoutVersions(layoutId: string): Promise<LayoutVersion[]> {
  return (await store.get<LayoutVersion[]>(layoutId)) ?? [];
}

export async function recordLayoutVersion(
  layoutId: string,
  data: LayoutData,
  opts: { kind?: LayoutVersion["kind"]; now?: number } = {},
): Promise<void> {
  const savedAt = opts.now ?? Date.now();
  const next = addVersion(
    await getLayoutVersions(layoutId),
    opts.kind ? { savedAt, data, kind: opts.kind } : { savedAt, data },
  );
  if (next) {
    await store.set(layoutId, next);
    listeners.forEach((listener) => {
      listener(layoutId);
    });
  }
}

export async function deleteLayoutVersions(layoutId: string): Promise<void> {
  await store.delete(layoutId);
}

/** Called after a version of a layout was recorded. Returns the unsubscribe function. */
export function onLayoutVersionsChange(listener: (layoutId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
