// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@foxglove/comlink";

import {
  ChunkJob,
  ChunkResult,
  loadRewriteChunkDeps,
  rewriteChunk,
} from "@lichtblick/mcap-support";

const deps = loadRewriteChunkDeps();

const api = {
  async warmUp(): Promise<void> {
    await deps;
  },
  async rewriteChunk(job: ChunkJob): Promise<ChunkResult> {
    const result = rewriteChunk(job, await deps);
    return Comlink.transfer(result, [result.bytes.buffer]);
  },
};

export type ExportChunkWorker = typeof api;

Comlink.expose(api);
