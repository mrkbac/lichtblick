// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  chooseRecordingFolder,
  listLiveRecordings,
  LiveRecording,
  moveLiveRecordingsToFolder,
  parseLiveRecordingName,
  supportsRecordingFolder,
} from "@lichtblick/suite-base/players/liveHistory/liveRecordings";

import { FolderFile, indexFiles, loadPreview } from "./indexFolder";
import { CatalogRecording } from "./types";
import { CatalogFolder } from "./useCatalogFolder";

export type LiveCatalog = CatalogFolder & {
  /** Recordings being written right now; they can't be read until the session ends. */
  active: LiveRecording[];
  /** The finished recording behind a catalog entry, for download and delete. */
  recordingOf: (recording: CatalogRecording) => LiveRecording | undefined;
};

/**
 * A recording's catalog path, unique per copy: a recording can be both in browser storage and in
 * the user's folder (e.g. after a move that failed halfway), and actions must hit the right one.
 */
const pathOf = (rec: LiveRecording) => `${rec.location}/${rec.name}`;

/**
 * Live recordings as a catalog: indexed like a folder of recordings (topics, duration, thumbnails,
 * GPS tracks), titled by the machine they came from.
 */
export function useLiveCatalog(name: string): LiveCatalog {
  const { selectSource } = usePlayerSelection();
  const [live, setLive] = useState<LiveRecording[]>([]);
  const [recordings, setRecordings] = useState<CatalogRecording[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [error, setError] = useState<string>();
  const scanIdRef = useRef(0);

  const scan = useCallback(async ({ retryErrors = false }: { retryErrors?: boolean } = {}) => {
    const scanId = ++scanIdRef.current;
    const isStale = () => scanId !== scanIdRef.current;
    setError(undefined);
    try {
      const listed = await listLiveRecordings();
      if (isStale()) {
        return;
      }
      setLive(listed);
      const finished = listed.filter((rec) => !rec.active);
      const files: FolderFile[] = finished.map((rec) => ({ path: pathOf(rec), getFile: rec.file }));
      const asLive = (recording: CatalogRecording): CatalogRecording => {
        const { machine } = parseLiveRecordingName(recording.name);
        // The machine is the title; the file name stays below it as the path.
        return machine ? { ...recording, name: machine, machine } : recording;
      };
      setProgress({ done: 0, total: files.length });
      const ready: CatalogRecording[] = [];
      const flush = _.throttle(() => {
        if (!isStale()) {
          setRecordings([...ready]);
          setProgress({ done: ready.length, total: files.length });
        }
      }, 250);
      const results = await indexFiles(files, {
        retryErrors,
        isCancelled: isStale,
        onRecording: (recording) => {
          ready.push(asLive(recording));
          flush();
        },
      });
      flush.cancel();
      if (!isStale()) {
        setRecordings(results.map(asLive));
        setProgress(undefined);
      }
    } catch (err: unknown) {
      if (!isStale()) {
        setError(String(err));
        setProgress(undefined);
      }
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  const recordingOf = useCallback(
    (recording: CatalogRecording) => {
      const { source } = recording;
      return source.type === "local-file"
        ? live.find((rec) => !rec.active && pathOf(rec) === source.path)
        : undefined;
    },
    [live],
  );

  const fileOf = useCallback(
    (recording: CatalogRecording): FolderFile | undefined => {
      const rec = recordingOf(recording);
      return rec && { path: pathOf(rec), getFile: rec.file };
    },
    [recordingOf],
  );

  return useMemo(
    (): LiveCatalog => ({
      name,
      recordings,
      progress,
      error,
      active: live.filter((rec) => rec.active),
      recordingOf,
      // "Change folder" picks where finished recordings are moved to.
      pickFolder: async () => {
        // Browsers without a directory picker keep recordings in browser storage.
        if (!supportsRecordingFolder()) {
          return;
        }
        await chooseRecordingFolder();
        await moveLiveRecordingsToFolder();
        await scan();
      },
      reopenLastFolder: async () => {},
      rescan: async () => {
        await scan({ retryErrors: true });
      },
      open: async (recording) => {
        const file = fileOf(recording);
        if (file) {
          selectSource("mcap-local-file", { type: "file", files: [await file.getFile()] });
        }
      },
      loadPreview: async (recording, topic) => {
        const file = fileOf(recording);
        if (!file) {
          throw new Error("This recording is no longer available");
        }
        return await loadPreview(file, topic);
      },
      dropFolder: () => false,
      accessDenied: false,
      pickFolderWithInput: () => {},
    }),
    [name, recordings, progress, error, live, recordingOf, fileOf, scan, selectSource],
  );
}
