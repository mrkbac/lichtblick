// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Opcode } from "@mcap/core";

import { createKeyValueStore } from "@lichtblick/suite-base/util/idbKeyValueStore";

/** Folder in the origin private file system (browser storage) that holds live recordings. */
export const LIVE_RECORDINGS_DIR = "live-recordings";

/** Web lock held while a recording is written, so moving and evicting skip it. */
export const liveRecordingLockName = (name: string): string => `lichtblick.live-recording:${name}`;

/** The machine a live connection goes to, from its URL: "robot.local:8765". */
export function liveMachine(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * "live-2026-11-07T10-30-00-123-k3f9@robot.local_8765.mcap": sorts by start time, the random suffix
 * keeps two recordings started in the same millisecond (two tabs, a quick reconnect) apart, and the
 * machine is part of the name so it shows wherever the file ends up.
 */
export function liveRecordingName(
  now: Date,
  machine?: string,
  suffix = Math.random().toString(36).slice(2, 6),
): string {
  const time = now.toISOString().slice(0, 23).replace(/[:.]/g, "-");
  const safeMachine = machine?.replace(/[^A-Za-z0-9.-]/g, "_").slice(0, 64);
  return `live-${time}-${suffix}${safeMachine ? `@${safeMachine}` : ""}.mcap`;
}

/** Start time and machine of a recording, from its name; either is missing for other names. */
export function parseLiveRecordingName(name: string): { start?: Date; machine?: string } {
  const match =
    /^live-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?(?:-[a-z0-9]+)?(?:@(.+))?\.mcap$/.exec(
      name,
    );
  if (!match) {
    return {};
  }
  const [, day, hours, minutes, seconds, millis = "000", machine] = match;
  return {
    start: new Date(`${day}T${hours}:${minutes}:${seconds}.${millis}Z`),
    // the port separator is the only character a host keeps that a file name can't
    machine: machine?.replace(/_(\d+)$/, ":$1"),
  };
}

/**
 * True if an MCAP file holds no message: only its header, e.g. a recording cut off before its first
 * chunk was written. Only small files are read; anything bigger has data.
 */
export async function isEmptyMcap(file: Blob): Promise<boolean> {
  const MAX_EMPTY_BYTES = 64 * 1024;
  if (file.size > MAX_EMPTY_BYTES) {
    return false;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // magic (8), then records: opcode (1), content length (8), content
  for (let offset = 8; offset + 9 <= bytes.length; ) {
    const opcode = bytes[offset]!;
    if (opcode === Opcode.MESSAGE || opcode === Opcode.CHUNK) {
      return false;
    }
    offset += 9 + Number(view.getBigUint64(offset + 1, true));
  }
  return true;
}

export type LiveRecording = {
  name: string;
  sizeBytes: number;
  lastModified: number;
  /** "browser": origin private file system; "folder": the folder the user picked. */
  location: "browser" | "folder";
  /** Being written right now (by this or another tab). */
  active: boolean;
  file: () => Promise<File>;
  remove: () => Promise<void>;
};

const folderStore = createKeyValueStore("lichtblick-live-recordings", "folder");
const FOLDER_KEY = "folder";

/** Recording to disk needs the origin private file system and Web Locks. */
export function supportsLiveRecording(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    "getDirectory" in navigator.storage &&
    "locks" in navigator
  );
}

export function supportsRecordingFolder(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

async function browserDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(LIVE_RECORDINGS_DIR, { create: true });
}

/** The folder recordings are moved to once finished, if the user picked one. */
export async function getRecordingFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  return await folderStore.get<FileSystemDirectoryHandle>(FOLDER_KEY);
}

/** Must be called from a user gesture (it opens the folder picker). */
export async function chooseRecordingFolder(): Promise<FileSystemDirectoryHandle> {
  const folder = await window.showDirectoryPicker({ id: "lichtblick-live", mode: "readwrite" });
  await folderStore.set(FOLDER_KEY, folder);
  return folder;
}

