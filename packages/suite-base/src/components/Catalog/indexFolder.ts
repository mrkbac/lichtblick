// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { createStore, get as idbGet, set as idbSet } from "idb-keyval";

import { KEY_WORKSPACE_PREFIX } from "@lichtblick/suite-base/constants/browserStorageKeys";

import { summarizeMcap } from "./summarizeMcap";
import { CatalogRecording, CatalogSummary } from "./types";

/** A recording file in a picked folder. */
export type FolderFile = {
  /** Path relative to the picked folder, using "/" separators. */
  path: string;
  getFile: () => Promise<File>;
  /** Present when the folder came from showDirectoryPicker(); lets the file show up in recents. */
  handle?: FileSystemFileHandle; // foxglove-depcheck-used: @types/wicg-file-system-access
};

const DB_NAME = `${KEY_WORKSPACE_PREFIX}lichtblick-catalog`;
const summaryStore = createStore(DB_NAME, "summaries");
const folderStore = createStore(`${DB_NAME}-folders`, "folders");
const LAST_FOLDER_KEY = "last";

const CONCURRENCY = 4;

function isMcap(name: string): boolean {
  return name.toLowerCase().endsWith(".mcap");
}

export async function listDirectory(
  dir: FileSystemDirectoryHandle,
  prefix = "",
): Promise<FolderFile[]> {
  const files: FolderFile[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === "directory") {
      files.push(...(await listDirectory(entry, `${prefix}${entry.name}/`)));
    } else if (isMcap(entry.name)) {
      files.push({
        path: `${prefix}${entry.name}`,
        getFile: async () => await entry.getFile(),
        handle: entry,
      });
    }
  }
  return files;
}

/** Files from an `<input webkitdirectory>`, for browsers without showDirectoryPicker(). */
export function listInputFiles(fileList: Iterable<File>): FolderFile[] {
  return [...fileList]
    .filter((file) => isMcap(file.name))
    .map((file) => ({
      // webkitRelativePath starts with the picked folder's name; drop it like listDirectory does.
      path: file.webkitRelativePath.split("/").slice(1).join("/") || file.name,
      getFile: async () => file,
    }));
}

export async function saveLastFolder(dir: FileSystemDirectoryHandle): Promise<void> {
  await idbSet(LAST_FOLDER_KEY, dir, folderStore);
}

export async function loadLastFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  return await idbGet<FileSystemDirectoryHandle>(LAST_FOLDER_KEY, folderStore);
}

async function indexFile(
  entry: FolderFile,
  { retryErrors }: { retryErrors: boolean },
): Promise<CatalogRecording> {
  const name = entry.path.split("/").pop() ?? entry.path;
  const base = { id: entry.path, name, source: { type: "local-file" as const, path: entry.path } };

  let file: File;
  try {
    file = await entry.getFile();
  } catch (err: unknown) {
    return { ...base, error: String(err) };
  }

  // Same name, size and modification time means the same content: reuse the cached summary. The
  // path is left out because it is relative to the picked folder, so opening a parent or a moved
  // folder still hits the cache.
  const key = `${file.name}|${file.size}|${file.lastModified}`;
  // The cache is only an optimization, so a failing IndexedDB never fails the scan.
  let summary = await idbGet<CatalogSummary>(key, summaryStore).catch((err: unknown) => {
    console.warn("Catalog cache read failed", err);
    return undefined;
  });
  if (!summary || (summary.error != undefined && retryErrors)) {
    try {
      summary = await summarizeMcap(file);
    } catch (err: unknown) {
      summary = { error: err instanceof Error ? err.message : String(err) };
    }
    await idbSet(key, summary, summaryStore).catch((err: unknown) => {
      console.warn("Catalog cache write failed", err);
    });
  }
  return { ...base, size: file.size, ...summary };
}

/**
 * Summarize every file, reading a few at a time. Results come back in input order; `onRecording`
 * reports each one as soon as it is ready. Once `isCancelled` returns true no new files are read,
 * and the result has gaps for the files that were skipped.
 */
export async function indexFiles(
  files: readonly FolderFile[],
  opts: {
    retryErrors?: boolean;
    onRecording?: (recording: CatalogRecording) => void;
    isCancelled?: () => boolean;
  } = {},
): Promise<CatalogRecording[]> {
  const results = new Array<CatalogRecording>(files.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
      while (next < files.length && opts.isCancelled?.() !== true) {
        const index = next++;
        const recording = await indexFile(files[index]!, {
          retryErrors: opts.retryErrors ?? false,
        });
        results[index] = recording;
        opts.onRecording?.(recording);
      }
    }),
  );
  return results;
}
