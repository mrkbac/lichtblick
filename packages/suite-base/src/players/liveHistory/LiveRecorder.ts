// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as Comlink from "@foxglove/comlink";
import { Time, toNanoSec } from "@foxglove/rostime";

import { liveHistorySettings } from "./liveHistorySettings";
import type { LiveRecorderWorker, RecorderChannel, RecorderMessage } from "./liveRecorder.worker";
import {
  evictLiveRecordings,
  liveMachine,
  liveRecordingName,
  moveLiveRecordingsToFolder,
} from "./liveRecordings";

/** Received messages are handed to the worker in batches on this cadence. */
const POST_INTERVAL_MS = 500;
/** How often the disk budget is enforced while recording. */
const EVICT_INTERVAL_MS = 60_000;
const MIB = 1024 * 1024;
/** Recording stops if this much data is waiting for the worker: it can't keep up. */
const MAX_BACKLOG_BYTES = 256 * MIB;

const budgetBytes = (): number => liveHistorySettings.getState().diskMiB * MIB;

/**
 * Records one live session to MCAP files in browser storage. Starts on the first message; the
 * caller stops it when the connection ends. A file that grows past half the disk budget is closed
 * and recording continues in a new one, so the oldest part of a long session can be evicted.
 * Failures are reported once through `onError` and recording stops; the connection is unaffected.
 */
export class LiveRecorder {
  #name: string;
  /** What the session is connected to; part of the file name and its MCAP metadata. */
  #source: { url: string; serverName?: string };
  #worker = new Worker(new URL("./liveRecorder.worker", import.meta.url));
  #remote = Comlink.wrap<LiveRecorderWorker>(this.#worker);
  #channelKeys = new Map<RecorderChannel, number>();
  #pending: RecorderMessage[] = [];
  #sequence = 0;
  /** Bytes handed to the worker or waiting to be, not yet written. */
  #backlogBytes = 0;
  /** Size of the file being written, as last reported by the worker. */
  #activeBytes = 0;
  /** Bumped per file, so sizes reported for a closed file are ignored. */
  #file = 0;
  #started?: Promise<void>;
  #postTimer?: ReturnType<typeof setInterval>;
  #evictTimer?: ReturnType<typeof setInterval>;
  #failed = false;
  /** Set once stop() begins, so a late batch result can't start a new file. */
  #stopped = false;
  #profile: string;
  #onError: (error: unknown) => void;

  public constructor({
    profile,
    source,
    onError,
  }: {
    profile: string | undefined;
    source: { url: string; serverName?: string };
    onError: (error: unknown) => void;
  }) {
    this.#profile = profile ?? "";
    this.#source = source;
    this.#name = this.#newName();
    this.#onError = onError;
  }

  #newName(): string {
    return liveRecordingName(new Date(), liveMachine(this.#source.url));
  }

  #sourceMetadata(): Record<string, string> {
    const { url, serverName } = this.#source;
    return serverName ? { url, serverName } : { url };
  }

  /** `channel` must be the same object for every message of a channel. */
  public record(channel: RecorderChannel, receiveTime: Time, data: Uint8Array): void {
    if (this.#failed) {
      return;
    }
    if (!this.#started) {
      const name = this.#name;
      this.#started = this.#call(async () => {
        await this.#remote.start(name, this.#profile, this.#sourceMetadata());
      });
      this.#postTimer = setInterval(this.#post, POST_INTERVAL_MS);
      this.#evictTimer = setInterval(() => void this.#enforceBudget(), EVICT_INTERVAL_MS);
      void this.#enforceBudget();
    }
    let key = this.#channelKeys.get(channel);
    if (key == undefined) {
      key = this.#channelKeys.size;
      this.#channelKeys.set(channel, key);
      const channelKey = key;
      void this.#call(async () => {
        await this.#remote.addChannel(channelKey, channel);
      });
    }
    this.#pending.push({
      channel: key,
      logTime: toNanoSec(receiveTime),
      sequence: this.#sequence++,
      data,
    });
    this.#backlogBytes += data.byteLength;
    if (this.#backlogBytes > MAX_BACKLOG_BYTES) {
      this.#fail(new Error("Recording can't keep up with the incoming data"));
    }
  }

  /** Write what is pending, finish the file and move it to the recording folder if there is one. */
  public async stop(): Promise<void> {
    this.#stopped = true;
    clearInterval(this.#postTimer);
    clearInterval(this.#evictTimer);
    if (this.#started) {
      this.#post();
      await this.#call(async () => {
        await this.#remote.stop();
      });
      this.#activeBytes = 0;
      await moveLiveRecordingsToFolder().catch(() => {});
      await this.#enforceBudget();
    }
    this.#remote[Comlink.releaseProxy]();
    this.#worker.terminate();
  }

  #post = (): void => {
    if (this.#pending.length === 0) {
      return;
    }
    const messages = this.#pending;
    this.#pending = [];
    const file = this.#file;
    const bytes = messages.reduce((sum, msg) => sum + msg.data.byteLength, 0);
    void this.#call(async () => {
      const size = await this.#remote.append(messages);
      this.#backlogBytes -= bytes;
      if (file === this.#file) {
        this.#activeBytes = size;
        const budget = budgetBytes();
        if (!this.#stopped && budget > 0 && size > budget / 2) {
          this.#rotate();
        }
      }
    });
  };

  /** Close the current file and continue in a new one. */
  #rotate(): void {
    this.#post();
    this.#file++;
    this.#activeBytes = 0;
    this.#channelKeys.clear();
    const name = this.#newName();
    this.#name = name;
    void this.#call(async () => {
      // Sent together, so the worker runs them back to back, before any later batch.
      const stopped = this.#remote.stop();
      const started = this.#remote.start(name, this.#profile, this.#sourceMetadata());
      await stopped;
      await started;
      await moveLiveRecordingsToFolder().catch(() => {});
      await this.#enforceBudget();
    });
  }

  /** Evict older recordings so they and the file being written fit the budget. */
  async #enforceBudget(): Promise<void> {
    const budget = budgetBytes();
    // Off (0) means don't record, not "delete every recording".
    if (budget <= 0) {
      return;
    }
    await evictLiveRecordings(Math.max(0, budget - this.#activeBytes)).catch(() => {});
  }

  /** Run worker calls in order; after the first failure, report it and drop the rest. */
  async #call(run: () => Promise<void>): Promise<void> {
    await this.#started;
    if (this.#failed) {
      return;
    }
    try {
      await run();
    } catch (error) {
      this.#fail(error);
    }
  }

  /** Stop recording for good: report once, drop what is queued, end the worker (closes the file). */
  #fail(error: unknown): void {
    if (this.#failed) {
      return;
    }
    this.#failed = true;
    this.#pending = [];
    this.#backlogBytes = 0;
    clearInterval(this.#postTimer);
    clearInterval(this.#evictTimer);
    this.#worker.terminate();
    this.#onError(error);
  }
}
