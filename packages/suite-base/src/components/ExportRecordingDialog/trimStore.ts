// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "zustand";

/** Trim mode state shared by the timeline and the export dialog. Times are absolute ns. */
export type TrimState = {
  /** The timeline shows the trim range and its handles. */
  active: boolean;
  start?: bigint;
  end?: bigint;
  exportOpen: boolean;
  setRange: (start: bigint, end: bigint) => void;
  /** Enter trim mode, keeping an existing range. */
  enter: () => void;
  exit: () => void;
  /** Open the export dialog, entering trim mode. */
  openExport: () => void;
  closeExport: () => void;
};

export const useTrimStore = create<TrimState>()((set) => ({
  active: false,
  exportOpen: false,
  setRange: (start, end) => {
    set(start <= end ? { start, end } : { start: end, end: start });
  },
  enter: () => {
    set({ active: true });
  },
  exit: () => {
    set({ active: false, exportOpen: false, start: undefined, end: undefined });
  },
  openExport: () => {
    set({ exportOpen: true, active: true });
  },
  closeExport: () => {
    set({ exportOpen: false });
  },
}));
