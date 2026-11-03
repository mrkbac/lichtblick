// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAsync } from "react-use";

import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";

import {
  FolderFile,
  indexFiles,
  listDirectory,
  listEntry,
  listInputFiles,
  loadLastFolder,
  loadPreview,
  saveLastFolder,
} from "./indexFolder";
import { PreviewFrame } from "./preview";
import { CatalogRecording } from "./types";

export type CatalogFolder = {
  /** Name of the open folder; undefined until one is picked or reopened. */
  name?: string;
  /** The folder picked last time, which may need a click to grant access again. */
  lastFolder?: FileSystemDirectoryHandle;
  recordings: CatalogRecording[];
  progress?: { done: number; total: number };
  error?: string;
  pickFolder: () => Promise<void>;
  reopenLastFolder: () => Promise<void>;
  /** Look for new files and retry failed ones; undefined while no folder is open. */
  rescan?: () => Promise<void>;
  open: (recording: CatalogRecording) => Promise<void>;
  /** Preview frames of one of a recording's image topics. */
  loadPreview: (recording: CatalogRecording, topic: string) => Promise<PreviewFrame[]>;
  /**
   * Open a folder dropped from the file manager. Returns whether the drop held one, synchronously,
   * so the caller can stop the drop from also opening its files.
   */
  dropFolder: (dataTransfer: DataTransfer) => boolean;
  /** The browser refused to read the picked folder; `pickFolderWithInput` may still work. */
  accessDenied: boolean;
  /** Pick a folder with the classic upload dialog, which works where folder handles don't. */
  pickFolderWithInput: () => void;
};

function isAccessError(err: unknown): boolean {
  return (
    err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")
  );
}

