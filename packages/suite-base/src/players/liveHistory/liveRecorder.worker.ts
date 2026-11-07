// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Writes one live session to an MCAP file in the origin private file system. A sync access handle
// writes in place, so every chunk is in the file as soon as it is written: after a crash the file
// is a valid MCAP without index (readable from the start), after `stop()` a regular indexed one.

import * as Comlink from "@foxglove/comlink";
import { McapWriter } from "@mcap/core";

import { loadRewriteChunkDeps } from "@lichtblick/mcap-support";

import { LIVE_RECORDINGS_DIR, liveRecordingLockName } from "./liveRecordings";

/** fsync on this cadence; a reload keeps what was written even without it. */
const FLUSH_INTERVAL_MS = 1000;
/**
 * Messages reach the file a chunk at a time, so a crash loses at most this much. Smaller than the
 * default 1 MiB so slow streams land on disk sooner.
 * ponytail: bounded by size, not time; a time bound needs a chunk flush McapWriter doesn't expose.
 */
const CHUNK_SIZE = 256 * 1024;

export type RecorderChannel = {
  topic: string;
  messageEncoding: string;
  schema: { name: string; encoding: string; data: Uint8Array };
};

export type RecorderMessage = {
  channel: number;
  logTime: bigint;
  sequence: number;
  data: Uint8Array;
};

/** Recorded with each file as MCAP metadata: what the session was connected to. */
export const LIVE_SOURCE_METADATA = "lichtblick.live_source";

type Session = {
  name: string;
  dir: FileSystemDirectoryHandle;
  handle: FileSystemSyncAccessHandle;
  /** Messages written; a file that ends without any is deleted. */
  messageCount: number;
  /** Bytes written to the file so far. */
  size: () => number;
  writer: McapWriter;
  channelIds: Map<number, number>;
  schemaIds: Map<string, number>;
  flushTimer: ReturnType<typeof setInterval>;
  releaseLock: () => void;
};

const compressZstd = loadRewriteChunkDeps().then((deps) => deps.compressZstd);

let session: Session | undefined;
// Calls are queued: the writer must see them one at a time, in order.
let queue = Promise.resolve();
async function serial<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run);
  queue = result.then(
    () => {},
    () => {},
  );
  return await result;
}

async function start(name: string, profile: string, source: Record<string, string>): Promise<void> {
  const compress = await compressZstd;
  let releaseLock!: () => void;
  // Never wait for or take over a recording that is in use, and never overwrite one.
  const locked = new Promise<void>((resolve, reject) => {
    void navigator.locks
      .request(liveRecordingLockName(name), { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(new Error(`Recording ${name} is already in use`));
          return;
        }
        // Assigned before resolve(), so the caller can always release.
        const held = new Promise<void>((release) => {
          releaseLock = release;
        });
        resolve();
        await held;
      })
      .catch(reject);
  });
  await locked;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(LIVE_RECORDINGS_DIR, { create: true });
    const exists = await dir.getFileHandle(name).then(
      () => true,
      () => false,
    );
    if (exists) {
      throw new Error(`Recording ${name} already exists`);
    }
    const file = await dir.getFileHandle(name, { create: true });
    const handle = await file.createSyncAccessHandle();
    let position = 0n;
    const writer = new McapWriter({
      writable: {
        position: () => position,
        write: async (buffer) => {
          handle.write(buffer, { at: Number(position) });
          position += BigInt(buffer.byteLength);
        },
      },
      chunkSize: CHUNK_SIZE,
      compressChunk: (data) => ({ compression: "zstd", compressedData: compress(data) }),
    });
    await writer.start({ profile, library: "Lichtblick live recording" });
    await writer.addMetadata({
      name: LIVE_SOURCE_METADATA,
      metadata: new Map(Object.entries(source)),
    });
    session = {
      name,
      dir,
      handle,
      messageCount: 0,
      size: () => Number(position),
      writer,
      channelIds: new Map(),
      schemaIds: new Map(),
      flushTimer: setInterval(() => {
        handle.flush();
      }, FLUSH_INTERVAL_MS),
      releaseLock,
    };
  } catch (error) {
    releaseLock();
    throw error;
  }
}

async function addChannel(key: number, channel: RecorderChannel): Promise<void> {
  if (!session) {
    return;
  }
  const { schema } = channel;
  // Base64, not text: binary descriptors (protobuf) must not collide after lossy decoding.
  const schemaKey = `${schema.encoding}\0${schema.name}\0${schema.data.toBase64()}`;
  let schemaId = session.schemaIds.get(schemaKey);
  if (schemaId == undefined) {
    schemaId = await session.writer.registerSchema(schema);
    session.schemaIds.set(schemaKey, schemaId);
  }
  const channelId = await session.writer.registerChannel({
    topic: channel.topic,
    messageEncoding: channel.messageEncoding,
    schemaId,
    metadata: new Map(),
  });
  session.channelIds.set(key, channelId);
}

/** Returns the size of the file so far. */
async function append(messages: RecorderMessage[]): Promise<number> {
  if (!session) {
    return 0;
  }
  for (const msg of messages) {
    const channelId = session.channelIds.get(msg.channel);
    if (channelId != undefined) {
      await session.writer.addMessage({
        channelId,
        sequence: msg.sequence,
        logTime: msg.logTime,
        publishTime: msg.logTime,
        data: msg.data,
      });
      session.messageCount++;
    }
  }
  return session.size();
}

async function stop(): Promise<void> {
  const current = session;
  session = undefined;
  if (!current) {
    return;
  }
  clearInterval(current.flushTimer);
  try {
    if (current.messageCount > 0) {
      await current.writer.end();
      current.handle.flush();
    }
  } finally {
    current.handle.close();
    if (current.messageCount === 0) {
      // Nothing to open in a recording without messages.
      await current.dir.removeEntry(current.name).catch(() => {});
    }
    current.releaseLock();
  }
}

const api = {
  start: async (name: string, profile: string, source: Record<string, string>) => {
    await serial(async () => {
      await start(name, profile, source);
    });
  },
  addChannel: async (key: number, channel: RecorderChannel) => {
    await serial(async () => {
      await addChannel(key, channel);
    });
  },
  append: async (messages: RecorderMessage[]) => await serial(async () => await append(messages)),
  stop: async () => {
    await serial(stop);
  },
};

export type LiveRecorderWorker = typeof api;

Comlink.expose(api);
