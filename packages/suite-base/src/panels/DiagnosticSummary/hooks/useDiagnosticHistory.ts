// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

import { toSec } from "@foxglove/rostime";
import { useSubscribeMessageRange } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import {
  DiagnosticId,
  DiagnosticStatusArrayMsg,
} from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import {
  changesFor,
  HistoryById,
  LevelChange,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/history";
import { getDiagnosticId } from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/util";
import { MessageEvent } from "@lichtblick/suite-base/players/types";

const FLUSH_INTERVAL_MS = 250;

type MutableHistory = Map<DiagnosticId, { changes: LevelChange[]; lastSeen: number }>;

export function addToHistory(
  history: MutableHistory,
  events: readonly MessageEvent[],
  staleSec: number,
): void {
  for (const event of events as MessageEvent<DiagnosticStatusArrayMsg>[]) {
    const t = toSec(event.receiveTime);
    for (const status of event.message.status) {
      const id = getDiagnosticId(status.hardware_id, status.name);
      const entry = history.get(id);
      if (!entry) {
        history.set(id, { changes: [{ t, level: status.level }], lastSeen: t });
        continue;
      }
      if (t < entry.lastSeen) {
        continue; // out-of-order (e.g. same check on two topics); keep history monotonic
      }
      entry.changes.push(...changesFor(entry, status.level, t, staleSec));
      entry.lastSeen = t;
    }
  }
}

const snapshot = (history: MutableHistory): HistoryById =>
  new Map(
    Array.from(history, ([id, { changes, lastSeen }]) => [id, { changes: [...changes], lastSeen }]),
  );

/**
 * Level history of every check over the whole data source, read via the message range API so it
 * covers the full recording regardless of the playback position. Only level changes are kept,
 * not messages, so memory stays small. Returns undefined when the source has no message range
 * (e.g. live connections); callers fall back to the history built from played messages.
 */
export function useDiagnosticHistory(
  topics: readonly string[],
  staleSec: number,
): HistoryById | undefined {
  const subscribeMessageRange = useSubscribeMessageRange();
  const [history, setHistory] = useState<HistoryById>();

  useEffect(() => {
    setHistory(undefined);
    const building: MutableHistory = new Map();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      if (!cancelled) {
        setHistory(snapshot(building));
      }
    };

    const cancels = topics.map((topic) =>
      subscribeMessageRange({
        topic,
        onNewRangeIterator: async (batches) => {
          for await (const batch of batches) {
            if (cancelled) {
              return;
            }
            addToHistory(building, batch, staleSec);
            timer ??= setTimeout(flush, FLUSH_INTERVAL_MS);
          }
          clearTimeout(timer);
          flush();
        },
      }),
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const cancel of cancels) {
        cancel();
      }
    };
  }, [subscribeMessageRange, topics, staleSec]);

  return history;
}
