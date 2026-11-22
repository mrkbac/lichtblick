// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Time,
  add,
  clampTime,
  compare,
  fromNanoSec,
  subtract as subtractTimes,
  toNanoSec,
} from "@foxglove/rostime";
import { simplify } from "intervals-fn";
import * as _ from "lodash-es";

import { Condvar } from "@lichtblick/den/async";
import { filterMap } from "@lichtblick/den/collection";
import Log from "@lichtblick/log";
import { Immutable, MessageEvent } from "@lichtblick/suite";
import { ByteBudget } from "@lichtblick/suite-base/players/ByteBudget";
import { IteratorCursor } from "@lichtblick/suite-base/players/IterablePlayer/IteratorCursor";
import PlayerAlertManager from "@lichtblick/suite-base/players/PlayerAlertManager";
import {
  sameTopicSelection,
  subscriptionCovers,
} from "@lichtblick/suite-base/players/subscriptionEquality";
import {
  MessageBlock,
  Progress,
  SubscribePayload,
  TopicSelection,
} from "@lichtblick/suite-base/players/types";

import { IDeserializedIterableSource, MessageIteratorArgs } from "./IIterableSource";

const log = Log.getLogger(__filename);

export const MEMORY_INFO_PRELOADED_MSGS = "Preloaded messages";

type BlockLoaderArgs = {
  cacheSizeBytes: number;
  source: IDeserializedIterableSource;
  start: Time;
  end: Time;
  maxBlocks: number;
  minBlockDurationNs: number;
  alertManager: PlayerAlertManager;
};

type CacheBlock = MessageBlock & {
  needTopics: Immutable<TopicSelection>;
};

/** Per topic, the subscription its messages in a block were loaded with. */
type LoadedSubscriptions = Record<string, Immutable<SubscribePayload>>;

type Blocks = (CacheBlock | undefined)[];

type LoadArgs = {
  progress: (progress: Progress) => void;
};

/**
 * BlockLoader manages loading blocks from a source. Blocks are fixed time span containers for messages.
 */
export class BlockLoader {
  #source: IDeserializedIterableSource;
  #blocks: Blocks = [];
  /** For each block, what its messages were loaded with (kept out of the blocks we emit). */
  #loadedSubscriptions: LoadedSubscriptions[] = [];
  #start: Time;
  #end: Time;
  #blockDurationNanos: number;
  #maxBlocks: number;
  #topics: TopicSelection = new Map();
  #budget: ByteBudget;
  #alertManager: PlayerAlertManager;
  #stopped: boolean = false;
  #activeChangeCondvar: Condvar = new Condvar();
  #abortController: AbortController;
  /** Loading and eviction order around it; see #distance */
  #playhead: Time;
  /** Bumped when what to load changes (topics, playhead block), so a finished load runs again */
  #generation = 0;
  #arrayBytes = new WeakMap<readonly MessageEvent[], number>();

