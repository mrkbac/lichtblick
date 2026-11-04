// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "zustand";

/**
 * The cut (trim range) shared by the timeline, playback and the export dialog.
 * Times are absolute nanoseconds. While a cut is set, playback stays inside it.
 */
export type TrimState = {
  start?: bigint;
  end?: bigint;
  /** The timeline shows the cut's handles and the trim bar. */
  editing: boolean;
  exportOpen: boolean;
  setRange: (start: bigint, end: bigint) => void;
  /** Show the handles, creating a cut of `start`..`end` if there is none yet. */
  startEditing: (start: bigint, end: bigint) => void;
  /** Hide the handles. The cut stays active. */
  stopEditing: () => void;
  /** Remove the cut. */
  clear: () => void;
  openExport: () => void;
  closeExport: () => void;
};

export const useTrimStore = create<TrimState>()((set) => ({
  editing: false,
  exportOpen: false,
  setRange: (start, end) => {
    set(start <= end ? { start, end } : { start: end, end: start });
  },
  startEditing: (start, end) => {
    set((state) => ({
      editing: true,
      start: state.start ?? start,
      end: state.end ?? end,
    }));
  },
  stopEditing: () => {
    set({ editing: false });
  },
  clear: () => {
    set({ editing: false, exportOpen: false, start: undefined, end: undefined });
  },
  openExport: () => {
    set({ exportOpen: true });
  },
  closeExport: () => {
    set({ exportOpen: false });
  },
}));

/** Clamps `ns` into the cut, if one is set. */
export function clampToCut(ns: bigint, { start, end }: Pick<TrimState, "start" | "end">): bigint {
  if (start != undefined && ns < start) {
    return start;
  }
  if (end != undefined && ns > end) {
    return end;
  }
  return ns;
}
