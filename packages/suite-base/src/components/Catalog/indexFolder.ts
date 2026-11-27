// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { promiseTimeout } from "@lichtblick/den/async";
import { pushAll } from "@lichtblick/den/collection";
import { createKeyValueStore } from "@lichtblick/suite-base/util/idbKeyValueStore";

import { PreviewFrame, Previews, previewMcap } from "./preview";
import { summarizeMcap } from "./summarizeMcap";
import { CatalogRecording, CatalogSummary } from "./types";

/** A recording file in a picked folder. */
export type FolderFile = {
  /** Path relative to the picked folder, using "/" separators. */
  path: string;
  getFile: () => Promise<File>;
  /** Present when the folder came from showDirectoryPicker(); lets the file show up in recents. */
  handle?: FileSystemFileHandle;
};

const DB_NAME = "lichtblick-catalog";
const summaryStore = createKeyValueStore(DB_NAME, "summaries");
const folderStore = createKeyValueStore(`${DB_NAME}-folders`, "folders");
// Kept apart from the summaries, which are all read on every scan; previews are read one at a time.
const previewStore = createKeyValueStore(`${DB_NAME}-previews`, "previews");
const LAST_FOLDER_KEY = "last";

const CONCURRENCY = 4;
// Bump when CatalogSummary gains fields, so cached summaries are read again.
const CACHE_VERSION = 7;

function isMcap(name: string): boolean {
  return name.toLowerCase().endsWith(".mcap");
}

