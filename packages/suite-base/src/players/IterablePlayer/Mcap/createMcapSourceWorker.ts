// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Starts the worker that reads MCAP files. Every MCAP data source starts it here, so the build has
 * one copy of it. Its name ends in "-worker", which keeps it in one file (see `splitChunks` in
 * rspack.ts): it starts on every file open, and each extra file is another blocking request.
 */
export function createMcapSourceWorker(): Worker {
  return new Worker(
    /* webpackChunkName: "mcap-source-worker" */ new URL(
      "./McapIterableSourceWorker.worker",
      import.meta.url,
    ),
  );
}
