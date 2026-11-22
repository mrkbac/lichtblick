// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@foxglove/comlink";
import { useMemo } from "react";

import {
  BlobReadable,
  IWritable,
  type McapIndexedReader,
  type McapTypes,
} from "@lichtblick/mcap-core";
import { ChunkJob, ExportMcapOptions, ExportTopicOptions } from "@lichtblick/mcap-support";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { downloadFiles } from "@lichtblick/suite-base/util/download";

import type { ExportChunkWorker } from "./exportChunk.worker";

/** The opened file, if it can be exported: currently a single local MCAP file. */
export function useExportableFile(): File | undefined {
  const { selectedFiles } = usePlayerSelection();
  // ponytail: single file only; merging several open files is a later step.
  const file = selectedFiles?.length === 1 ? selectedFiles[0] : undefined;
  return file && /\.mcap$/i.test(file.name) ? file : undefined;
}

/** An MCAP recording the export dialog can read: a local file or a remote URL. */
export type ExportReadable = McapTypes.IReadable & { close?: () => void };

export type ExportSource = {
  name: string;
  /** The caller closes what it opens; aborting `signal` cancels an open in progress */
  open: (signal: AbortSignal) => Promise<ExportReadable>;
  /** Read every message index up front for exact counts: cheap locally, payload-heavy remotely */
  exactCounts: boolean;
};

// Export reads the file's own index: only offered once the player says it has a complete one.
const selectFooterIndexed = (ctx: MessagePipelineContext) => {
  const files = ctx.playerState.activeData?.recordingFiles;
  return files?.length === 1 && files[0]!.footerIndexed === true;
};

