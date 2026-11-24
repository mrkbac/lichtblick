// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// What the app bar and playback controls need to offer an export: kept apart from the export
// itself (exportRecording.ts), which loads with the dialog.

import { useMemo } from "react";

import { BlobReadable, type McapTypes } from "@lichtblick/mcap-core";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { recordingName } from "@lichtblick/suite-base/util/compareSides";

/** The opened file, if it can be exported: currently a single local MCAP file. */
export function useExportableFile(): File | undefined {
  const { selectedRecordings } = usePlayerSelection();
  // A single file only: several open files would have to be merged into one recording.
  const file = selectedRecordings?.length === 1 ? selectedRecordings[0] : undefined;
  return typeof file === "object" && /\.mcap$/i.test(file.name) ? file : undefined;
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
      name: recordingName(url),
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
