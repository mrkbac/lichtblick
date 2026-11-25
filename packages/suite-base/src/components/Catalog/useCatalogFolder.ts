// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAsync, useMountedState } from "@lichtblick/hooks";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { parseLiveRecordingName } from "@lichtblick/suite-base/players/liveHistory/liveRecordings";

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
import { CatalogBackend, CatalogRecording } from "./types";

function isAccessError(err: unknown): boolean {
  return (
    err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")
  );
}

/** Index a local folder of recordings, reopening the last one when the browser allows it. */
export function useCatalogFolder(slot?: string): CatalogBackend {
  const { selectSource } = usePlayerSelection();

  const [name, setName] = useState<string>();
  const [relist, setRelist] = useState<() => Promise<FolderFile[]>>();
  const [files, setFiles] = useState<FolderFile[]>([]);
  const [recordings, setRecordings] = useState<CatalogRecording[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [error, setError] = useState<string>();
  const [accessDenied, setAccessDenied] = useState(false);
  const [pickerClosed, setPickerClosed] = useState(false);
  const scanIdRef = useRef(0);
  const isMounted = useMountedState();

  const { value: lastFolder } = useAsync(async () => await loadLastFolder(slot), [slot]);

  const scan = useCallback(
    async (
      folderName: string,
      list: () => Promise<FolderFile[]>,
      { retryErrors = false }: { retryErrors?: boolean } = {},
    ) => {
      const scanId = ++scanIdRef.current;
      const isStale = () => !isMounted() || scanId !== scanIdRef.current;
      setName(folderName);
      setRelist(() => list);
      setError(undefined);
      setAccessDenied(false);
      setPickerClosed(false);
      try {
        const folderFiles = await list();
        if (isStale()) {
          return;
        }
        setFiles(folderFiles);
        setRecordings([]);
        setProgress({ done: 0, total: folderFiles.length });
        const withFolderMetadata = (recording: CatalogRecording): CatalogRecording => ({
          ...recording,
          machine: parseLiveRecordingName(recording.name).machine,
          dataset: recording.id.includes("/")
            ? recording.id.slice(0, recording.id.lastIndexOf("/"))
            : folderName,
        });
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
            ready.push(withFolderMetadata(recording));
            flush();
          },
        });
        flush.cancel();
        if (!isStale()) {
          setRecordings(results.map(withFolderMetadata));
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
    [isMounted],
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
    const controller = new AbortController();
    void (async () => {
      if (
        (await lastFolder.queryPermission({ mode: "read" })) === "granted" &&
        !controller.signal.aborted
      ) {
        await openDirectory(lastFolder);
      }
    })().catch((err: unknown) => {
      if (!controller.signal.aborted) {
        setError(String(err));
      }
    });
    return () => {
      controller.abort();
    };
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
      // A cancel isn't an error, but it can't be told apart from a browser aborting the picker.
      const closed = err instanceof DOMException && err.name === "AbortError";
      setPickerClosed(closed);
      setAccessDenied(!closed && isAccessError(err));
      setError(String(err));
      return;
    }
    // Remembering the folder is a convenience; open it even if that fails.
    await saveLastFolder(dir, slot).catch((err: unknown) => {
      console.warn("Failed to remember the catalog folder", err);
    });
    await openDirectory(dir);
  }, [openDirectory, pickFolderWithInput, slot]);

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
          : Promise.resolve(null);
      void scan(entry.name, async () => {
        const dir = await handle;
        if (dir?.kind === "directory") {
          try {
            const listed = await listDirectory(dir as FileSystemDirectoryHandle);
            await saveLastFolder(dir as FileSystemDirectoryHandle, slot).catch((err: unknown) => {
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
    [scan, slot],
  );

  const reopenLastFolder = useCallback(async () => {
    if (!lastFolder) {
      return;
    }
    // A refused or failed permission request must show, not leave the previous banner up.
    let permission: PermissionState;
    try {
      permission = await lastFolder.requestPermission({ mode: "read" });
    } catch (err: unknown) {
      setPickerClosed(false);
      setAccessDenied(isAccessError(err));
      setError(String(err));
      return;
    }
    if (permission !== "granted") {
      setPickerClosed(false);
      setAccessDenied(true);
      setError(`Read permission for ${lastFolder.name}: ${permission}`);
      return;
    }
    await openDirectory(lastFolder);
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
            params: { url: source.url, name: recording.name },
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
    pickerClosed,
    dropFolder,
    reopenLastFolder,
    rescan,
    open,
  };
}
