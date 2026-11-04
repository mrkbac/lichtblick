// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Fzf } from "fzf";
import { useEffect } from "react";
import { create } from "zustand";

import { Time, add, clampTime, fromSec, subtract, toSec } from "@lichtblick/rostime";
import { KEY_WORKSPACE_PREFIX } from "@lichtblick/suite-base/constants/browserStorageKeys";

export type Command = {
  /** Stable id, used to remember recently used commands. */
  id: string;
  title: string;
  /** Shown dimmed on the right, e.g. "Layout" or "Panel". */
  group?: string;
  /** Secondary line under the title. */
  detail?: string;
  /** Extra words that should match this command but are not shown. */
  keywords?: string[];
  /** Human readable shortcut, e.g. "⌘O". */
  shortcut?: string;
} & (
  | { run: () => unknown; children?: undefined }
  | {
      /** Opens a searchable sub-menu with these commands. */
      children: () => Command[] | Promise<Command[]>;
      /** Search placeholder of the sub-menu. */
      placeholder?: string;
      run?: undefined;
    }
);

export type RankedCommand = { command: Command; positions: Set<number> };

// ponytail: rendering is capped; virtualize the list if users need to scroll past this.
export const MAX_RESULTS = 200;

/**
 * Orders commands for the given query. Recently used commands come first; with a query they get
 * a bonus that beats a slightly better fuzzy match but not a much better one.
 */
