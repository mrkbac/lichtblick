// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { createStore } from "zustand";

export const LIVE_HISTORY_DEFAULT_SEC = 30;
export const LIVE_HISTORY_MIN_SEC = 1;
export const LIVE_HISTORY_MAX_SEC = 3600;
export const LIVE_HISTORY_MAX_BYTES = 128 * 1024 * 1024;

export function clampLiveHistorySec(sec: number): number {
  if (!Number.isFinite(sec)) {
    return LIVE_HISTORY_DEFAULT_SEC;
  }
  return Math.min(LIVE_HISTORY_MAX_SEC, Math.max(LIVE_HISTORY_MIN_SEC, Math.round(sec)));
}

const STORAGE_KEY = "lichtblick.liveHistory.windowSec";

function loadWindowSec(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved == undefined ? LIVE_HISTORY_DEFAULT_SEC : clampLiveHistorySec(Number(saved));
  } catch {
    return LIVE_HISTORY_DEFAULT_SEC;
  }
}

type LiveHistorySettings = {
  windowSec: number;
  setWindowSec: (sec: number) => void;
};

/** Saved length of the live history window; players subscribe to follow changes. */
export const liveHistorySettings = createStore<LiveHistorySettings>()((set) => ({
  windowSec: loadWindowSec(),
  setWindowSec: (sec) => {
    const windowSec = clampLiveHistorySec(sec);
    set({ windowSec });
    try {
      localStorage.setItem(STORAGE_KEY, String(windowSec));
    } catch {
      // Not persisted (e.g. storage disabled); the setting still applies to this session.
    }
  },
}));
