// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { add, compare, fromNanoSec, subtract, toNanoSec } from "@foxglove/rostime";
import EventEmitter from "eventemitter3";
import * as _ from "lodash-es";

import Log from "@lichtblick/log";
import { MessageEvent, Time } from "@lichtblick/suite";
import { ByteBudget } from "@lichtblick/suite-base/players/ByteBudget";
import { TopicSelection } from "@lichtblick/suite-base/players/types";
import { Range } from "@lichtblick/suite-base/util/ranges";

import {
  GetBackfillMessagesArgs,
  IIterableSource,
  Initialization,
  IteratorResult,
  MessageIteratorArgs,
} from "./IIterableSource";

const log = Log.getLogger(__filename);

type CacheItem<MessageType> = [bigint, IteratorResult<MessageType>];

// An individual cache item represents a continuous range of CacheIteratorItems
type CacheBlock<MessageType> = {
  // Unique id of the cache item.
  id: bigint;

  // The start time of the cache item (inclusive).
  //
  // When reading a data source, the first message may come after the requested "start" time.
  // The start field is the request start time while the first item in items would be the first message
  // which may be after this time.
  //
  // The start time is <= first item time.
  start: Time;

  // The end time (inclusive) of the last message within the cache item. Similar to start, the data source
  // may "end" after the last message so.
  //
  // The end time is >= last item time.
  end: Time;

  // Sorted cache item tuples. The first value is the timestamp of the iterator result and the second is the result.
  items: CacheItem<MessageType>[];

  // Topics the block holds every message of (within its range). A read for fewer topics filters
  // the items, a read for more reads only the missing topics from the source.
  // Only topic names matter: sources below the cache ignore SubscribePayload.fields.
  topics: ReadonlySet<string>;

  // Set when the block was read skimmed and holds only some messages
  skimInterval?: Time;

  // The last time this block was accessed.
  lastAccess: number;

  // The size of this block in bytes
  size: number;
};

type Options = {
  maxBlockSize?: number;
  /** Required: the cache evicts blocks to stay under it */
  maxTotalSize: number;
};

interface EventTypes {
  /** Dispatched when the loaded ranges have changed. Use `loadedRanges()` to get the new ranges. */
  loadedRangesChange: () => void;
}

/**
 * CachingIterableSource proxies access to IIterableSource through a memory buffer.
 *
 * Message reading occurs from the memory buffer containing previously read messages. If there is no
 * buffer for previously read messages, then the underlying source is used and the messages are
 * cached when read.
 */
