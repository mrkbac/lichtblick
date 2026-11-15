// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { ChunkCache } from "./ChunkCache.ts";
import { McapIndexedReader } from "./McapIndexedReader.ts";
import type { DecompressHandlers, IReadable } from "./types.ts";

/**
 * Opens an indexed reader whose decompressed chunks go into `chunkCache`. The only way to open
 * one (a lint rule bans McapIndexedReader elsewhere), so no reader decompresses chunks another
 * reader of the same file already has. Keep one ChunkCache per open file and pass it to every
 * reader on that file.
 */
export async function openCachedMcapReader(args: {
  readable: IReadable;
  decompressHandlers?: DecompressHandlers;
  chunkCache: ChunkCache;
}): Promise<McapIndexedReader> {
  return await McapIndexedReader.Initialize(args);
}
