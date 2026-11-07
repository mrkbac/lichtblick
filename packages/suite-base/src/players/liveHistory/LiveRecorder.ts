// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as Comlink from "@foxglove/comlink";
import { Time, toNanoSec } from "@foxglove/rostime";

import { liveHistorySettings } from "./liveHistorySettings";
import type { LiveRecorderWorker, RecorderChannel, RecorderMessage } from "./liveRecorder.worker";
import {
  evictLiveRecordings,
  liveRecordingName,
  moveLiveRecordingsToFolder,
} from "./liveRecordings";

/** Received messages are handed to the worker in batches on this cadence. */
const POST_INTERVAL_MS = 500;
/** How often the disk budget is enforced while recording. */
const EVICT_INTERVAL_MS = 60_000;
const MIB = 1024 * 1024;

const enforceBudget = async (): Promise<void> => {
  await evictLiveRecordings(liveHistorySettings.getState().diskMiB * MIB);
};

/**
 * Records one live session to an MCAP file in browser storage. Starts on the first message; the
 * caller stops it when the connection ends. Failures are reported once through `onError` and
 * recording stops; the connection itself is unaffected.
 */
export class LiveRecorder {
  public readonly name = liveRecordingName(new Date());
  #worker = new Worker(new URL("./liveRecorder.worker", import.meta.url));
  #remote = Comlink.wrap<LiveRecorderWorker>(this.#worker);
  #channelKeys = new Map<RecorderChannel, number>();
  #pending: RecorderMessage[] = [];
  #sequence = 0;
  #started?: Promise<void>;
  #postTimer?: ReturnType<typeof setInterval>;
  #evictTimer?: ReturnType<typeof setInterval>;
  #failed = false;
  #profile: string;
  #onError: (error: unknown) => void;

  public constructor({
    profile,
    onError,
  }: {
    profile: string | undefined;
    onError: (error: unknown) => void;
  }) {
    this.#profile = profile ?? "";
    this.#onError = onError;
  }

  /** `channel` must be the same object for every message of a channel. */
  public record(channel: RecorderChannel, receiveTime: Time, data: Uint8Array): void {
    if (this.#failed) {
      return;
    }
    if (!this.#started) {
      this.#started = this.#call(async () => {
        await this.#remote.start(this.name, this.#profile);
      });
      this.#postTimer = setInterval(this.#post, POST_INTERVAL_MS);
      this.#evictTimer = setInterval(() => void enforceBudget().catch(() => {}), EVICT_INTERVAL_MS);
      void enforceBudget().catch(() => {});
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
  }

  /** Write what is pending, finish the file and move it to the recording folder if there is one. */
  public async stop(): Promise<void> {
    clearInterval(this.#postTimer);
    clearInterval(this.#evictTimer);
    if (this.#started) {
      this.#post();
      await this.#call(async () => {
        await this.#remote.stop();
      });
      await moveLiveRecordingsToFolder().catch(() => {});
      await enforceBudget().catch(() => {});
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
    void this.#call(async () => {
      await this.#remote.append(messages);
    });
  };

  /** Run worker calls in order; after the first failure, report it and drop the rest. */
  async #call(run: () => Promise<void>): Promise<void> {
    await this.#started;
    if (this.#failed) {
      return;
    }
    try {
      await run();
    } catch (error) {
      this.#failed = true;
      this.#pending = [];
      this.#onError(error);
    }
  }
}