/** The last path segment, decoded when it is valid percent-encoding */
export function remoteFileName(url: string): string {
  const pathname = new URL(url).pathname;
  const raw = pathname.slice(pathname.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The opened recording, if it can be exported: a single local or remote MCAP file. */
export function useExportSource(): ExportSource | undefined {
  const file = useExportableFile();
  const { selectedRemoteFile } = usePlayerSelection();
  const footerIndexed = useMessagePipeline(selectFooterIndexed);
  return useMemo(() => {
    if (!footerIndexed) {
      return undefined;
    }
    if (file) {
      return { name: file.name, exactCounts: true, open: async () => new BlobReadable(file) };
    }
    if (!selectedRemoteFile) {
      return undefined;
    }
    const { url, credentials } = selectedRemoteFile;
    if (!/\.mcap$/i.test(new URL(url).pathname)) {
      return undefined;
    }
    return {
      name: remoteFileName(url),
      // Message indexes sit between chunks: reading them all would fetch much of the payload.
      exactCounts: false,
      open: async (signal) => {
        // Its own reader: the player's cache and prefetching stay untouched by the export.
        // No read-ahead: opening reads only the summary and indexes, never the whole file.
        // Loaded on demand: the HTTP reader stays out of the startup bundle.
        const { RemoteFileReadable } = await import(
          "@lichtblick/suite-base/players/IterablePlayer/Mcap/RemoteFileReadable"
        );
        signal.throwIfAborted();
        const readable = new RemoteFileReadable(url, {
          credentials,
          readAheadEnabled: false,
          signal,
        });
        try {
          await readable.open();
          signal.throwIfAborted();
        } catch (error) {
          readable.close();
          throw error;
        }
        return readable;
      },
    };
  }, [file, selectedRemoteFile, footerIndexed]);
}

/**
 * Runs chunk rewrites (decompress, filter, recompress) on all but one core.
 * Call `terminate` when done.
 */
export function createChunkWorkerPool(): Required<
  Pick<ExportMcapOptions, "processChunk" | "concurrency">
> & { terminate: () => void } {
  const size = Math.max(1, Math.min(8, navigator.hardwareConcurrency - 1));
  const workers = Array.from(
    { length: size },
    () => new Worker(new URL("./exportChunk.worker", import.meta.url)),
  );
  const remotes = workers.map((worker) => Comlink.wrap<ExportChunkWorker>(worker));
  // Load each worker's WASM now rather than on its first chunk.
  remotes.forEach((remote) => {
    void remote.warmUp();
  });
  let next = 0;
  // Terminated workers never answer, so pending requests fail instead of hanging the export.
  let rejectPending: (reason: Error) => void = () => {};
  const terminated = new Promise<never>((_resolve, reject) => {
    rejectPending = reject;
  });
  terminated.catch(() => {});
  return {
    concurrency: size,
    // Chunks are queued in order and kept at most 2 per worker, so round robin balances well.
    processChunk: async (job: ChunkJob) => {
      const remote = remotes[next++ % remotes.length]!;
      return await Promise.race([
        remote.rewriteChunk(Comlink.transfer(job, [job.records.buffer])),
        terminated,
      ]);
    },
    terminate: () => {
      rejectPending(new Error("Export cancelled"));
      workers.forEach((worker) => {
        worker.terminate();
      });
    },
  };
}

export type TopicRow = {
  topic: string;
  channelIds: number[];
  schemaName: string;
  messageCount: number;
};

export type TopicEdit = {
  keep: boolean;
  rename: string;
  everyNth: number;
};

/** One row per topic, with message counts summed over all channels of that topic. */
export function getTopicRows(reader: McapIndexedReader): TopicRow[] {
  const rows = new Map<string, TopicRow>();
  for (const channel of reader.channelsById.values()) {
    const row = rows.get(channel.topic) ?? {
      topic: channel.topic,
      channelIds: [],
      schemaName: reader.schemasById.get(channel.schemaId)?.name ?? "",
      messageCount: 0,
    };
    row.channelIds.push(channel.id);
    row.messageCount += Number(reader.statistics?.channelMessageCounts.get(channel.id) ?? 0n);
    rows.set(channel.topic, row);
  }
  return [...rows.values()].sort((a, b) => a.topic.localeCompare(b.topic));
}

/** A case-insensitive regex for the topic filter; text that isn't a valid regex matches literally */
export function topicFilterPattern(filter: string): RegExp {
  try {
    return new RegExp(filter, "i");
  } catch {
    return new RegExp(filter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

/** Topic options for `exportMcap`, containing only kept topics. */
export function toExportTopics(
  edits: ReadonlyMap<string, TopicEdit>,
): Map<string, ExportTopicOptions> {
  const topics = new Map<string, ExportTopicOptions>();
  for (const [topic, edit] of edits) {
    if (edit.keep) {
      topics.set(topic, { outputTopic: edit.rename.trim() || undefined, everyNth: edit.everyNth });
    }
  }
  return topics;
}

/** Output topic names that more than one kept input topic would be written to. */
export function findDuplicateOutputTopics(
  topics: ReadonlyMap<string, ExportTopicOptions>,
): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const [topic, options] of topics) {
    const output = options.outputTopic ?? topic;
    if (seen.has(output)) {
      duplicates.add(output);
    }
    seen.add(output);
  }
  return duplicates;
}

export type ExportOutput = {
  writable: IWritable;
  close: () => Promise<void>;
  abort: () => Promise<void>;
};

/**
 * Asks the user where to save the file. Streams to disk where the File System Access API is
 * available; otherwise collects the file in memory and downloads it when closed.
 * Returns undefined if the user cancels the save dialog.
 */
export async function openExportOutput(fileName: string): Promise<ExportOutput | undefined> {
  if ("showSaveFilePicker" in window) {
    let handle: FileSystemFileHandle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: "MCAP", accept: { "application/octet-stream": [".mcap"] } }],
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return undefined;
      }
      throw err;
    }
    const stream = await handle.createWritable();
    let position = 0n;
    return {
      writable: {
        position: () => position,
        write: async (buffer) => {
          // McapWriter never hands out SharedArrayBuffer views.
          await stream.write(buffer as Uint8Array<ArrayBuffer>);
          position += BigInt(buffer.byteLength);
        },
      },
      close: async () => {
        await stream.close();
      },
      abort: async () => {
        await stream.abort();
      },
    };
  }

  // ponytail: whole file held in memory; browsers without showSaveFilePicker can't stream to disk.
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let position = 0n;
  return {
    writable: {
      position: () => position,
      write: async (buffer) => {
        // McapWriter reuses its buffer after write() resolves, so keep a copy.
        parts.push(buffer.slice());
        position += BigInt(buffer.byteLength);
      },
    },
    close: async () => {
      downloadFiles([{ blob: new Blob(parts), fileName }]);
    },
    abort: async () => {
      parts.length = 0;
    },
  };
}

/** "drive.mcap" -> "drive-export.mcap" */
export function exportFileName(inputName: string): string {
  return `${inputName.replace(/\.mcap$/i, "")}-export.mcap`;
}