export async function listDirectory(
  dir: FileSystemDirectoryHandle,
  prefix = "",
  /** Stops the walk between entries (an outstanding native read still finishes) */
  signal?: AbortSignal,
): Promise<FolderFile[]> {
  const files: FolderFile[] = [];
  for await (const entry of dir.values()) {
    signal?.throwIfAborted();
    if (entry.kind === "directory") {
      pushAll(files, await listDirectory(entry, `${prefix}${entry.name}/`, signal));
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

/**
 * Files in a dropped folder, read with the older entries API. Browsers that refuse to read a
 * directory handle (e.g. some embedded ones) still allow this.
 */
export async function listEntry(dir: FileSystemDirectoryEntry, prefix = ""): Promise<FolderFile[]> {
  const reader = dir.createReader();
  const entries: FileSystemEntry[] = [];
  // readEntries returns the entries in batches, then an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) {
      break;
    }
    pushAll(entries, batch);
  }
  const files: FolderFile[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) {
      pushAll(files, await listEntry(entry as FileSystemDirectoryEntry, `${prefix}${entry.name}/`));
    } else if (isMcap(entry.name)) {
      files.push({
        path: `${prefix}${entry.name}`,
        getFile: async () =>
          await new Promise<File>((resolve, reject) => {
            (entry as FileSystemFileEntry).file(resolve, reject);
          }),
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

export async function saveLastFolder(
  dir: FileSystemDirectoryHandle,
  slot = LAST_FOLDER_KEY,
): Promise<void> {
  await folderStore.set(slot, dir);
}

export async function loadLastFolder(
  slot = LAST_FOLDER_KEY,
): Promise<FileSystemDirectoryHandle | undefined> {
  return await folderStore.get<FileSystemDirectoryHandle>(slot);
}

export async function forgetCatalogFolder(slot: string): Promise<void> {
  await folderStore.delete(slot);
}

// A handle to a moved file or a detached drive can hang on every call instead of failing
export const HANDLE_TIMEOUT_MS = 3000;
/** Walking a whole folder: long enough for a big local tree, bounded for a detached drive */
const LIST_TIMEOUT_MS = 30_000;

/** The only file named `name` in a remembered catalog folder the browser still grants. */
async function findInCatalogFolders(name: string): Promise<FileSystemFileHandle | undefined> {
  const folders = (await (await folderStore.readwrite()).getAll()) as FileSystemDirectoryHandle[];
  for (const dir of folders) {
    try {
      if (
        (await promiseTimeout(dir.queryPermission({ mode: "read" }), HANDLE_TIMEOUT_MS)) !==
        "granted"
      ) {
        continue;
      }
      const walk = new AbortController();
      const files = await promiseTimeout(
        listDirectory(dir, "", walk.signal),
        LIST_TIMEOUT_MS,
      ).finally(() => {
        // Stop a walk the timeout gave up on, so it doesn't run on beside the next folder's
        walk.abort();
      });
      const matches = files.filter((f) => f.path.split("/").at(-1) === name);
      if (matches.length === 1) {
        return matches[0]!.handle;
      }
    } catch {
      // An unreadable folder can't hold the file; try the next one
    }
  }
  return undefined;
}

/**
 * `handle`, or when it no longer reads (its file was moved or deleted, or its folder unlinked) the
 * file of the same name in a remembered catalog folder, so picking that folder again relinks
 * recents. Throws when neither works.
 */
export async function relinkFileHandle(
  handle: FileSystemFileHandle,
): Promise<FileSystemFileHandle> {
  try {
    const permission = await promiseTimeout(
      handle.queryPermission({ mode: "read" }),
      HANDLE_TIMEOUT_MS,
    );
    // Without permission the file can't be checked; the caller asks for it
    if (permission !== "granted") {
      return handle;
    }
    await promiseTimeout(handle.getFile(), HANDLE_TIMEOUT_MS);
    return handle;
  } catch {
    // Look for it in the catalog folders below
  }
  const found = await findInCatalogFolders(handle.name);
  if (!found) {
    throw new Error(
      `${handle.name} can't be opened: it was moved or deleted, or its folder is no longer linked. Open its folder in the catalog to relink it.`,
    );
  }
  return found;
}

async function indexFile(
  entry: FolderFile,
  { retryErrors }: { retryErrors: boolean },
): Promise<CatalogRecording> {
  const name = entry.path.split("/").pop() ?? entry.path;
  const base = {
    id: entry.path,
    name,
    source: { type: "local-file" as const, path: entry.path },
  };

  let file: File;
  try {
    file = await entry.getFile();
  } catch (err: unknown) {
    return { ...base, error: String(err) };
  }

  // Same name, size and modification time means the same content: reuse the cached summary. The
  // path is left out because it is relative to the picked folder, so opening a parent or a moved
  // folder still hits the cache.
  const key = `${CACHE_VERSION}|${file.name}|${file.size}|${file.lastModified}`;
  // The cache is only an optimization, so a failing IndexedDB never fails the scan.
  let summary = await summaryStore.get<CatalogSummary>(key).catch((err: unknown) => {
    console.warn("Catalog cache read failed", err);
    return undefined;
  });
  if (!summary || (summary.error != undefined && retryErrors)) {
    let previews: Previews = {};
    try {
      const { previews: rendered, ...rest } = await summarizeMcap(file);
      summary = rest;
      previews = rendered ?? {};
    } catch (err: unknown) {
      summary = { error: err instanceof Error ? err.message : String(err) };
    }
    await summaryStore.set(key, summary).catch((err: unknown) => {
      console.warn("Catalog cache write failed", err);
    });
    // Previews are stored apart so scans, which read every summary, stay light.
    await previewStore
      .setMany(Object.entries(previews).map(([topic, frames]) => [`${key}|${topic}`, frames]))
      .catch((err: unknown) => {
        console.warn("Catalog preview cache write failed", err);
      });
  }
  return { ...base, size: file.size, previewKey: key, ...summary };
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

/** Preview frames of `topic`: made while indexing, or read now for topics indexing skipped. */
export async function loadPreview(entry: FolderFile, topic: string): Promise<PreviewFrame[]> {
  const file = await entry.getFile();
  const key = `${CACHE_VERSION}|${file.name}|${file.size}|${file.lastModified}|${topic}`;
  const cached = await previewStore.get<PreviewFrame[]>(key).catch((err: unknown) => {
    console.warn("Catalog preview cache read failed", err);
    return undefined;
  });
  if (cached) {
    return cached;
  }
  const preview = await previewMcap(file, topic);
  await previewStore.set(key, preview).catch((err: unknown) => {
    console.warn("Catalog preview cache write failed", err);
  });
  return preview;
}

/** The cached clip of a recording's first preview topic, without reading the file. */
export async function readCachedPreview(
  recording: CatalogRecording,
): Promise<PreviewFrame[] | undefined> {
  const topic = recording.previewTopics?.[0];
  if (recording.previewKey == undefined || topic == undefined) {
    return undefined;
  }
  return await previewStore.get<PreviewFrame[]>(`${recording.previewKey}|${topic}`);
}
