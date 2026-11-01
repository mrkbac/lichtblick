// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { toSec } from "@lichtblick/rostime";
import { Immutable } from "@lichtblick/suite";
import { MessageEvent } from "@lichtblick/suite-base/players/types";

import { samplesFromMessage } from "./transforms";
import { FrameEntries, FrameEntry, FrameRow, FrameWarning } from "./types";

const RATE_WINDOW = 20;
/** A dynamic frame is stale after this many missed periods, but never sooner than MIN_STALE_SEC. */
const STALE_PERIODS = 5;
const MIN_STALE_SEC = 1;

/** Returns a new map with the transforms from `events` applied on top of `entries`. */
export function addTransformEvents(
  entries: FrameEntries,
  events: Immutable<MessageEvent[]>,
): Map<string, FrameEntry> {
  const next = new Map(entries);
  for (const event of events) {
    const receiveTime = toSec(event.receiveTime);
    for (const sample of samplesFromMessage(event.schemaName, event.message)) {
      const prev = next.get(sample.child);
      const recentReceiveTimes = [...(prev?.recentReceiveTimes ?? []), receiveTime].slice(
        -RATE_WINDOW,
      );
      const parents =
        prev == undefined
          ? [sample.parent]
          : prev.parents.includes(sample.parent)
            ? prev.parents
            : [...prev.parents, sample.parent];
      next.set(sample.child, {
        ...sample,
        topic: event.topic,
        receiveTime,
        recentReceiveTimes,
        parents,
      });
    }
  }
  return next;
}

/** Entries of `overlay` win, but every parent seen in either map is kept. */
export function mergeEntries(base: FrameEntries, overlay: FrameEntries): Map<string, FrameEntry> {
  const merged = new Map(base);
  for (const [frame, entry] of overlay) {
    const prev = merged.get(frame);
    const parents =
      prev == undefined ? entry.parents : [...new Set([...prev.parents, ...entry.parents])];
    merged.set(frame, { ...entry, parents });
  }
  return merged;
}

function rateOf(entry: FrameEntry): number | undefined {
  const times = entry.recentReceiveTimes;
  const span = times.length >= 2 ? times[times.length - 1]! - times[0]! : 0;
  return span > 0 ? (times.length - 1) / span : undefined;
}

/**
 * Flattens the frames into depth-first rows (children sorted by name).
 *
 * `current` holds the frames with data at the current playback position. `known` holds every
 * frame seen since the data source was opened, so the tree keeps its shape after a seek even
 * before all transforms have been received again; those frames get a `noData` warning.
 */
export function buildRows({
  current,
  known,
  now,
  collapsed,
  staticTopics,
}: {
  current: FrameEntries;
  known: FrameEntries;
  now: number | undefined;
  collapsed: ReadonlySet<string>;
  staticTopics: ReadonlySet<string>;
}): FrameRow[] {
  const entries = mergeEntries(known, current);
  const childrenOf = new Map<string, string[]>();
  for (const entry of entries.values()) {
    const siblings = childrenOf.get(entry.parent) ?? [];
    siblings.push(entry.child);
    childrenOf.set(entry.parent, siblings);
  }
  for (const children of childrenOf.values()) {
    children.sort();
  }

  const rows: FrameRow[] = [];
  const visited = new Set<string>();

  const visit = (frame: string, depth: number) => {
    if (visited.has(frame)) {
      return;
    }
    visited.add(frame);
    const children = childrenOf.get(frame) ?? [];
    rows.push(makeRow(frame, depth, children));
    if (!collapsed.has(frame)) {
      for (const child of children) {
        visit(child, depth + 1);
      }
    } else {
      // Still mark collapsed descendants as visited so they aren't treated as roots below.
      markVisited(children);
    }
  };

  const markVisited = (frames: string[]) => {
    for (const frame of frames) {
      if (!visited.has(frame)) {
        visited.add(frame);
        markVisited(childrenOf.get(frame) ?? []);
      }
    }
  };

  const makeRow = (frame: string, depth: number, children: string[]): FrameRow => {
    const hasChildren = children.length > 0;
    const entry = entries.get(frame);
    if (!entry) {
      return { frame, depth, hasChildren, isStatic: false, warnings: [] };
    }
    const hasData = current.has(frame);
    const isStatic = staticTopics.has(entry.topic);
    const rate = rateOf(entry);
    const age = hasData && now != undefined ? Math.max(0, now - entry.receiveTime) : undefined;
    const warnings: FrameWarning[] = [];
    if (!hasData) {
      warnings.push("noData");
    }
    if (entry.parents.length > 1) {
      warnings.push("multipleParents");
    }
    const staleAfter = Math.max(MIN_STALE_SEC, rate != undefined ? STALE_PERIODS / rate : 0);
    if (!isStatic && age != undefined && age > staleAfter) {
      warnings.push("stale");
    }
    return { frame, depth, hasChildren, isStatic, entry, age, rate, warnings };
  };

  const roots = [...childrenOf.keys()].filter((frame) => !entries.has(frame)).sort();
  for (const root of roots) {
    visit(root, 0);
  }
  // Frames in a cycle have no root; show them anyway rather than silently dropping them.
  for (const frame of [...entries.keys()].sort()) {
    visit(frame, 0);
  }
  return rows;
}
