// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// React's scheduler picks setImmediate when it exists, and playback currently depends on the
// resulting microtask timing: with the scheduler's MessageChannel fallback, Play no longer starts.
// Import this first in every app entry, before react-dom loads.
// ponytail: keeps the old timing; drop it once playback works with the default scheduler.
const global = globalThis as { setImmediate?: (callback: () => void) => void };
global.setImmediate ??= (callback) => {
  queueMicrotask(callback);
};

export {};
