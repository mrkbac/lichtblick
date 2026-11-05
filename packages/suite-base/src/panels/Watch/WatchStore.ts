// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { toSec } from "@foxglove/rostime";

import { applyModifier, MessagePath } from "@lichtblick/message-path";
import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { MessageEvent } from "@lichtblick/suite-base/players/types";

import { toPlottable } from "./format";

export const HISTORY_SIZE = 120;

/** A row ready for evaluation: parsed path with global variables filled in. */
export type CompiledRow = {
  id: string;
  path: MessagePath;
  /** Changes whenever the evaluated path changes, so the row's state is reset */
  key: string;
};

export type RowState = {
  value: unknown;
  error?: string;
  /** Ring buffer of recent plottable values */
  history: Float64Array;
  historyStart: number;
  historyCount: number;
  // Time-series modifier state (`.@derivative` etc.)
  prevTime?: number;
  prevY?: number;
  integral: number;
};

function createState(): RowState {
  return {
    value: undefined,
    history: new Float64Array(HISTORY_SIZE),
    historyStart: 0,
    historyCount: 0,
    integral: 0,
  };
}

/** Values of the ring buffer, oldest first. */
export function historyValues(state: RowState): number[] {
  const out = new Array<number>(state.historyCount);
  for (let i = 0; i < state.historyCount; i++) {
    out[i] = state.history[(state.historyStart + i) % HISTORY_SIZE]!;
  }
  return out;
}

function pushHistory(state: RowState, y: number): void {
  if (state.historyCount < HISTORY_SIZE) {
    state.history[(state.historyStart + state.historyCount) % HISTORY_SIZE] = y;
    state.historyCount++;
  } else {
    state.history[state.historyStart] = y;
    state.historyStart = (state.historyStart + 1) % HISTORY_SIZE;
  }
}

/** Apply a time-series modifier like `.@derivative` using the row's previous sample. */
function applyStreamModifier(
  path: MessagePath,
  state: RowState,
  value: unknown,
  time: number,
): unknown {
  if (typeof value !== "number") {
    throw new Error(`.@${path.modifier} needs a number, got ${typeof value}`);
  }
  const { prevTime, prevY } = state;
  const hasPrev = prevTime != undefined && prevY != undefined;
  let result: number | undefined;
  switch (path.modifier) {
    case "derivative":
      result = hasPrev && time !== prevTime ? (value - prevY) / (time - prevTime) : undefined;
      break;
    case "delta":
      result = hasPrev ? value - prevY : undefined;
      break;
    case "timedelta":
      result = hasPrev ? time - prevTime : undefined;
      break;
    case "integral":
      if (hasPrev) {
        state.integral += ((value + prevY) / 2) * (time - prevTime);
      }
      result = state.integral;
      break;
  }
  state.prevTime = time;
  state.prevY = value;
  let out: unknown = result;
  for (const modifier of path.modifiersAfter ?? []) {
    out = out == undefined ? undefined : applyModifier(out, modifier);
  }
  return out;
}

/**
 * Latest value per watch row. Fed with every message of the subscribed topics; the UI reads the
 * rows marked dirty once per animation frame, so messages never trigger React renders.
 */
export class WatchStore {
  #rowsByTopic = new Map<string, CompiledRow[]>();
  #states = new Map<string, RowState>();
  #keys = new Map<string, string>();
  #lastByTopic = new Map<string, MessageEvent>();
  #dirty = new Set<string>();

  public setRows(rows: readonly CompiledRow[]): void {
    const ids = new Set(rows.map((row) => row.id));
    for (const id of this.#states.keys()) {
      if (!ids.has(id)) {
        this.#states.delete(id);
        this.#keys.delete(id);
      }
    }
    this.#rowsByTopic.clear();
    for (const row of rows) {
      const topicRows = this.#rowsByTopic.get(row.path.topicName) ?? [];
      topicRows.push(row);
      this.#rowsByTopic.set(row.path.topicName, topicRows);
      if (this.#keys.get(row.id) === row.key) {
        continue;
      }
      // New or changed path: evaluate against the latest message so paused playback shows it too
      this.#keys.set(row.id, row.key);
      const state = createState();
      this.#states.set(row.id, state);
      const last = this.#lastByTopic.get(row.path.topicName);
      if (last) {
        this.#evaluate(row, state, last);
      }
      this.#dirty.add(row.id);
    }
  }

  public addMessages(events: readonly MessageEvent[]): void {
    for (const event of events) {
      const rows = this.#rowsByTopic.get(event.topic);
      if (!rows) {
        continue;
      }
      this.#lastByTopic.set(event.topic, event);
      for (const row of rows) {
        const state = this.#states.get(row.id);
        if (state) {
          this.#evaluate(row, state, event);
          this.#dirty.add(row.id);
        }
      }
    }
  }

  /** Forget all values, e.g. after a seek. */
  public reset(): void {
    this.#lastByTopic.clear();
    for (const id of this.#states.keys()) {
      this.#states.set(id, createState());
      this.#dirty.add(id);
    }
  }

  public get(id: string): RowState | undefined {
    return this.#states.get(id);
  }

  /** Ids of rows changed since the last call. */
  public takeDirty(): string[] {
    const ids = [...this.#dirty];
    this.#dirty.clear();
    return ids;
  }

  #evaluate(row: CompiledRow, state: RowState, event: MessageEvent): void {
    try {
      const items = simpleGetMessagePathDataItems(event, row.path);
      if (items.length === 0) {
        return; // e.g. a filter that does not match this message: keep the previous value
      }
      let value = items.length === 1 ? items[0] : items;
      if (row.path.modifier != undefined) {
        value = applyStreamModifier(row.path, state, value, toSec(event.receiveTime));
      }
      state.value = value;
      state.error = undefined;
      const y = toPlottable(value);
      if (y != undefined) {
        pushHistory(state, y);
      }
    } catch (err: unknown) {
      state.value = undefined;
      state.error = err instanceof Error ? err.message : String(err);
    }
  }
}