export function rankCommands(
  commands: readonly Command[],
  query: string,
  recentIds: readonly string[],
): RankedCommand[] {
  const recency = (id: string) => {
    const idx = recentIds.indexOf(id);
    return idx === -1 ? 0 : recentIds.length - idx;
  };
  const trimmed = query.trim();
  if (trimmed === "") {
    return (
      commands
        .map((command) => ({ command, recency: recency(command.id) }))
        // Array.prototype.sort is stable, so ties keep registration order.
        .sort((a, b) => b.recency - a.recency)
        .slice(0, MAX_RESULTS)
        .map(({ command }) => ({ command, positions: new Set() }))
    );
  }
  const fzf = new Fzf(commands, {
    selector: (cmd: Command) => [cmd.title, cmd.group, ...(cmd.keywords ?? [])].join(" "),
    limit: MAX_RESULTS * 2,
  });
  return fzf
    .find(trimmed)
    .map((result) => ({
      result,
      score: result.score + (recency(result.item.id) > 0 ? RECENT_BONUS : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(({ result }) => ({
      command: result.item,
      positions: result.positions,
    }));
}

/** Roughly the score of two matched characters in fzf's v2 algorithm. */
const RECENT_BONUS = 32;

const UNIT_SECONDS: Record<string, number> = {
  ms: 0.001,
  s: 1,
  m: 60,
  min: 60,
  h: 3600,
};
const NUMBER_RE = /^([+-])?\s*(\d+(?:\.\d*)?|\.\d+)\s*(ms|s|min|m|h)?$/;
const CLOCK_RE = /^([+-])?\s*(\d+):(\d{1,2}(?:\.\d*)?)(?::(\d{1,2}(?:\.\d*)?))?$/;
/** Plain numbers above this are absolute epoch timestamps (2001-09-09), not offsets. */
const EPOCH_THRESHOLD_SEC = 1e9;

export type SeekTarget = { time: Time; relative: boolean };

/**
 * Parses what a user typed into a seek target.
 *
 * - `12.5`, `90s`, `2m`, `1:02`, `1:02:03.5` → offset from the start of the recording
 * - `+5s`, `-500ms`, `+1:00` → relative to the current time
 * - `1700000000.5` → absolute timestamp in seconds
 *
 * The result is clamped to [start, end].
 */
export function parseSeekInput(
  input: string,
  range: { start: Time; end: Time; current?: Time },
): SeekTarget | undefined {
  const text = input.trim();
  let sign: string | undefined;
  let seconds: number;
  let unit: string | undefined;

  const num = NUMBER_RE.exec(text);
  const clock = num ? undefined : CLOCK_RE.exec(text);
  if (num) {
    sign = num[1];
    unit = num[3];
    seconds = Number(num[2]) * (UNIT_SECONDS[unit ?? "s"] ?? 1);
  } else if (clock) {
    sign = clock[1];
    const parts = [clock[2], clock[3], clock[4]].filter((p) => p != undefined).map(Number);
    seconds = parts.reduce((acc, part) => acc * 60 + part, 0);
    // Two parts are m:ss; the last part must be < 60 and so must minutes when hours are given.
    if (parts.slice(1).some((p) => p >= 60)) {
      return undefined;
    }
  } else {
    return undefined;
  }
  if (!Number.isFinite(seconds)) {
    return undefined;
  }

  let time: Time;
  if (sign != undefined) {
    if (!range.current) {
      return undefined;
    }
    if (sign === "+") {
      time = add(range.current, fromSec(seconds));
    } else {
      // Avoid negative times, which rostime can't represent; clamping below handles the rest.
      time =
        toSec(subtract(range.current, range.start)) <= seconds
          ? range.start
          : subtract(range.current, fromSec(seconds));
    }
  } else if (unit == undefined && num && seconds >= EPOCH_THRESHOLD_SEC) {
    time = fromSec(seconds);
  } else {
    time = add(range.start, fromSec(seconds));
  }
  return {
    time: clampTime(time, range.start, range.end),
    relative: sign != undefined,
  };
}

// ---- Sub-menu navigation ----

export type PaletteLevel = {
  /** The command that opened this level; undefined for the root. */
  parent?: Command;
  /** Sub-menu items. The root reads its items from the live command list instead. */
  items?: Command[];
  query: string;
  selectedIndex: number;
};

export type PaletteState = { stack: PaletteLevel[] };

export type PaletteAction =
  | { type: "reset" }
  | { type: "push"; parent: Command; items: Command[] }
  | { type: "pop" }
  | { type: "set-query"; query: string }
  | { type: "select"; index: number }
  | { type: "move"; delta: number; count: number };

export const initialPaletteState: PaletteState = {
  stack: [{ query: "", selectedIndex: 0 }],
};

/** Applies keyboard and mouse navigation to the sub-menu stack. */
export function paletteReducer(state: PaletteState, action: PaletteAction): PaletteState {
  const top = state.stack[state.stack.length - 1]!;
  const replaceTop = (level: PaletteLevel) => ({
    stack: [...state.stack.slice(0, -1), level],
  });
  switch (action.type) {
    case "reset":
      return initialPaletteState;
    case "push":
      return {
        stack: [
          ...state.stack,
          {
            parent: action.parent,
            items: action.items,
            query: "",
            selectedIndex: 0,
          },
        ],
      };
    case "pop":
      return state.stack.length > 1 ? { stack: state.stack.slice(0, -1) } : state;
    case "set-query":
      return replaceTop({ ...top, query: action.query, selectedIndex: 0 });
    case "select":
      return replaceTop({ ...top, selectedIndex: action.index });
    case "move": {
      if (action.count === 0) {
        return state;
      }
      // Wrap around at both ends.
      const index = (top.selectedIndex + action.delta + action.count) % action.count;
      return replaceTop({ ...top, selectedIndex: index });
    }
  }
}

// ---- Recently used ----

const RECENT_KEY = `${KEY_WORKSPACE_PREFIX}studio.command-palette.recent`;
const MAX_RECENT = 30;

/** Reads recently used command ids, most recent first; empty if storage is unavailable. */
export function loadRecentCommandIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Moves `id` to the front of the recent list and persists it. */
export function pushRecentCommandId(recent: readonly string[], id: string): string[] {
  const next = [id, ...recent.filter((other) => other !== id)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next) ?? "[]");
  } catch {
    // Storage full or disabled: recents just won't persist.
  }
  return next;
}

// ---- Registry for commands contributed by other components ----

type RegistryState = { contributions: ReadonlyMap<string, readonly Command[]> };

export const useCommandRegistry = create<RegistryState>(() => ({
  contributions: new Map(),
}));

/**
 * Adds commands to the palette while the calling component is mounted. Memoize `commands`;
 * every new array re-registers.
 */
export function useRegisterCommands(key: string, commands: readonly Command[]): void {
  useEffect(() => {
    useCommandRegistry.setState(({ contributions }) => ({
      contributions: new Map(contributions).set(key, commands),
    }));
    return () => {
      useCommandRegistry.setState(({ contributions }) => {
        const next = new Map(contributions);
        next.delete(key);
        return { contributions: next };
      });
    };
  }, [key, commands]);
}
