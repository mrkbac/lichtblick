// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { createStore } from "zustand";

export const LIVE_HISTORY_DEFAULT_SEC = 30;
export const LIVE_HISTORY_MIN_SEC = 1;
export const LIVE_HISTORY_MAX_SEC = 3600;
export const LIVE_HISTORY_WINDOW_OPTIONS_SEC = [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600];

export const LIVE_HISTORY_DEFAULT_MIB = 128;
export const LIVE_HISTORY_MIN_MIB = 16;
export const LIVE_HISTORY_MAX_MIB = 8192;
export const LIVE_HISTORY_MEMORY_OPTIONS_MIB = [64, 128, 256, 512, 1024, 2048, 4096];

const clamp = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

export const clampLiveHistorySec = (sec: number): number =>
  clamp(sec, LIVE_HISTORY_MIN_SEC, LIVE_HISTORY_MAX_SEC, LIVE_HISTORY_DEFAULT_SEC);

export const clampLiveHistoryMiB = (mib: number): number =>
  clamp(mib, LIVE_HISTORY_MIN_MIB, LIVE_HISTORY_MAX_MIB, LIVE_HISTORY_DEFAULT_MIB);

export const formatLiveHistoryWindow = (sec: number): string =>
  sec < 60 ? `${sec} s` : sec < 3600 ? `${sec / 60} min` : `${sec / 3600} h`;

export const formatLiveHistoryMemory = (mib: number): string =>
  mib < 1024 ? `${mib} MiB` : `${mib / 1024} GiB`;

const WINDOW_KEY = "lichtblick.liveHistory.windowSec";
const MEMORY_KEY = "lichtblick.liveHistory.maxMiB";

function load(key: string, clampValue: (value: number) => number, fallback: number): number {
  try {
    const saved = localStorage.getItem(key);
    return saved == undefined ? fallback : clampValue(Number(saved));
  } catch {
    return fallback;
  }
}

function save(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Not persisted (e.g. storage disabled); the setting still applies to this session.
  }
}

type LiveHistorySettings = {
  windowSec: number;
  maxMiB: number;
  setWindowSec: (sec: number) => void;
  setMaxMiB: (mib: number) => void;
};

/** Saved length and memory limit of the live history; players subscribe to follow changes. */
export const liveHistorySettings = createStore<LiveHistorySettings>()((set) => ({
  windowSec: load(WINDOW_KEY, clampLiveHistorySec, LIVE_HISTORY_DEFAULT_SEC),
  maxMiB: load(MEMORY_KEY, clampLiveHistoryMiB, LIVE_HISTORY_DEFAULT_MIB),
  setWindowSec: (sec) => {
    const windowSec = clampLiveHistorySec(sec);
    set({ windowSec });
    save(WINDOW_KEY, windowSec);
  },
  setMaxMiB: (mib) => {
    const maxMiB = clampLiveHistoryMiB(mib);
    set({ maxMiB });
    save(MEMORY_KEY, maxMiB);
  },
}));