export async function forgetRecordingFolder(): Promise<void> {
  await folderStore.set(FOLDER_KEY, undefined);
}

/** The picked folder if it can be written without asking; permission prompts need a gesture. */
export async function writableRecordingFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  const folder = await getRecordingFolder();
  if (!folder) {
    return undefined;
  }
  const permission = await folder.queryPermission({ mode: "readwrite" }).catch(() => "denied");
  return permission === "granted" ? folder : undefined;
}

async function isLocked(name: string): Promise<boolean> {
  const { held = [] } = await navigator.locks.query();
  return held.some((lock) => lock.name === liveRecordingLockName(name));
}

async function listDirectory(
  directory: FileSystemDirectoryHandle,
  location: LiveRecording["location"],
): Promise<LiveRecording[]> {
  const recordings: LiveRecording[] = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== "file" || !name.startsWith("live-") || !name.endsWith(".mcap")) {
      continue;
    }
    const fileHandle = handle;
    const active = location === "browser" && (await isLocked(name));
    // A file being written can't be opened for reading; its size isn't known until it's done.
    const file = active ? undefined : await fileHandle.getFile();
    // Nothing to open in a recording without messages: drop it from browser storage, hide it in
    // the user's folder.
    if (file && (await isEmptyMcap(file))) {
      if (location === "browser") {
        await directory.removeEntry(name).catch(() => {});
      }
      continue;
    }
    recordings.push({
      name,
      sizeBytes: file?.size ?? 0,
      lastModified: file?.lastModified ?? Date.now(),
      location,
      active,
      file: async () => await fileHandle.getFile(),
      remove: async () => {
        await directory.removeEntry(name);
      },
    });
  }
  return recordings;
}

/** All recordings, newest first. The folder is only listed while it is writable. */
export async function listLiveRecordings(): Promise<LiveRecording[]> {
  const recordings = supportsLiveRecording()
    ? await listDirectory(await browserDirectory(), "browser")
    : [];
  const folder = await writableRecordingFolder();
  if (folder) {
    try {
      recordings.push(...(await listDirectory(folder, "folder")));
    } catch (error) {
      // E.g. the folder was moved or deleted; recordings in browser storage stay usable.
      console.warn("Could not list the recording folder", error);
    }
  }
  return recordings.sort((a, b) => b.name.localeCompare(a.name));
}

/**
 * Delete the oldest finished recordings in browser storage until they fit `budgetBytes`. Never
 * touches a recording that is being written.
 */
export async function evictLiveRecordings(budgetBytes: number): Promise<void> {
  const recordings = (await listDirectory(await browserDirectory(), "browser")).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  let total = recordings.reduce((sum, rec) => sum + rec.sizeBytes, 0);
  for (const rec of recordings) {
    if (total <= budgetBytes) {
      break;
    }
    if (rec.active) {
      continue;
    }
    // Under the recording's lock, so a move to the folder can't be copying it meanwhile.
    const removed = await navigator.locks
      .request(liveRecordingLockName(rec.name), { ifAvailable: true }, async (lock) => {
        if (!lock) {
          return false;
        }
        await rec.remove();
        return true;
      })
      .catch(() => false); // e.g. opened by another tab right now; try again next time
    if (removed) {
      total -= rec.sizeBytes;
    }
  }
}

/** Move finished recordings from browser storage to the picked folder, if one is writable. */
export async function moveLiveRecordingsToFolder(): Promise<void> {
  const folder = await writableRecordingFolder();
  if (!folder) {
    return;
  }
  for (const rec of await listDirectory(await browserDirectory(), "browser")) {
    if (rec.active) {
      continue;
    }
    // Copy under the lock, so no recorder starts writing to the same name meanwhile.
    await navigator.locks.request(
      liveRecordingLockName(rec.name),
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          return;
        }
        const target = await folder.getFileHandle(rec.name, { create: true });
        await (await rec.file()).stream().pipeTo(await target.createWritable());
        await rec.remove();
      },
    );
  }
}