  public constructor(args: BlockLoaderArgs) {
    this.#source = args.source;
    this.#start = args.start;
    this.#end = args.end;
    this.#playhead = args.start;
    this.#budget = new ByteBudget(args.cacheSizeBytes);
    this.#alertManager = args.alertManager;
    this.#abortController = new AbortController();

    const totalNs = Number(toNanoSec(subtractTimes(this.#end, this.#start))) + 1; // +1 since times are inclusive.
    if (totalNs > Number.MAX_SAFE_INTEGER * 0.9) {
      throw new Error("Time range is too long to be supported");
    }

    this.#maxBlocks = args.maxBlocks;
    this.#blockDurationNanos = Math.ceil(
      Math.max(args.minBlockDurationNs, totalNs / args.maxBlocks),
    );

    const blockCount = Math.ceil(totalNs / this.#blockDurationNanos);

    log.debug(`Block count: ${blockCount}`);
    this.#blocks = Array.from({ length: blockCount });
  }

  /**
   * For a source that grew to `end`: extends the blocks in place, keeping what is loaded except in
   * `updatedRanges` (where the source has new messages). Call it while loading is stopped. False if
   * that isn't possible (the start moved, or the range shrank); make a new loader instead.
   */
  public grow(
    start: Time,
    end: Time,
    updatedRanges: readonly { start: Time; end: Time }[],
  ): boolean {
    if (compare(start, this.#start) !== 0 || compare(end, this.#end) < 0) {
      return false;
    }
    const totalNs = Number(toNanoSec(subtractTimes(end, start))) + 1;
    if (totalNs > Number.MAX_SAFE_INTEGER * 0.9) {
      return false;
    }
    this.#end = end;
    // Twice as long blocks, half as many, until they fit: each block halving costs O(blocks)
    while (Math.ceil(totalNs / this.#blockDurationNanos) > this.#maxBlocks) {
      this.#mergeBlockPairs();
    }
    const blockCount = Math.ceil(totalNs / this.#blockDurationNanos);
    while (this.#blocks.length < blockCount) {
      this.#blocks.push(undefined);
    }
    const startNs = toNanoSec(start);
    const blockOf = (time: Time) =>
      Math.min(
        blockCount - 1,
        Math.max(0, Math.floor(Number(toNanoSec(time) - startNs) / this.#blockDurationNanos)),
      );
    for (const range of updatedRanges) {
      for (let i = blockOf(range.start); i <= blockOf(range.end); i++) {
        this.#blocks[i] = undefined;
        this.#loadedSubscriptions[i] = {};
      }
    }
    return true;
  }

  /** Merges each pair of neighboring blocks into one, keeping the topics both have loaded alike */
  #mergeBlockPairs(): void {
    const blocks: Blocks = [];
    const loadedSubscriptions: LoadedSubscriptions[] = [];
    for (let i = 0; i < this.#blocks.length; i += 2) {
      const first = this.#blocks[i];
      // Past the last block is past the old end: no messages there but updated ones, which grow()
      // drops after merging
      const hasSecond = i + 1 < this.#blocks.length;
      const second = this.#blocks[i + 1];
      if (!first || (hasSecond && !second)) {
        blocks.push(undefined);
        loadedSubscriptions.push({});
        continue;
      }
      const loaded: LoadedSubscriptions = {};
      const messagesByTopic: Record<string, MessageEvent[]> = {};
      let sizeInBytes = 0;
      for (const [topic, subscription] of Object.entries(this.#loadedSubscriptions[i] ?? {})) {
        if (hasSecond && !_.isEqual(this.#loadedSubscriptions[i + 1]?.[topic], subscription)) {
          continue;
        }
        const messages = [
          ...(first.messagesByTopic[topic] ?? []),
          ...(second?.messagesByTopic[topic] ?? []),
        ];
        loaded[topic] = subscription;
        messagesByTopic[topic] = messages;
        sizeInBytes += messages.reduce((sum, message) => sum + message.sizeInBytes, 0);
      }
      blocks.push({
        messagesByTopic,
        sizeInBytes,
        needTopics: this.#needTopics(this.#topics, loaded),
      });
      loadedSubscriptions.push(loaded);
    }
    this.#blocks = blocks;
    this.#loadedSubscriptions = loadedSubscriptions;
    this.#blockDurationNanos *= 2;
  }

  public setTopics(topics: TopicSelection): void {
    if (sameTopicSelection(topics, this.#topics)) {
      return;
    }

    this.#abortController.abort();
    this.#generation++;
    this.#activeChangeCondvar.notifyAll();
    log.debug(`Preloaded topics: ${Array.from(topics.keys()).join(", ")}`);

    // Update all the blocks with any missing topics
    for (const [index, block] of this.#blocks.entries()) {
      if (!block) {
        continue;
      }
      const loaded = this.#loadedSubscriptions[index] ?? {};

      // A topic needs loading unless this block already holds what the subscription asks for,
      // e.g. a panel asking for fewer fields of a topic that is loaded, or a topic that was
      // unsubscribed and subscribed again (its messages are kept until the cache is full).
      // A new block, not a change to it: consumers reuse work per block reference
      this.#blocks[index] = {
        ...block,
        needTopics: this.#needTopics(topics, loaded),
      };
    }

    this.#topics = topics;
  }

  /**
   * Remove topics that are no longer requested to be preloaded or topics that will be re-loaded
   * from blocks to free up space
   */
  #removeUnusedBlockTopics(): number {
    const topics = this.#topics;
    let totalBytesRemoved = 0;
    for (let i = 0; i < this.#blocks.length; i++) {
      const block = this.#blocks[i];
      if (block) {
        let blockBytesRemoved = 0;
        const newMessagesByTopic: Record<string, MessageEvent[]> = {
          ...block.messagesByTopic,
        };
        const loaded = this.#loadedSubscriptions[i];
        const blockTopics = Object.keys(newMessagesByTopic);
        for (const topic of blockTopics) {
          // remove topics that are no longer requested to be preloaded and topics that will
          // be re-loaded (due to different subscription parameters)
          const newMessages: MessageEvent[] | undefined = newMessagesByTopic[topic];
          if ((!topics.has(topic) || block.needTopics.has(topic)) && newMessages) {
            for (const msg of newMessages) {
              blockBytesRemoved += msg.sizeInBytes;
            }
            delete newMessagesByTopic[topic];
            if (loaded) {
              delete loaded[topic];
            }
          }
        }
        if (blockBytesRemoved > 0) {
          this.#blocks[i] = {
            ...block,
            messagesByTopic: newMessagesByTopic,
            sizeInBytes: block.sizeInBytes - blockBytesRemoved,
          };
          totalBytesRemoved += blockBytesRemoved;
        }
      }
    }
    return totalBytesRemoved;
  }

  /**
   * For each topic, the last preloaded message at or before `time`. A topic counts as answered
   * when the blocks back from `time` to the start (or to its last message) hold it, loaded with
   * at least the wanted fields; `missing` has the other topics, for the caller to read elsewhere.
   */
  public getBackfillMessages(
    topics: TopicSelection,
    time: Time,
  ): { messages: MessageEvent[]; missing: TopicSelection } {
    const messages: MessageEvent[] = [];
    const missing: TopicSelection = new Map();
    const offsetNs = toNanoSec(time) - toNanoSec(this.#start);
    const lastBlockId = Math.min(
      this.#blocks.length - 1,
      Math.floor(Number(offsetNs) / this.#blockDurationNanos),
    );

    for (const [topic, subscription] of topics) {
      let answered = offsetNs >= 0n && lastBlockId >= 0;
      let message: MessageEvent | undefined;
      for (let blockId = lastBlockId; answered && blockId >= 0 && !message; --blockId) {
        const blockMessages = this.#blocks[blockId]?.messagesByTopic[topic];
        if (
          !blockMessages ||
          !subscriptionCovers(this.#loadedSubscriptions[blockId]?.[topic], subscription)
        ) {
          answered = false;
          break;
        }
        // Messages are in receive time order; only the block holding `time` has later ones
        message = blockMessages.findLast((msg) => compare(msg.receiveTime, time) <= 0);
      }
      if (message) {
        messages.push(message);
      } else if (!answered) {
        missing.set(topic, subscription);
      }
    }
    return { messages, missing };
  }

  /**
   * Moves the playhead that loading and eviction are ordered around. A jump (a seek) restarts the
   * running load around the new playhead; playing on into the next block only lets a load that
   * ran out of budget continue, now that blocks behind count farther.
   */
  public setPlayhead(time: Time): void {
    const previous = this.#playheadBlock();
    this.#playhead = time;
    const current = this.#playheadBlock();
    if (current === previous) {
      return;
    }
    if (current < previous || current > previous + 1) {
      this.#abortController.abort();
    }
    this.#generation++;
    this.#activeChangeCondvar.notifyAll();
  }

  public async stopLoading(): Promise<void> {
    log.debug("Stop loading blocks");
    this.#stopped = true;
    this.#abortController.abort();
    this.#activeChangeCondvar.notifyAll();
  }

  public async startLoading(args: LoadArgs): Promise<void> {
    log.debug("Start loading process");
    this.#stopped = false;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (!this.#stopped) {
      this.#abortController = new AbortController();

      const generation = this.#generation;

      await this.#load({ progress: args.progress });

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (this.#stopped) {
        break;
      }

      // Wait for topics or the playhead to change
      if (this.#generation === generation) {
        await this.#activeChangeCondvar.wait();
      }
    }
  }

  /**
   * Loads what the blocks still need, nearest to the playhead first (see #distance). When the
   * budget runs out, the loaded data farthest from the playhead makes room, taken from topics that
   * hold at least their fair share of the budget, so one heavy topic can't push out the others. A
   * topic that can't grow any further stops there for this pass, while the other topics load on.
   */
  async #load(args: { progress: LoadArgs["progress"] }): Promise<void> {
    const topics = new Map(this.#topics);

    // Ignore changing the blocks if the topic list is empty
    if (topics.size === 0) {
      args.progress(this.#calculateProgress(topics, this.#cacheSize()));
      return;
    }

    if (this.#blocks.length === 0) {
      return;
    }

    log.debug("loading blocks", { topics });

    const { progress } = args;
    // Recounted: setTopics() and grow() drop messages from blocks
    const budget = this.#budget;
    budget.reset();
    budget.add(this.#cacheSize());
    // Per topic, the distance from the playhead at which it ran out of budget in this pass
    const cappedAt = new Map<string, number>();

    for (;;) {
      const playhead = this.#playheadBlock();
      const fetchTopics = (id: number): Immutable<TopicSelection> => {
        const need = this.#blocks[id]?.needTopics ?? topics;
        if (cappedAt.size === 0) {
          return need;
        }
        const distance = this.#distance(id, playhead);
        return new Map([...need].filter(([topic]) => distance < (cappedAt.get(topic) ?? Infinity)));
      };

      // The nearest block that needs loading, and the nearest one on the other side of the playhead
      let blockId = -1;
      let topicsToFetch: Immutable<TopicSelection> = new Map();
      for (let id = 0; id < this.#blocks.length; id++) {
        if (blockId >= 0 && this.#distance(id, playhead) >= this.#distance(blockId, playhead)) {
          continue;
        }
        const fetch = fetchTopics(id);
        if (fetch.size > 0) {
          blockId = id;
          topicsToFetch = fetch;
        }
      }
      if (blockId < 0) {
        break;
      }

      // Read on forward while the next block needs the same topics and is not farther than the
      // nearest block on the other side of the playhead that needs loading
      let nearestOtherSide = Infinity;
      for (let id = 0; id < this.#blocks.length; id++) {
        if (id >= playhead !== blockId >= playhead && fetchTopics(id).size > 0) {
          nearestOtherSide = Math.min(nearestOtherSide, this.#distance(id, playhead));
        }
      }
      let endBlockId = blockId;
      while (
        endBlockId + 1 < this.#blocks.length &&
        this.#distance(endBlockId + 1, playhead) <= nearestOtherSide &&
        _.isEqual(fetchTopics(endBlockId + 1), topicsToFetch)
      ) {
        endBlockId++;
      }

      // Compute the cursor start/end time from the range of blocks we need to load
      const cursorStartTime = this.#blockIdToStartTime(blockId);
      const cursorEndTime = clampTime(this.#blockIdToEndTime(endBlockId), this.#start, this.#end);

      const iteratorArgs: Immutable<MessageIteratorArgs> = {
        topics: topicsToFetch,
        start: cursorStartTime,
        end: cursorEndTime,
        consumptionType: "full",
      };

      // If the source provides a message cursor we use its message cursor, otherwise we make one
      // using the source's message iterator.
      const cursor =
        this.#source.getMessageCursor?.({ ...iteratorArgs, abort: this.#abortController.signal }) ??
        new IteratorCursor(
          this.#source.messageIterator(iteratorArgs),
          this.#abortController.signal,
        );

      log.debug("Loading range", { blockId, endBlockId });
      // Loop through the blocks corresponding to the range of our cursor
      for (let currentBlockId = blockId; currentBlockId <= endBlockId; ++currentBlockId) {
        // Until time is the end time of the current block, we want all the messages from the cursor
        // until (inclusive) of the end of of the block
        const untilTime = clampTime(this.#blockIdToEndTime(currentBlockId), this.#start, this.#end);

        const results = await cursor.readUntil(untilTime);
        // No results means cursor aborted or eof
        if (!results) {
          await cursor.end();
          return;
        }

        // While we were waiting for cursor data the topics we need to be loading may have changed.
        // Check whether the topics are changed and abort this loading instance because the results
        // may no longer be valid for the data we should be loading.
        if (!sameTopicSelection(topics, this.#topics)) {
          await cursor.end();
          return;
        }

        const messagesByTopic: Record<string, MessageEvent[]> = {};

        // Set all topics to empty arrays. Since our cursor requested all the topicsToFetch we either will
        // have message on the topic or we don't have message on the topic. Either way the topic entry
        // starts as an empty array.
        for (const topic of topicsToFetch.keys()) {
          messagesByTopic[topic] = [];
        }

        let sizeInBytes = 0;
        let full = false;
        for (const iterResult of results) {
          if (iterResult.type === "alert") {
            this.#alertManager.addAlert(`connid-${iterResult.connectionId}`, iterResult.alert);
            continue;
          }

          if (iterResult.type !== "message-event") {
            continue;
          }

          const msgTopic = iterResult.msgEvent.topic;
          const arr = messagesByTopic[msgTopic];

          // Because we initialized all the topicsToFetch earlier we expect to have an array for each message
          // topic in our results. If we don't, thats a problem.
          if (!arr) {
            this.#alertManager.addAlert(`unexpected-topic-${msgTopic}`, {
              severity: "error",
              message: `Received a message on an unexpected topic: ${msgTopic}.`,
            });

            continue;
          }
          // Only the first message per topic and block can clear the alert; later calls are no-ops
          if (arr.length === 0) {
            this.#alertManager.removeAlert(`unexpected-topic-${msgTopic}`);
          }

          const messageSizeInBytes = iterResult.msgEvent.sizeInBytes;
          budget.add(messageSizeInBytes);
          arr.push(iterResult.msgEvent);

          sizeInBytes += messageSizeInBytes;

          if (budget.fits(0)) {
            continue;
          }
          // Over budget: drop topics no longer wanted, then what is farther from the playhead
          budget.release(this.#removeUnusedBlockTopics());
          if (!budget.fits(0)) {
            this.#evictFartherThan(this.#distance(currentBlockId, this.#playheadBlock()), budget);
          }
          if (!budget.fits(0)) {
            full = true;
            break;
          }
        }

        if (full) {
          // Drop this block's partial read. The topics holding at least their share of the budget
          // stop here for this pass, the others load on.
          budget.release(sizeInBytes);
          const fairShare = budget.capacity / topics.size;
          const loadedBytes = this.#topicBytes();
          const heavy = [...topicsToFetch.keys()].filter(
            (topic) =>
              (loadedBytes.get(topic) ?? 0) + this.#bytesOf(messagesByTopic[topic] ?? []) >=
              fairShare,
          );
          const distance = this.#distance(currentBlockId, playhead);
          for (const topic of heavy.length > 0 ? heavy : topicsToFetch.keys()) {
            cappedAt.set(topic, distance);
          }
          this.#alertManager.addAlert("cache-full", {
            severity: "warn",
            message: `Preloading of [${[...cappedAt.keys()].join(", ")}] is limited to the data around the playhead: the preload cache is full.`,
            tip: "Fewer preloaded topics (e.g. in plots) cover more of the recording.",
          });
          // Emit progress so the player emits a new state with the alert
          progress(this.#calculateProgress(topics, budget.used()));
          break;
        }

        const existingBlock = this.#blocks[currentBlockId];

        // Calculate size of messages in the existing block that will be overridden.
        // These have to be taken into account when calculating the size of the new block.
        let overridenBlockMessagesSize = 0;
        for (const topic of Object.keys(messagesByTopic)) {
          const messages = existingBlock?.messagesByTopic[topic];
          if (messages) {
            overridenBlockMessagesSize += this.#bytesOf(messages);
          }
        }
        const newBlockSizeInBytes =
          (existingBlock?.sizeInBytes ?? 0) - overridenBlockMessagesSize + sizeInBytes;

        const loaded = {
          ...this.#loadedSubscriptions[currentBlockId],
          ...Object.fromEntries(topicsToFetch),
        };
        this.#loadedSubscriptions[currentBlockId] = loaded;
        this.#blocks[currentBlockId] = {
          needTopics: this.#needTopics(topics, loaded),
          messagesByTopic: {
            ...existingBlock?.messagesByTopic,
            // Any new topics override the same previous topic
            ...messagesByTopic,
          },
          sizeInBytes: newBlockSizeInBytes,
        };

        // Subtract the size of overridden messages from the the total size of all blocks.
        // (The size of new messages is already added above).
        budget.release(overridenBlockMessagesSize);

        progress(this.#calculateProgress(topics, budget.used()));
      }

      await cursor.end();
    }

    if (cappedAt.size === 0) {
      this.#alertManager.removeAlert("cache-full");
    }
  }

  /**
   * Frees loaded messages farther than `distance` from the playhead until `budget` fits, farthest
   * first, from topics holding at least their fair share of the budget.
   */
  #evictFartherThan(distance: number, budget: ByteBudget): void {
    const topicBytes = this.#topicBytes();
    const fairShare = budget.capacity / Math.max(1, this.#topics.size);
    const playhead = this.#playheadBlock();
    const victims: { id: number; topic: string; distance: number }[] = [];
    for (const [id, block] of this.#blocks.entries()) {
      const blockDistance = this.#distance(id, playhead);
      if (!block || blockDistance <= distance) {
        continue;
      }
      for (const topic of Object.keys(block.messagesByTopic)) {
        if ((topicBytes.get(topic) ?? 0) >= fairShare) {
          victims.push({ id, topic, distance: blockDistance });
        }
      }
    }
    victims.sort((a, b) => b.distance - a.distance);
    for (const { id, topic } of victims) {
      if (budget.fits(0)) {
        return;
      }
      const block = this.#blocks[id];
      const messages = block?.messagesByTopic[topic];
      if (!block || !messages) {
        continue;
      }
      const bytes = this.#bytesOf(messages);
      const { [topic]: _evicted, ...messagesByTopic } = block.messagesByTopic;
      const loaded = { ...this.#loadedSubscriptions[id] };
      delete loaded[topic];
      this.#loadedSubscriptions[id] = loaded;
      this.#blocks[id] = {
        messagesByTopic,
        sizeInBytes: block.sizeInBytes - bytes,
        needTopics: this.#needTopics(this.#topics, loaded),
      };
      budget.release(bytes);
    }
  }

  /** Loaded bytes per topic, across all blocks */
  #topicBytes(): Map<string, number> {
    const bytes = new Map<string, number>();
    for (const block of this.#blocks) {
      for (const [topic, messages] of Object.entries(block?.messagesByTopic ?? {})) {
        bytes.set(topic, (bytes.get(topic) ?? 0) + this.#bytesOf(messages));
      }
    }
    return bytes;
  }

  /** Byte size of a block's messages for a topic, summed once per array (they don't change) */
  #bytesOf(messages: readonly MessageEvent[]): number {
    let bytes = this.#arrayBytes.get(messages);
    if (bytes == undefined) {
      bytes = messages.reduce((sum, message) => sum + message.sizeInBytes, 0);
      this.#arrayBytes.set(messages, bytes);
    }
    return bytes;
  }

  /** The topics a block still needs, given what its messages were loaded with */
  #needTopics(topics: TopicSelection, loaded: LoadedSubscriptions): TopicSelection {
    return new Map(
      [...topics].filter(
        ([topic, subscription]) => !subscriptionCovers(loaded[topic], subscription),
      ),
    );
  }

  /**
   * How far a block is from the playhead block, for load order and eviction. Blocks behind the
   * playhead count double: playback reads forward.
   */
  #distance(id: number, playhead: number): number {
    return id >= playhead ? id - playhead : (playhead - id) * 2;
  }

  #playheadBlock(): number {
    return this.#blockOf(this.#playhead);
  }

  #blockOf(time: Time): number {
    const offsetNs = Number(toNanoSec(time) - toNanoSec(this.#start));
    return Math.min(
      this.#blocks.length - 1,
      Math.max(0, Math.floor(offsetNs / this.#blockDurationNanos)),
    );
  }

  #calculateProgress(topics: TopicSelection, currentCacheSize: number): Progress {
    const fullyLoadedFractionRanges = simplify(
      filterMap(this.#blocks, (thisBlock, blockIndex) => {
        if (!thisBlock) {
          return;
        }

        for (const topic of topics.keys()) {
          if (!thisBlock.messagesByTopic[topic]) {
            return;
          }
        }

        return {
          start: blockIndex,
          end: blockIndex + 1,
        };
      }),
    );

    return {
      fullyLoadedFractionRanges: fullyLoadedFractionRanges.map((range) => ({
        // Convert block ranges into fractions.
        start: range.start / this.#blocks.length,
        end: range.end / this.#blocks.length,
      })),
      messageCache: {
        blocks: this.#blocks.slice(),
        startTime: this.#start,
      },
      memoryInfo: {
        [MEMORY_INFO_PRELOADED_MSGS]: currentCacheSize,
      },
    };
  }

  #cacheSize(): number {
    return this.#blocks.reduce((prev, block) => {
      if (!block) {
        return prev;
      }

      return prev + block.sizeInBytes;
    }, 0);
  }

  #blockIdToStartTime(id: number): Time {
    return add(this.#start, fromNanoSec(BigInt(id) * BigInt(this.#blockDurationNanos)));
  }

  // The end time of a block is the start time of the next block minus 1 nanosecond
  #blockIdToEndTime(id: number): Time {
    return add(this.#start, fromNanoSec(BigInt(id + 1) * BigInt(this.#blockDurationNanos) - 1n));
  }
}
