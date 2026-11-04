// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { IWritable, McapIndexedReader } from "@mcap/core";

import * as Comlink from "@lichtblick/comlink";
import { ChunkJob, ExportMcapOptions, ExportTopicOptions } from "@lichtblick/mcap-support";
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
  return {
    concurrency: size,
    // Chunks are queued in order and kept at most 2 per worker, so round robin balances well.
    processChunk: async (job: ChunkJob) => {
      const remote = remotes[next++ % remotes.length]!;
      return await remote.rewriteChunk(Comlink.transfer(job, [job.records.buffer]));
    },
    terminate: () => {
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
