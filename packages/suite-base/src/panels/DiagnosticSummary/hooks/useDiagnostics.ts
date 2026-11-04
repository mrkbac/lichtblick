// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { useCallback } from "react";

import { toSec } from "@lichtblick/rostime";
import { useMessageReducer } from "@lichtblick/suite-base/PanelAPI";
import { DiagnosticStatusArrayMsg } from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import { MAX_LIVE_HISTORY_CHANGES } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import { DiagnosticsById } from "@lichtblick/suite-base/panels/DiagnosticSummary/types";
import {
  appendBounded,
  changesFor,
  HistoryById,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/history";
import { MessageEvent } from "@lichtblick/suite-base/players/types";

import { computeDiagnosticInfo } from "../utils/util";

export type DiagnosticsState = {
  /** Latest status per diagnostic id, merged across all subscribed topics. */
  latest: DiagnosticsById;
  /** Level history built from the played messages; bounded, used when no full range is available. */
  history: HistoryById;
};

const EMPTY_STATE: DiagnosticsState = { latest: new Map(), history: new Map() };

/** Pure reducer: never mutates `prev`, so React and memoized consumers see every change. */
export function addMessages(
  prev: DiagnosticsState,
  messageEvents: readonly MessageEvent[],
  staleSec: number,
): DiagnosticsState {
  let latest: DiagnosticsById | undefined;
  let history: HistoryById | undefined;

  for (const event of messageEvents as MessageEvent<DiagnosticStatusArrayMsg>[]) {
    const { header, status: statusArray } = event.message;
    const t = toSec(event.receiveTime);

    for (const status of statusArray) {
      const info = computeDiagnosticInfo(status, header.stamp, event.receiveTime, event.topic);
      history ??= new Map(prev.history);
      const before = history.get(info.id);
      if (before && t < before.lastSeen) {
        continue; // out-of-order (e.g. same check on two topics); keep latest and history monotonic
      }
      latest ??= new Map(prev.latest);
      latest.set(info.id, info);
      const added = changesFor(before, status.level, t, staleSec);
      history.set(info.id, {
        changes:
          added.length > 0
            ? appendBounded(before?.changes ?? [], added, MAX_LIVE_HISTORY_CHANGES)
            : before!.changes,
        lastSeen: t,
      });
    }
  }

  return latest ? { latest, history: history ?? prev.history } : prev;
}

const restore = (prev?: DiagnosticsState) => prev ?? EMPTY_STATE;

export default function useDiagnostics(
  topics: readonly string[],
  staleSec: number,
): DiagnosticsState {
  const reducer = useCallback(
    (prev: DiagnosticsState, events: readonly MessageEvent[]) =>
      addMessages(prev, events, staleSec),
    [staleSec],
  );
  return useMessageReducer<DiagnosticsState>({
    topics,
    restore,
    addMessages: reducer,
  });
}