class CachingIterableSource<MessageType = unknown>
  extends EventEmitter<EventTypes>
  implements IIterableSource<MessageType>
{
  #source: IIterableSource<MessageType>;

  // Topics and skim interval of the latest messageIterator(); loadedRanges() counts only the
  // blocks that serve them
  #want?: { topics: ReadonlySet<string>; skimInterval?: Time };
  // False when no block can hold results #want doesn't need: skips scanning for them per message
  #maybeUnwanted = false;
  // Blocks a running read appends or merges into; their items can't be dropped meanwhile
  #writing = new Set<CacheBlock<MessageType>>();
  // Bytes of results on topics `want` lacks, per block items array (unchanged while not written)
  #unwantedBytesCache = new WeakMap<
    CacheItem<MessageType>[],
    { want: ReadonlySet<string>; count: number; bytes: number }
  >();

  // The producer loads results into the cache and the consumer reads from the cache.
  #cache: CacheBlock<MessageType>[] = [];

  // Cache of loaded ranges. Ranges correspond to the cache blocks and are normalized in [0, 1];
  #loadedRangesCache: Range[] = [{ start: 0, end: 0 }];
  // Set when the cache changed since #loadedRangesCache was computed; see #markLoadedRangesDirty
  #loadedRangesDirty = false;

  #initResult?: Initialization;
  // Where the source has new messages since the cache was filled (undefined: anywhere); the next
  // messageIterator() drops the cache blocks there
  #updated: { start: Time; end: Time }[] | undefined = [];

  #budget: ByteBudget;

  // Maximum size per block
  #maxBlockSizeBytes: number;

  // The current read head, used for determining which blocks are evictable
  #currentReadHead: Time = { sec: 0, nsec: 0 };

  #nextBlockId: bigint = BigInt(0);
  #evictableBlockCandidates: CacheBlock<MessageType>["id"][] = [];
  // Set when blocks were added, removed or closed, or the read head left #readHeadBlock, since
  // #evictableBlockCandidates was computed
  #candidatesStale = true;
  #readHeadBlock?: CacheBlock<MessageType>;

  public constructor(source: IIterableSource<MessageType>, opt: Options) {
    super();

    this.#source = source;
    this.#budget = new ByteBudget(opt.maxTotalSize);
    this.#maxBlockSizeBytes = opt.maxBlockSize ?? 52428800; // 50MB
  }

  public async initialize(): Promise<Initialization> {
    this.#initResult = await this.#source.initialize();
    return this.#initResult;
  }

  public async waitForUpdate(): Promise<Initialization | undefined> {
    const update = await this.#source.waitForUpdate?.();
    if (update) {
      this.#initResult = update;
      // Cached blocks may miss messages the grown source has (e.g. in newly indexed chunks)
      this.#updated = this.#updated &&
        update.updatedRanges && [...this.#updated, ...update.updatedRanges];
    }
    return update;
  }

  public async terminate(): Promise<void> {
    this.#cache.length = 0;
    this.#budget.reset();
    this.#candidatesStale = true;
    this.#readHeadBlock = undefined;
  }

  public loadedRanges(): Range[] {
    if (this.#loadedRangesDirty) {
      this.#loadedRangesDirty = false;
      this.#recomputeLoadedRangeCache();
    }
    return this.#loadedRangesCache;
  }

  public getCacheSize(): number {
    return this.#budget.used();
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult<MessageType>>> {
    if (!this.#initResult) {
      throw new Error("Invariant: uninitialized");
    }

    const maxEnd = args.end ?? this.#initResult.end;
    const maxEndNanos = toNanoSec(maxEnd);

    const updated = this.#updated;
    this.#updated = [];
    if (updated && updated.length > 0) {
      // Keep the blocks elsewhere: the source has the same messages there
      this.#cache = this.#cache.filter((block) => {
        const hit = updated.some(
          (range) => compare(block.start, range.end) <= 0 && compare(block.end, range.start) >= 0,
        );
        if (hit) {
          this.#budget.release(block.size);
        }
        return !hit;
      });
      this.#candidatesStale = true;
      this.#readHeadBlock = undefined;
      this.#markLoadedRangesDirty();
    }
    if (!updated) {
      log.debug("source changed - clearing cache, resetting range");
      this.#cache.length = 0;
      this.#budget.reset();
      this.#candidatesStale = true;
      this.#readHeadBlock = undefined;
      this.#markLoadedRangesDirty();
    }
    const want: ReadonlySet<string> = new Set(args.topics.keys());
    if (!_.isEqual(this.#want, { topics: want, skimInterval: args.skimInterval })) {
      this.#want = { topics: want, skimInterval: args.skimInterval };
      this.#maybeUnwanted = true;
      this.#markLoadedRangesDirty();
    }

    // Where we want to read messages from. As we move through blocks and messages, the read head
    // moves forward to track the next place we should be reading.
    let readHead = args.start ?? this.#initResult.start;

    const findIndexContainingPredicate = (item: CacheBlock<MessageType>) => {
      return compare(item.start, readHead) <= 0 && compare(item.end, readHead) >= 0;
    };

    const findAfterPredicate = (item: CacheBlock<MessageType>) => {
      // Find the first index where readHead is less than an existing start
      return compare(readHead, item.start) < 0;
    };

    this.#currentReadHead = readHead;
    this.#candidatesStale = true;

    for (;;) {
      if (compare(readHead, maxEnd) > 0) {
        break;
      }

      const cacheBlockIndex = this.#cache.findIndex(findIndexContainingPredicate);

      let block = this.#cache[cacheBlockIndex];

      // if the block start === end and done is false, then it could have been a new block we started but never
      // got around to adding any messages into, we remove it.
      if (block && compare(block.start, block.end) === 0 && block.items.length === 0) {
        block = undefined;
        this.#cache.splice(cacheBlockIndex, 1);
        this.#candidatesStale = true;
        continue;
      }

      // A skimmed block lacks messages a denser read wants: read the range again
      if (block && !CachingIterableSource.#SkimServes(block, args.skimInterval)) {
        this.#budget.release(block.size);
        this.#cache.splice(cacheBlockIndex, 1);
        this.#candidatesStale = true;
        this.#markLoadedRangesDirty();
        continue;
      }

      if (block && CachingIterableSource.#Lacks(block.topics, want)) {
        const fillEnd = compare(block.end, maxEnd) < 0 ? block.end : maxEnd;
        yield* this.#fillBlock(block, readHead, fillEnd, want, args);
        readHead = add(fillEnd, { sec: 0, nsec: 1 });
        continue;
      }

      // We've found a block containing our readHead, try reading items from the block
      if (block) {
        // The block holds every wanted topic (checked above): filter only if it holds more
        const filter = block.topics.size !== want.size;
        const cacheIndex = CachingIterableSource.#FindStartCacheItemIndex(
          block.items,
          toNanoSec(readHead),
        );

        // We have a cached item, we can consume our cache until we've read to the end
        for (let idx = cacheIndex; idx < block.items.length; ++idx) {
          const cachedItem = block.items[idx];
          if (!cachedItem) {
            break;
          }

          // We may have found a cached time that is after our max iterator time.
          // We bail with no return when that happens.
          if (cachedItem[0] > maxEndNanos) {
            return;
          }

          // update the last time this block was accessed
          block.lastAccess = Date.now();

          if (!filter || CachingIterableSource.#Wanted(cachedItem[1], want)) {
            yield cachedItem[1];
          }
        }

        // We've read all the messages cached for the block, this means our next read can start
        // at 1 nanosecond after the end of the block because we know that block.end is inclusive
        // of all the messages our block represents.
        readHead = add(block.end, { sec: 0, nsec: 1 });
        continue;
      }

      // We don't have a block for our readHead which meas we need to read from the source.
      // We start reading from the source where the readHead is. We end reading from the source
      // where the next block starts (or source.end if there is no next block)

      // The block (and source) will start at the read head
      const sourceReadStart = readHead;

      // Look for the block that comes after our read head
      const nextBlockIndex = this.#cache.findIndex(findAfterPredicate);

      // If we have a next block (this is the block ours would come before), then we only need
      // to read up to that block.
      const nextBlock = this.#cache[nextBlockIndex];

      let sourceReadEnd = nextBlock ? subtract(nextBlock.start, { sec: 0, nsec: 1 }) : maxEnd;

      if (compare(sourceReadStart, sourceReadEnd) > 0) {
        throw new Error("Invariant: sourceReadStart > sourceReadEnd");
      }

      // When reading for our message iterator, we might have a nextBlock that starts
      // after the end time we want to read. This limits our reading to the end time of the iterator.
      if (compare(sourceReadEnd, maxEnd) > 0) {
        sourceReadEnd = maxEnd;
      }

      const sourceMessageIterator = this.#source.messageIterator({
        topics: args.topics,
        start: sourceReadStart,
        end: sourceReadEnd,
        consumptionType: args.consumptionType,
        skimInterval: args.skimInterval,
      });

      // The cache is indexed on time, but iterator results that are problems might not have a time.
      // For these we use the lastTime that we knew about (or had a message for).
      // This variable tracks the last known time from a read.
      let lastTime = toNanoSec(sourceReadStart);

      const pendingIterResults: [bigint, IteratorResult<MessageType>][] = [];
      // Pending results are counted in #budget as they are read; false until the last of
      // them is stored in a block
      let stored = false;

      try {
        for await (const iterResult of sourceMessageIterator) {
          // if there is no block, we make a new block
          if (!block) {
            const newBlock: CacheBlock<MessageType> = {
              id: this.#nextBlockId++,
              start: readHead,
              end: readHead,
              items: [],
              size: 0,
              lastAccess: Date.now(),
              topics: want,
              skimInterval: args.skimInterval,
            };

            // Find where we need to insert our new block.
            // It should come before any blocks with a start time > than new block start time.
            const insertIndex = _.sortedIndexBy(this.#cache, newBlock, (item) =>
              toNanoSec(item.start),
            );
            this.#cache.splice(insertIndex, 0, newBlock);
            this.#candidatesStale = true;

            block = newBlock;
            this.#writing.add(block);
            this.#markLoadedRangesDirty();
          }

          // When receiving a message event or stamp, we update our known time on the block to the
          // stamp or receiveTime because we know we've received all the results up to this time
          if (iterResult.type === "message-event" || iterResult.type === "stamp") {
            const receiveTime =
              iterResult.type === "stamp" ? iterResult.stamp : iterResult.msgEvent.receiveTime;
            const receiveTimeNs = toNanoSec(receiveTime);

            // There might be multiple messages at the same time, and since block end time
            // is inclusive we only update the end time once we've moved to the next time
            if (receiveTimeNs > lastTime) {
              // write any pending messages to the block
              for (const pendingIterResult of pendingIterResults) {
                const item = pendingIterResult[1];
                const pendingSizeInBytes =
                  item.type === "message-event" ? item.msgEvent.sizeInBytes : 0;
                block.items.push(pendingIterResult);
                block.size += pendingSizeInBytes;
              }

              pendingIterResults.length = 0;

              // update the last time this block was accessed
              block.lastAccess = Date.now();

              // Set the end time to 1 nanosecond before the current receive time since we know we've
              // read up to this receive time.
              block.end = subtract(receiveTime, { sec: 0, nsec: 1 });

              lastTime = receiveTimeNs;
              this.#markLoadedRangesDirty();
            }
          }

          // Block is too big so we close it and will start a new one next loop
          if (block.size >= this.#maxBlockSizeBytes) {
            // The new block starts right after our previous one
            readHead = add(block.end, { sec: 0, nsec: 1 });

            // Will force creation of a new block on the next loop
            this.#doneWriting(block);
            block = undefined;
          }

          const sizeInBytes =
            iterResult.type === "message-event" ? iterResult.msgEvent.sizeInBytes : 0;
          if (
            this.#maybePurgeCache({
              activeBlock: block,
              sizeInBytes,
            })
          ) {
            this.#markLoadedRangesDirty();
          }

          // As we add items to pending we also consider them as part of the total size
          this.#budget.add(sizeInBytes);

          // Store the latest message in pending results and flush to the block when time moves forward
          pendingIterResults.push([lastTime, iterResult]);

          yield iterResult;
        }

        // We've finished reading our source to the end, close out the block
        if (block) {
          block.end = sourceReadEnd;
          // May now touch the next block, joining the read head's chain
          this.#candidatesStale = true;

          // update the last time this block was accessed
          block.lastAccess = Date.now();

          // write any pending messages to the block
          for (const pendingIterResult of pendingIterResults) {
            const item = pendingIterResult[1];
            const pendingSizeInBytes =
              item.type === "message-event" ? item.msgEvent.sizeInBytes : 0;
            block.items.push(pendingIterResult);
            block.size += pendingSizeInBytes;
          }

          this.#markLoadedRangesDirty();
        } else {
          // We don't have a block after finishing our source. This can happen if the last
          // thing we read in the source made our block be over size and we cycled to a new block.
          // This can also happen if there were no messages in our source range.
          //
          // Since we never loop again we need to insert an empty block from the readHead
          // to sourceReadEnd because we know there's nothing else in that range.
          const newBlock: CacheBlock<MessageType> = {
            id: this.#nextBlockId++,
            start: readHead,
            end: sourceReadEnd,
            items: pendingIterResults,
            size: 0,
            lastAccess: Date.now(),
            topics: want,
            skimInterval: args.skimInterval,
          };

          for (const pendingIterResult of pendingIterResults) {
            const item = pendingIterResult[1];
            const pendingSizeInBytes =
              item.type === "message-event" ? item.msgEvent.sizeInBytes : 0;
            newBlock.size += pendingSizeInBytes;
          }

          // Find where we need to insert our new block.
          // It should come before any blocks with a start time > than new block start time.
          const insertIndex = _.sortedIndexBy(this.#cache, newBlock, (item) =>
            toNanoSec(item.start),
          );
          this.#cache.splice(insertIndex, 0, newBlock);
          this.#candidatesStale = true;
          this.#doneWriting(newBlock);

          this.#markLoadedRangesDirty();
        }
        stored = true;
      } finally {
        if (block) {
          this.#doneWriting(block);
        }
        // A consumer that stops early (e.g. a seek) leaves results that were counted, not stored
        if (!stored) {
          for (const [, item] of pendingIterResults) {
            this.#budget.release(item.type === "message-event" ? item.msgEvent.sizeInBytes : 0);
          }
        }
      }

      // We've read everything there was to read for this source, so our next read will be after
      // the end of this source
      readHead = add(sourceReadEnd, { sec: 0, nsec: 1 });
    }
  }

  public async getBackfillMessages(
    args: GetBackfillMessagesArgs,
  ): Promise<MessageEvent<MessageType>[]> {
    if (!this.#initResult) {
      throw new Error("Invariant: uninitialized");
    }

    // The cache predates the latest update; the grown source may have newer messages in range
    if (this.#updated?.length !== 0) {
      return await this.#source.getBackfillMessages(args);
    }

    // Find a block that contains args.time. We must find a block that contains args.time rather
    // than one that occurs anytime before args.time to correctly get the last message before
    // args.time rather than any message that occurs before args.time.
    const cacheBlockIndex = this.#cache.findIndex((item) => {
      return compare(item.start, args.time) <= 0 && compare(item.end, args.time) >= 0;
    });

    const out: MessageEvent<MessageType>[] = [];
    const needsTopics = new Map(args.topics);
    // Topics the blocks can't answer: a block that lacks a topic can't tell whether the source
    // has a message on it in the block's range
    const sourceTopics: TopicSelection = new Map();

    // Starting at the block we found for args.time, work backwards through blocks until:
    // * we've loaded all the topics
    // * we have a gap between our block and the previous block
    //
    // We must stop going backwards when we have a gap because we can no longer know if the source
    // actually does have messages in the gap.
    for (let idx = cacheBlockIndex; idx >= 0 && needsTopics.size > 0; --idx) {
      const cacheBlock = this.#cache[idx];
      // Skimmed blocks may lack the latest message before args.time
      if (!cacheBlock || cacheBlock.skimInterval) {
        break;
      }
      for (const [topic, payload] of needsTopics) {
        if (!cacheBlock.topics.has(topic)) {
          needsTopics.delete(topic);
          sourceTopics.set(topic, payload);
        }
      }

      const targetTime = toNanoSec(args.time);
      // Last item at or before targetTime: we read backwards from there to find the latest
      // message on each requested topic.
      const readIdx =
        _.sortedLastIndexBy<readonly [bigint, unknown]>(
          cacheBlock.items,
          [targetTime, undefined],
          ([time]) => time,
        ) - 1;

      for (let i = readIdx; i >= 0; --i) {
        const record = cacheBlock.items[i];
        if (record?.[1].type !== "message-event") {
          continue;
        }

        const msgEvent = record[1].msgEvent;
        if (needsTopics.has(msgEvent.topic)) {
          needsTopics.delete(msgEvent.topic);
          out.push(msgEvent);
        }
      }

      const prevBlock = this.#cache[idx - 1];
      // If we have a gap between the start of our block and the previous block, then we must stop
      // trying to read from the block cache
      if (prevBlock && compare(add(prevBlock.end, { sec: 0, nsec: 1 }), cacheBlock.start) !== 0) {
        break;
      }
    }

    for (const [topic, payload] of needsTopics) {
      sourceTopics.set(topic, payload);
    }
    // If we found all our topics from our cache then we don't need to fallback to the source
    if (sourceTopics.size === 0) {
      return out;
    }

    // fallback to the source for any topics we weren't able to load
    const sourceBackfill = await this.#source.getBackfillMessages({
      ...args,
      topics: sourceTopics,
    });

    out.push(...sourceBackfill);
    out.sort((a, b) => compare(a.receiveTime, b.receiveTime));

    return out;
  }

  // Recomputing is O(blocks), and the cache changes on every new message timestamp. Defer the work
  // to loadedRanges() and emit once until the ranges are read again.
  #markLoadedRangesDirty(): void {
    if (this.#loadedRangesDirty) {
      return;
    }
    this.#loadedRangesDirty = true;
    this.emit("loadedRangesChange");
  }

  #recomputeLoadedRangeCache(): void {
    if (!this.#initResult) {
      throw new Error("Invariant: uninitialized");
    }

    // The nanosecond time of the start of the source
    const sourceStartNs = toNanoSec(this.#initResult.start);

    const rangeNs = Number(toNanoSec(subtract(this.#initResult.end, this.#initResult.start)));
    if (rangeNs === 0) {
      this.#loadedRangesCache = [{ start: 0, end: 1 }];
      return;
    }

    if (this.#cache.length === 0) {
      this.#loadedRangesCache = [{ start: 0, end: 0 }];
      return;
    }

    // Merge continuous ranges (i.e. a block that starts 1 nanosecond after previous ends)
    // This avoids float rounding errors when computing loadedRangesCache and produces
    // continuous ranges for continuous spans
    const ranges: { start: number; end: number }[] = [];
    let prevRange: { start: bigint; end: bigint } | undefined;
    const want = this.#want;
    for (const block of this.#cache) {
      // Blocks that lack a wanted topic, or are too sparse, still need reading
      if (
        want &&
        (!CachingIterableSource.#SkimServes(block, want.skimInterval) ||
          CachingIterableSource.#Lacks(block.topics, want.topics))
      ) {
        continue;
      }
      const range = {
        start: toNanoSec(block.start),
        end: toNanoSec(block.end),
      };
      if (!prevRange) {
        prevRange = range;
      } else if (prevRange.end + 1n === range.start) {
        prevRange.end = range.end;
      } else {
        ranges.push({
          start: Number(prevRange.start - sourceStartNs) / rangeNs,
          end: Number(prevRange.end - sourceStartNs) / rangeNs,
        });
        prevRange = range;
      }
    }
    if (ranges.length === 0 && !prevRange) {
      this.#loadedRangesCache = [{ start: 0, end: 0 }];
      return;
    }
    if (prevRange) {
      ranges.push({
        start: Number(prevRange.start - sourceStartNs) / rangeNs,
        end: Number(prevRange.end - sourceStartNs) / rangeNs,
      });
    }

    this.#loadedRangesCache = ranges;
  }

  /**
   * Update the current read head, such that the source can determine which blocks are evictable.
   * @param readHead current read head
   */
  public setCurrentReadHead(readHead: Time): void {
    this.#currentReadHead = readHead;
    const block = this.#readHeadBlock;
    if (!block || compare(block.start, readHead) > 0 || compare(block.end, readHead) < 0) {
      this.#candidatesStale = true;
    }
  }

  /**
   * Checks if the current cache size allows reading more messages into the cache or if there are
   * blocks that can be evicted.
   * @returns True if more messages can be read, false otherwise.
   */
  public canReadMore(): boolean {
    if (this.#budget.used() < this.#budget.capacity) {
      // Still room for reading new messages from the source.
      return true;
    }

    // Results on topics no longer wanted are dropped before the next read stores anything
    return (
      this.#evictableCandidates().length > 0 ||
      this.#trimmableBlocks().some((block) => this.#unwantedBytes(block) > 0)
    );
  }

  /**
   * Blocks that may hold results on topics the latest messageIterator() doesn't want, except
   * those a read is writing
   */
  #trimmableBlocks(): CacheBlock<MessageType>[] {
    const want = this.#want?.topics;
    if (!want || !this.#maybeUnwanted) {
      return [];
    }
    const blocks = this.#cache.filter(
      (block) => !this.#writing.has(block) && CachingIterableSource.#Lacks(want, block.topics),
    );
    // Blocks being written set it again when their read is done
    this.#maybeUnwanted = blocks.length > 0;
    return blocks;
  }

  /** Bytes of block's results on topics the latest messageIterator() doesn't want */
  #unwantedBytes(block: CacheBlock<MessageType>): number {
    const want = this.#want?.topics;
    if (!want) {
      return 0;
    }
    const cached = this.#unwantedBytesCache.get(block.items);
    if (cached?.want === want && cached.count === block.items.length) {
      return cached.bytes;
    }
    let bytes = 0;
    for (const [, result] of block.items) {
      if (!CachingIterableSource.#Wanted(result, want)) {
        bytes += CachingIterableSource.#Size(result);
      }
    }
    this.#unwantedBytesCache.set(block.items, { want, count: block.items.length, bytes });
    return bytes;
  }

  /** A read stopped writing block: from now on its unwanted results can be dropped */
  #doneWriting(block: CacheBlock<MessageType>): void {
    this.#writing.delete(block);
    const want = this.#want?.topics;
    if (want && CachingIterableSource.#Lacks(want, block.topics)) {
      this.#maybeUnwanted = true;
    }
  }

  /** The evictable block ids, most evictable first; recomputed only when blocks changed */
  #evictableCandidates(): CacheBlock<MessageType>["id"][] {
    if (this.#candidatesStale) {
      this.#candidatesStale = false;
      const readHead = this.#currentReadHead;
      this.#readHeadBlock = this.#cache.find(
        (block) => compare(block.start, readHead) <= 0 && compare(block.end, readHead) >= 0,
      );
      this.#evictableBlockCandidates = this.#findEvictableBlockCandidates(readHead);
    }
    return this.#evictableBlockCandidates;
  }

  /**
   * Determines which cache blocks can be evicted. A cache block is evictable, if
   * - its end time is before the given readHead
   * - it is not part of the continuous block chain starting from the block that contains
   *   the given readHead
   * @param readHead current read head
   * @returns A list of evictable blocks (ordered by most evictable first) or an empty list
   * if there is no evictable block.
   */
  #findEvictableBlockCandidates(readHead: Time): CacheBlock<MessageType>["id"][] {
    if (this.#cache.length === 0) {
      return [];
    }

    // Create a light, mutable copy of the current cache.
    const mappedCache = this.#cache.map((block) => ({
      id: block.id,
      start: block.start,
      end: block.end,
    }));
    // Sort blocks by time (earlier blocks first).
    mappedCache.sort((a, b) => compare(a.end, b.end));
    // Find the index of the block that contains the current read head.
    const readHeadIdx = mappedCache.findIndex(
      (block) => compare(block.start, readHead) <= 0 && compare(block.end, readHead) >= 0,
    );

    if (readHeadIdx === -1) {
      // No block contains current read head, return the oldest cache block.
      // This can only happen when seeked to a new time and no message has been read yet, as
      // reading a new message that does not fit in any block will always create a new cache block.
      const oldestBlock = _.minBy(this.#cache, (block) => block.lastAccess);
      if (!oldestBlock) {
        // This should never happen as the cache is not empty.
        throw new Error("Failed to retrieve oldest block from cache");
      }
      return [oldestBlock.id];
    }

    // Blocks that are before the read head can be evicted.
    const blockIdsBeforeReadHead = mappedCache.splice(0, readHeadIdx).map((item) => item.id);

    // Iterate through remaining blocks until we find a gap in the block chain
    let prevEnd: bigint | undefined;
    let idx = 0;
    for (idx = 0; idx < mappedCache.length; ++idx) {
      const block = mappedCache[idx]!;
      const start = toNanoSec(block.start);
      const end = toNanoSec(block.end);
      if (prevEnd == undefined || prevEnd + 1n === start) {
        prevEnd = end;
      } else {
        break;
      }
    }

    // All blocks that are not part of the first block chain can be considered evictable.
    const blockIdsAfterGap = mappedCache.splice(idx).map((item) => item.id);

    return [
      ...blockIdsBeforeReadHead,
      ...blockIdsAfterGap.reverse(), // Reverse order (furthest away from read head first)
    ];
  }

  // Evicts blocks until sizeInBytes more fit in the budget or nothing else is evictable. The cache
  // exceeds the budget only by what it can't evict: the blocks from the read head on, which the
  // reader stops filling once canReadMore() is false.
  // @return true if a block was purged
  #maybePurgeCache(opt: { activeBlock?: CacheBlock<MessageType>; sizeInBytes: number }): boolean {
    const { activeBlock, sizeInBytes } = opt;

    if (this.#maybeUnwanted && !this.#budget.fits(sizeInBytes)) {
      this.#trimUnwanted();
    }
    let purged = false;
    while (!this.#budget.fits(sizeInBytes)) {
      const blockId = this.#evictableCandidates().shift();
      if (blockId == undefined) {
        break;
      }
      const idx = this.#cache.findIndex((item) => item.id === blockId);
      const block = this.#cache[idx];
      if (!block || block === activeBlock) {
        continue;
      }
      this.#budget.release(block.size);
      this.#cache.splice(idx, 1);
      purged = true;
    }
    return purged;
  }

  /**
   * Drops the results on topics the latest messageIterator() doesn't want. Kept while there's room,
   * so re-subscribing is free; under budget pressure they go before any wanted block, including
   * those from the read head on, which can't be evicted.
   */
  #trimUnwanted(): void {
    const want = this.#want?.topics;
    if (!want) {
      return;
    }
    for (const block of this.#trimmableBlocks()) {
      if (this.#unwantedBytes(block) > 0) {
        block.items = block.items.filter(([, result]) =>
          CachingIterableSource.#Wanted(result, want),
        );
        const size = CachingIterableSource.#SumSizes(block.items);
        this.#budget.release(block.size - size);
        block.size = size;
      }
      block.topics = new Set([...block.topics].filter((topic) => want.has(topic)));
    }
  }

  /**
   * Reads the wanted topics `block` lacks from `readHead` to `end` and merges them into it,
   * yielding the merged results on `want`. The filled part becomes blocks with both topic sets
   * (split every #maxBlockSizeBytes); the rest of `block`, e.g. after an early return, keeps its own.
   */
  async *#fillBlock(
    block: CacheBlock<MessageType>,
    readHead: Time,
    end: Time,
    want: ReadonlySet<string>,
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult<MessageType>>> {
    if (compare(block.start, readHead) < 0) {
      this.#splitBlock(block, readHead);
    }
    const missing: TopicSelection = new Map(
      [...args.topics].filter(([topic]) => !block.topics.has(topic)),
    );
    const topics = new Set([...block.topics, ...missing.keys()]);

    // Merged results not yet moved into a filled block, sorted by time
    const merged: CacheItem<MessageType>[] = [];
    let mergedSize = 0;
    // Next item of block to merge
    let oldIdx = 0;
    // Every result up to filledNs, from block and from the source, is in merged
    let filledNs = toNanoSec(readHead) - 1n;
    let lastTime = toNanoSec(readHead);
    // Bytes of source results after filledNs, counted in #budget
    let pendingSize = 0;

    // Set once all of block is filled: it holds the merged results, nothing more to cut from it
    let blockFilled = false;
    // Moves the merged results up to timeNs into a block of their own, cut from the front of block
    const commit = (timeNs: bigint) => {
      if (blockFilled || timeNs < toNanoSec(block.start)) {
        return;
      }
      const items = merged.splice(
        0,
        _.sortedLastIndexBy<readonly [bigint, unknown]>(merged, [timeNs, undefined], ([t]) => t),
      );
      const size = CachingIterableSource.#SumSizes(items);
      mergedSize -= size;
      let filled = block;
      blockFilled = timeNs >= toNanoSec(block.end);
      if (!blockFilled) {
        filled = this.#splitBlock(block, fromNanoSec(timeNs + 1n));
        oldIdx -= filled.items.length;
      }
      filled.items = items;
      filled.topics = topics;
      // Source results' bytes are in #budget already, block's moved along with them
      filled.size = size;
      filled.lastAccess = Date.now();
      this.#maybeUnwanted = true;
      this.#markLoadedRangesDirty();
    };

    const filter = topics.size !== want.size;
    const endNs = toNanoSec(end);
    let source: AsyncIterator<Readonly<IteratorResult<MessageType>>> | undefined;
    try {
      this.#writing.add(block);
      source = this.#source.messageIterator({
        topics: missing,
        start: readHead,
        end,
        consumptionType: args.consumptionType,
        skimInterval: block.skimInterval,
      });
      for (;;) {
        const next = await source.next();
        // undefined: the source is done, merge the rest of block up to end
        let result = next.done === true ? undefined : next.value;
        let resultNs =
          result == undefined
            ? endNs
            : result.type === "message-event"
              ? toNanoSec(result.msgEvent.receiveTime)
              : result.type === "stamp"
                ? toNanoSec(result.stamp)
                : lastTime;
        // Past the end: block's range can't hold it, so the source is done for this fill
        if (resultNs > endNs) {
          result = undefined;
          resultNs = endNs;
        }
        // An out-of-order result is stored at the latest time, like the source read path does,
        // so merged stays sorted
        const timeNs = resultNs > lastTime ? resultNs : lastTime;
        // Merge block's results before timeNs first (inline: a generator per result is slow).
        // Those at timeNs too unless a message comes next: a cached stamp at timeNs must not
        // come before it, as the player ends a tick at a stamp.
        const mergeUntilNs = result?.type === "message-event" ? timeNs - 1n : timeNs;
        for (; oldIdx < block.items.length; ++oldIdx) {
          const item = block.items[oldIdx]!;
          if (item[0] > mergeUntilNs) {
            break;
          }
          merged.push(item);
          mergedSize += CachingIterableSource.#Size(item[1]);
          if (!filter || CachingIterableSource.#Wanted(item[1], want)) {
            yield item[1];
          }
        }
        if (result == undefined) {
          break;
        }
        if (timeNs > lastTime) {
          // The source is sorted: nothing more comes before timeNs
          lastTime = timeNs;
          filledNs = timeNs - 1n;
          pendingSize = 0;
          if (mergedSize >= this.#maxBlockSizeBytes) {
            commit(filledNs);
          }
        }

        const size = CachingIterableSource.#Size(result);
        if (this.#maybePurgeCache({ activeBlock: block, sizeInBytes: size })) {
          this.#markLoadedRangesDirty();
        }
        this.#budget.add(size);
        pendingSize += size;
        merged.push([timeNs, result]);
        mergedSize += size;
        yield result;
      }
      filledNs = endNs;
      pendingSize = 0;
    } finally {
      commit(filledNs);
      // Unfilled source results are dropped; block keeps its own results after filledNs
      this.#budget.release(pendingSize);
      this.#writing.delete(block);
      this.#maybeUnwanted = true;
      this.#candidatesStale = true;
      this.#markLoadedRangesDirty();
      try {
        await source?.return?.();
      } catch (err: unknown) {
        // Don't hide the error that ended the fill, if any
        log.error("Failed to close the fill read", err);
      }
    }
  }

  /** Cuts the part of block before `at` into a new block, inserted before it */
  #splitBlock(block: CacheBlock<MessageType>, at: Time): CacheBlock<MessageType> {
    const items = block.items.splice(
      0,
      _.sortedIndexBy<readonly [bigint, unknown]>(
        block.items,
        [toNanoSec(at), undefined],
        ([t]) => t,
      ),
    );
    const head: CacheBlock<MessageType> = {
      ...block,
      id: this.#nextBlockId++,
      end: subtract(at, { sec: 0, nsec: 1 }),
      items,
      size: CachingIterableSource.#SumSizes(items),
    };
    block.start = at;
    block.size -= head.size;
    this.#cache.splice(this.#cache.indexOf(block), 0, head);
    this.#candidatesStale = true;
    return head;
  }

  /**
   * Whether block has every message a read with skimInterval wants. A skimmed block only serves
   * the same interval: sources pick messages relative to window boundaries, so a shorter interval
   * doesn't cover a longer one.
   */
  static #SkimServes(block: CacheBlock<unknown>, skimInterval: Time | undefined): boolean {
    return (
      !block.skimInterval ||
      (skimInterval != undefined && compare(block.skimInterval, skimInterval) === 0)
    );
  }

  /** Whether `have` lacks any of `want` */
  static #Lacks(have: ReadonlySet<string>, want: Iterable<string>): boolean {
    for (const topic of want) {
      if (!have.has(topic)) {
        return true;
      }
    }
    return false;
  }

  static #Wanted(result: IteratorResult, want: ReadonlySet<string>): boolean {
    return result.type !== "message-event" || want.has(result.msgEvent.topic);
  }

  static #Size(result: IteratorResult): number {
    return result.type === "message-event" ? result.msgEvent.sizeInBytes : 0;
  }

  static #SumSizes(items: readonly CacheItem<unknown>[]): number {
    return _.sumBy(items, ([, result]) => CachingIterableSource.#Size(result));
  }

  static #FindStartCacheItemIndex(items: [bigint, IteratorResult][], key: bigint) {
    // A common case is to access consecutive blocks during playback. In that case, we expect to
    // read from the first item in the block. We check this special case first to avoid a binary
    // search if we are able to find the key in the first item.
    if (items[0] != undefined && items[0][0] >= key) {
      return 0;
    }

    // First item at or after key
    return _.sortedIndexBy<readonly [bigint, unknown]>(items, [key, undefined], ([time]) => time);
  }
}

export { CachingIterableSource };