/** Index a local folder of recordings, reopening the last one when the browser allows it. */
export function useCatalogFolder(): CatalogFolder {
  const { selectSource } = usePlayerSelection();

  const [name, setName] = useState<string>();
  const [relist, setRelist] = useState<() => Promise<FolderFile[]>>();
  const [files, setFiles] = useState<FolderFile[]>([]);
  const [recordings, setRecordings] = useState<CatalogRecording[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [error, setError] = useState<string>();
  const [accessDenied, setAccessDenied] = useState(false);
  const scanIdRef = useRef(0);

  const { value: lastFolder } = useAsync(loadLastFolder, []);

  const scan = useCallback(
    async (
      folderName: string,
      list: () => Promise<FolderFile[]>,
      { retryErrors = false }: { retryErrors?: boolean } = {},
    ) => {
      const scanId = ++scanIdRef.current;
      const isStale = () => scanId !== scanIdRef.current;
      setName(folderName);
      setRelist(() => list);
      setError(undefined);
      setAccessDenied(false);
      try {
        const folderFiles = await list();
        if (isStale()) {
          return;
        }
        setFiles(folderFiles);
        setRecordings([]);
        setProgress({ done: 0, total: folderFiles.length });
        const ready: CatalogRecording[] = [];
        const flush = _.throttle(() => {
          if (!isStale()) {
            setRecordings([...ready]);
            setProgress({ done: ready.length, total: folderFiles.length });
          }
        }, 250);
        const results = await indexFiles(folderFiles, {
          retryErrors,
          isCancelled: isStale,
          onRecording: (recording) => {
            ready.push(recording);
            flush();
          },
        });
        flush.cancel();
        if (!isStale()) {
          setRecordings(results);
          setProgress(undefined);
        }
      } catch (err: unknown) {
        if (!isStale()) {
          setAccessDenied(isAccessError(err));
          setError(String(err));
          setProgress(undefined);
        }
      }
    },
    [],
  );

  const openDirectory = useCallback(
    async (dir: FileSystemDirectoryHandle) => {
      await scan(dir.name, async () => await listDirectory(dir));
    },
    [scan],
  );

  // Reopen the last folder without a click when the browser still grants access, e.g. when
  // coming back to the start page after opening a recording.
  useEffect(() => {
    if (!lastFolder) {
      return;
    }
    void (async () => {
      if ((await lastFolder.queryPermission({ mode: "read" })) === "granted") {
        await openDirectory(lastFolder);
      }
    })();
  }, [lastFolder, openDirectory]);

  const pickFolderWithInput = useCallback(() => {
    // Browsers without the File System Access API can still upload a whole folder.
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.webkitdirectory = true;
    input.onchange = () => {
      const fileList = [...(input.files ?? [])];
      const folderName = fileList[0]?.webkitRelativePath.split("/")[0] ?? "";
      void scan(folderName, async () => listInputFiles(fileList));
    };
    input.click();
  }, [scan]);

  const pickFolder = useCallback(async () => {
    if (!("showDirectoryPicker" in window)) {
      pickFolderWithInput();
      return;
    }
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await window.showDirectoryPicker({ mode: "read" });
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setAccessDenied(isAccessError(err));
        setError(String(err));
      }
      return;
    }
    // Remembering the folder is a convenience; open it even if that fails.
    await saveLastFolder(dir).catch((err: unknown) => {
      console.warn("Failed to remember the catalog folder", err);
    });
    await openDirectory(dir);
  }, [openDirectory, pickFolderWithInput]);

  const dropFolder = useCallback(
    (dataTransfer: DataTransfer) => {
      const item = [...dataTransfer.items].find((i) => i.webkitGetAsEntry()?.isDirectory === true);
      const entry = item?.webkitGetAsEntry() as FileSystemDirectoryEntry | null | undefined;
      if (!item || !entry) {
        return false;
      }
      // Both must be taken while the drop event is dispatched; they are read after.
      const handle =
        window.isSecureContext && "getAsFileSystemHandle" in item
          ? item.getAsFileSystemHandle()
          : Promise.resolve(ReactNull);
      void scan(entry.name, async () => {
        const dir = await handle;
        if (dir?.kind === "directory") {
          try {
            const listed = await listDirectory(dir as FileSystemDirectoryHandle);
            await saveLastFolder(dir as FileSystemDirectoryHandle).catch((err: unknown) => {
              console.warn("Failed to remember the catalog folder", err);
            });
            return listed;
          } catch (err: unknown) {
            if (!isAccessError(err)) {
              throw err;
            }
          }
        }
        return await listEntry(entry);
      });
      return true;
    },
    [scan],
  );

  const reopenLastFolder = useCallback(async () => {
    if (lastFolder && (await lastFolder.requestPermission({ mode: "read" })) === "granted") {
      await openDirectory(lastFolder);
    }
  }, [lastFolder, openDirectory]);

  const rescan = useMemo(
    () =>
      name != undefined && relist != undefined
        ? async () => {
            await scan(name, relist, { retryErrors: true });
          }
        : undefined,
    [name, relist, scan],
  );

  const open = useCallback(
    async (recording: CatalogRecording) => {
      const { source } = recording;
      switch (source.type) {
        case "local-file": {
          const file = files.find((f) => f.path === source.path);
          if (!file) {
            return;
          }
          selectSource(
            "mcap-local-file",
            file.handle
              ? { type: "file", handles: [file.handle] }
              : { type: "file", files: [await file.getFile()] },
          );
          break;
        }
        case "remote-file":
        case "foxglove-websocket":
          selectSource(source.type, {
            type: "connection",
            params: { url: source.url },
          });
          break;
      }
    },
    [files, selectSource],
  );

  const loadRecordingPreview = useCallback(
    async (recording: CatalogRecording, topic: string) => {
      const { source } = recording;
      const file =
        source.type === "local-file" ? files.find((f) => f.path === source.path) : undefined;
      if (!file) {
        throw new Error("Only recordings in the open folder have a preview");
      }
      return await loadPreview(file, topic);
    },
    [files],
  );

  return {
    loadPreview: loadRecordingPreview,
    name,
    lastFolder,
    recordings,
    progress,
    error,
    pickFolder,
    pickFolderWithInput,
    accessDenied,
    dropFolder,
    reopenLastFolder,
    rescan,
    open,
  };
}
