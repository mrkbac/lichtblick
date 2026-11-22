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
  /** The blocks the running read goes over */
  #reading?: { start: number; end: number };

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
   * Moves the playhead that loading and eviction are ordered around. If the new playhead block
   * still needs loading and the running read doesn't go over it (e.g. a seek), that read stops so
   * loading starts over around the playhead. Otherwise (e.g. playing over loaded data) it goes on,
   * and a load that ran out of budget runs again, now that blocks behind count farther.
   */
  public setPlayhead(time: Time): void {
    const previous = this.#playheadBlock();
    this.#playhead = time;
    const current = this.#playheadBlock();
    if (current === previous) {
      return;
    }
    const needed = (this.#blocks[current]?.needTopics.size ?? this.#topics.size) > 0;
    const reading = this.#reading;
    if (needed && !(reading && reading.start <= current && current <= reading.end)) {
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
      this.#reading = undefined;

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
    // Per block, the topics evicted in this pass: not loaded again before the playhead moves, so
    // two topics can't take room from each other back and forth
    const evicted = new Map<number, Set<string>>();

    for (;;) {
      const playhead = this.#playheadBlock();
      const fetchTopics = (id: number): Immutable<TopicSelection> => {
        const need = this.#blocks[id]?.needTopics ?? topics;
        const evictedHere = evicted.get(id);
        if (cappedAt.size === 0 && !evictedHere) {
          return need;
        }
        const distance = this.#distance(id, playhead);
        return new Map(
          [...need].filter(
            ([topic]) =>
              distance < (cappedAt.get(topic) ?? Infinity) && evictedHere?.has(topic) !== true,
          ),
        );
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

      // Read the neighboring blocks that need the same topics in the same read, as many as the
      // budget likely holds (each read reopens the source, decompressing the chunks at its ends
      // again): forward, and behind the playhead also backward, farthest block first
      const loadedBlocks = this.#blocks.filter((block) => (block?.sizeInBytes ?? 0) > 0).length;
      let room =
        loadedBlocks > 0
          ? Math.floor((budget.capacity - budget.used()) / (budget.used() / loadedBlocks))
          : Infinity;
      let endBlockId = blockId;
      while (
        room > 1 &&
        endBlockId + 1 < this.#blocks.length &&
        _.isEqual(fetchTopics(endBlockId + 1), topicsToFetch)
      ) {
        endBlockId++;
        room--;
      }
      while (
        room > 1 &&
        blockId < playhead &&
        blockId > 0 &&
        _.isEqual(fetchTopics(blockId - 1), topicsToFetch)
      ) {
        blockId--;
        room--;
      }
      this.#reading = { start: blockId, end: endBlockId };

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
        }

        // Over budget with the whole block (already read): drop topics no longer wanted, then make
        // room from other data, planned against the whole block so nothing is evicted for a block
        // that doesn't fit after all
        if (!budget.fits(0)) {
          budget.release(this.#removeUnusedBlockTopics());
        }
        if (!budget.fits(0)) {
          this.#evict(
            this.#distance(currentBlockId, this.#playheadBlock()),
            messagesByTopic,
            budget,
            evicted,
          );
        }
        const full = !budget.fits(0);

        if (full) {
          // Drop this block's read. The topics whose part of it can't fit even on its own stop
          // here for this pass; if each would fit on its own, the one that would then hold the most
          // stops. The block is read again for the others.
          budget.release(sizeInBytes);
          const distance = this.#distance(currentBlockId, this.#playheadBlock());
          const slice = (topic: string) => messagesByTopic[topic] ?? [];
          const fitsAlone = (topic: string) => {
            const used = budget.used() + this.#bytesOf(slice(topic));
            return (
              used <= budget.capacity ||
              this.#planEviction(distance, { [topic]: slice(topic) }, used, budget.capacity).fits
            );
          };
          const fetched = [...topicsToFetch.keys()];
          let stop = fetched.filter((topic) => !fitsAlone(topic));
          if (stop.length === 0) {
            const loadedBytes = this.#topicBytes();
            const most = _.maxBy(
              fetched,
              (topic) => (loadedBytes.get(topic) ?? 0) + this.#bytesOf(slice(topic)),
            );
            stop = most != undefined ? [most] : [];
          }
          for (const topic of stop) {
            cappedAt.set(topic, this.#distance(currentBlockId, playhead));
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
   * Frees loaded messages until `budget` fits, farthest from the playhead first, from topics holding
   * more than their fair share of the budget (counting `loading`, the block being read): of the
   * topics being loaded only what is farther than `distance`, of the others anything but the
   * playhead block, so a topic under its share takes room from one over it.
   */
  #evict(
    distance: number,
    loading: Record<string, MessageEvent[]>,
    budget: ByteBudget,
    evicted: Map<number, Set<string>>,
  ): void {
    const { plan, fits } = this.#planEviction(distance, loading, budget.used(), budget.capacity);
    if (!fits) {
      return;
    }
    for (const { id, topic } of plan) {
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
      const evictedHere = evicted.get(id) ?? new Set();
      evictedHere.add(topic);
      evicted.set(id, evictedHere);
    }
  }

  /**
   * What #evict would free to bring `used` bytes (counting `loading`) down to `capacity`, and
   * whether that is enough.
   */
  #planEviction(
    distance: number,
    loading: Record<string, MessageEvent[]>,
    used: number,
    capacity: number,
  ): { plan: { id: number; topic: string }[]; fits: boolean } {
    const topicBytes = this.#topicBytes();
    for (const [topic, messages] of Object.entries(loading)) {
      const bytes = messages.reduce((sum, message) => sum + message.sizeInBytes, 0);
      topicBytes.set(topic, (topicBytes.get(topic) ?? 0) + bytes);
    }
    const fairShare = capacity / Math.max(1, this.#topics.size);
    const playhead = this.#playheadBlock();
    const victims: { id: number; topic: string; distance: number }[] = [];
    for (const [id, block] of this.#blocks.entries()) {
      const blockDistance = this.#distance(id, playhead);
      if (!block) {
        continue;
      }
      for (const topic of Object.keys(block.messagesByTopic)) {
        if (
          (topicBytes.get(topic) ?? 0) > fairShare &&
          // Nearer data only of other topics, and never at the playhead
          (blockDistance > distance || (!(topic in loading) && blockDistance > 0))
        ) {
          victims.push({ id, topic, distance: blockDistance });
        }
      }
    }
    victims.sort((a, b) => b.distance - a.distance);
    // Evict only if that makes room: otherwise the block being read is dropped anyway and the
    // evicted data would be lost for nothing
    const plan: typeof victims = [];
    let freed = 0;
    for (const victim of victims) {
      if (used - freed <= capacity) {
        break;
      }
      const messages = this.#blocks[victim.id]?.messagesByTopic[victim.topic];
      if (!messages || (topicBytes.get(victim.topic) ?? 0) <= fairShare) {
        continue;
      }
      const bytes = this.#bytesOf(messages);
      topicBytes.set(victim.topic, (topicBytes.get(victim.topic) ?? 0) - bytes);
      freed += bytes;
      plan.push(victim);
    }
    return { plan, fits: used - freed <= capacity };
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
