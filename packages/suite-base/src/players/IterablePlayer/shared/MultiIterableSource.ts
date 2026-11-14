// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time, compare, fromNanoSec } from "@foxglove/rostime";
import { Semaphore } from "async-mutex";

import Logger from "@lichtblick/log";
import {
  IterableSourceConstructor,
  MultiSource,
} from "@lichtblick/suite-base/players/IterablePlayer/shared/types";
import {
  accumulateMap,
  mergeMetadata,
  mergeTopicStats,
  setEndTime,
  setStartTime,
} from "@lichtblick/suite-base/players/IterablePlayer/shared/utils/mergeInitialization";
import { mergeSequentialIterators } from "@lichtblick/suite-base/players/IterablePlayer/shared/utils/mergeSequentialIterators";
import {
  filterSourcesForBackfill,
  filterSourcesByTimeRange,
} from "@lichtblick/suite-base/players/IterablePlayer/shared/utils/sourceTimeOverlap";
import {
  validateAndAddNewTopics,
  validateAndAddNewDatatypes,
} from "@lichtblick/suite-base/players/IterablePlayer/shared/utils/validateInitialization";
import { MessageEvent } from "@lichtblick/suite-base/players/types";

import {
  IIterableSource,
  IteratorResult,
  Initialization,
  MessageIteratorArgs,
  GetBackfillMessagesArgs,
  ISerializedIterableSource,
} from "../IIterableSource";
import { ComparedSource, compareLabel } from "./ComparedSource";
import { HydratedSourcePool } from "./HydratedSourcePool";

const log = Logger.getLogger(__filename);

// Default total cache budget for remote sources, matching the single-file default.
const DEFAULT_CACHE_TOTAL_BYTES = 1024 * 1024 * 500; // 500 MiB

// Floor per-source cache so large fan-out sessions still fit at least one MCAP summary/index read.
const MIN_CACHE_PER_SOURCE_BYTES = 1024 * 1024 * 10; // 10 MiB

// Small bounded multi-file read-ahead that coalesces sequential remote reads without outrunning
// the per-source cache budget.
const DEFAULT_READ_AHEAD_BUFFER_BYTES = 1024 * 1024 * 2; // 2 MiB

// Defaults for the optional MultiSourceHydrationOptions overrides (see shared/types.ts for the
// rationale behind each knob). Heuristic; tune against real datasets.
const DEFAULT_INIT_CONCURRENCY = 4;
// Raising the resident-reader budget made multi-file OOMs worse because evicted sources must fully
// rebuild their reader, cache, and parsed channels on re-hydration.
// Keep the smaller defaults until eviction can preserve the cheap per-source connection/cache
// while only dropping heavyweight reader state.
const DEFAULT_MAX_HYDRATED_SOURCES = 4;
const DEFAULT_MAX_HYDRATED_BYTES = 1024 * 1024 * 512; // 512 MiB

// Earliest-by-start sources to prewarm for t=0 playback. Not part of MultiSourceHydrationOptions:
// intentionally fixed and small to avoid a large open/request burst.
const PREWARM_EARLIEST_COUNT = 3;

// Each update makes the player reload its preloaded blocks, so the sources' updates (each file
// publishes on its own clock) are merged into one per interval.
export const MIN_UPDATE_INTERVAL_MS = 2000;

export class MultiIterableSource<T extends ISerializedIterableSource, P>
  implements ISerializedIterableSource
{
  public readonly sourceType = "serialized";
  private SourceConstructor: IterableSourceConstructor<T, P>;
  private dataSource: MultiSource;
  private sourceImpl: IIterableSource<Uint8Array>[] = [];
  #pool: HydratedSourcePool | undefined;
  // Each source's newest Initialization, in the order of `#sources`
  #inits: Initialization[] = [];
  #sources: IIterableSource<Uint8Array>[] = [];
  #changed = false;
  // What the pending updates changed (see Initialization.updatedRanges); undefined: anything
  #updatedRanges: Initialization["updatedRanges"] = [];
  // Sources that may still publish updates (e.g. whose index is still being rebuilt)
  #updating = 0;
  #wake: (() => void) | undefined;
  #lastUpdate = 0;
  // Skip the update throttle once, e.g. for a change the user is waiting on
  #urgent = false;
  // When comparing: one source per side, and the time all sides are aligned to start at
  #compared: ComparedSource[] | undefined;
  #compareStart: Time | undefined;
  // Sources built by the caller (e.g. the files of one compared side), instead of from `dataSource`
  readonly #prebuilt: IIterableSource<Uint8Array>[] | undefined;

  public constructor(
    dataSource: MultiSource,
    SourceConstructor: IterableSourceConstructor<T, P>,
    prebuilt?: IIterableSource<Uint8Array>[],
  ) {
    this.dataSource = dataSource;
    this.SourceConstructor = SourceConstructor;
    this.#prebuilt = prebuilt;
  }

  private async loadMultipleSources(): Promise<Initialization[]> {
    const { type } = this.dataSource;
    const concurrency = this.dataSource.initConcurrency ?? DEFAULT_INIT_CONCURRENCY;
    if (this.#prebuilt) {
      this.sourceImpl.push(...this.#prebuilt);
      return await this.initializeSources(this.#prebuilt, concurrency);
    }

    // Construct one bounded reader pool before branching; files and URLs use the same overrides.
    const maxHydratedCount = this.dataSource.maxHydratedSources ?? DEFAULT_MAX_HYDRATED_SOURCES;
    const maxHydratedBytes = this.dataSource.maxHydratedBytes ?? DEFAULT_MAX_HYDRATED_BYTES;
    this.#pool = new HydratedSourcePool({
      maxBytes: maxHydratedBytes,
      maxCount: maxHydratedCount,
    });

    let sources: IIterableSource<Uint8Array>[];
    if (type === "files") {
      sources = this.dataSource.files.map(
        (file) => new this.SourceConstructor({ type: "file", file, pool: this.#pool } as P),
      );
    } else {
      // Split remote cache budget across sources, but keep a floor so large fan-out sessions do
      // not drop below a single MCAP metadata read and crash CachedFilelike.
      const totalCache: number = this.dataSource.totalCacheSizeInBytes ?? DEFAULT_CACHE_TOTAL_BYTES;
      const minPerSource: number =
        this.dataSource.minCachePerSourceBytes ?? MIN_CACHE_PER_SOURCE_BYTES;
      const numSources: number = this.dataSource.urls.length;
      const perSourceCache: number = Math.max(minPerSource, Math.floor(totalCache / numSources));

      if (perSourceCache * numSources > totalCache) {
        log.warn(
          `Cache budget (${totalCache} bytes) is less than minimum per-source cache ` +
            `(${minPerSource} bytes) × ${numSources} sources. ` +
            `Each source will use ${perSourceCache} bytes; total may exceed budget.`,
        );
      }

      // Keep read-ahead enabled by default so sequential remote reads still coalesce into fewer
      // requests, but pair it with a small bounded buffer to stay within the per-source cache.
      // Callers can still opt out with readAheadEnabled: false.
      const readAheadEnabled: boolean = this.dataSource.readAheadEnabled ?? true;
      const readAheadBufferBytes: number | undefined =
        this.dataSource.readAheadBufferBytes ??
        (numSources > 1
          ? Math.min(DEFAULT_READ_AHEAD_BUFFER_BYTES, Math.floor(perSourceCache / 4))
          : undefined);

      const credentials = this.dataSource.credentials;
      sources = this.dataSource.urls.map(
        (url) =>
          new this.SourceConstructor({
            type: "url",
            url,
            credentials,
            cacheSizeInBytes: perSourceCache,
            readAheadEnabled,
            readAheadBufferBytes,
            pool: this.#pool,
          } as P),
      );
    }

    // Bound local and remote initialization (`concurrency`): concurrent MCAP summary parsing can
    // spike worker memory in large multi-file sessions.
    const sideNames = this.dataSource.compare;
    if (sideNames == undefined || sideNames.length !== sources.length) {
      this.sourceImpl.push(...sources);
      return await this.initializeSources(sources, concurrency);
    }

    // One compared source per side name, in order of first appearance; a side of several files
    // merges them first
    const names = [...new Set(sideNames)];
    const compared = names.map((name, side) => {
      const members = sources.filter((_, index) => sideNames[index] === name);
      const merged =
        members.length === 1
          ? members[0]!
          : new MultiIterableSource(
              { ...this.dataSource, compare: undefined },
              this.SourceConstructor,
              members,
            );
      return new ComparedSource(merged, `/${compareLabel(side)}`, name);
    });
    this.#compared = compared;
    this.sourceImpl.push(...compared);
    const initializations = await this.initializeSources(compared, concurrency);
    const earliest = initializations.reduce(
      (min, init) => (compare(init.start, min) < 0 ? init.start : min),
      initializations[0]!.start,
    );
    this.#compareStart = earliest;
    return compared.map((source) => source.alignStartTo(earliest));
  }

  /** Move each compared side by `offsetsSec[i]` seconds; reported through waitForUpdate() */
  public async setCompareOffsets(offsetsSec: readonly number[]): Promise<void> {
    if (!this.#compared || !this.#compareStart) {
      return;
    }
    // Times can't go below zero: a side moved before time zero moves every side later instead
    const earliestOffset = Math.min(0, ...offsetsSec);
    const lowest = fromNanoSec(BigInt(Math.round(-earliestOffset * 1e9)));
    const start = compare(this.#compareStart, lowest) < 0 ? lowest : this.#compareStart;
    this.#compared.forEach((source, side) => {
      const init = source.alignStartTo(start, offsetsSec[side] ?? 0);
      const index = this.#sources.indexOf(source);
      if (index >= 0) {
        this.#inits[index] = init;
      }
    });
    // Every message moved
    this.#updatedRanges = undefined;
    this.#changed = true;
    this.#urgent = true;
    this.#wake?.();
  }

  private async initializeSources(
    sources: IIterableSource<Uint8Array>[],
    concurrency: number,
  ): Promise<Initialization[]> {
    // Normalize overrides to a positive integer permit count.
    const floored = Math.floor(concurrency);
    const permits = Number.isFinite(floored) && floored >= 1 ? floored : 1;
    const semaphore = new Semaphore(permits);
    // Promise.all preserves input order regardless of settle order, so the returned
    // initializations stay aligned with `sources`.
    return await Promise.all(
      sources.map(
        async (source) => await semaphore.runExclusive(async () => await source.initialize()),
      ),
    );
  }

  public async initialize(): Promise<Initialization> {
    const initializations: Initialization[] = await this.loadMultipleSources();

    const resultInit: Initialization = this.mergeInitializations(initializations);

    this.#inits = initializations;
    this.#sources = [...this.sourceImpl];
    if (this.#compared) {
      // Offsets can change at any time, so a comparison never stops updating
      this.#updating += 1;
    }
    this.#sources.forEach((source, index) => {
      if (source.waitForUpdate) {
        this.#updating += 1;
        void this.#followUpdates(source, index);
      }
    });

    this.#sortSources();

    // Warm earliest sources so t=0 playback does not stall re-hydrating them.
    await this.#prewarmEarliestSources();

    return resultInit;
  }

  #sortSources(): void {
    this.sourceImpl.sort((a, b) => {
      const aStart = a.getStart?.() ?? { sec: 0, nsec: 0 };
      const bStart = b.getStart?.() ?? { sec: 0, nsec: 0 };
      return compare(aStart, bStart);
    });
  }

  async #followUpdates(source: IIterableSource<Uint8Array>, index: number): Promise<void> {
    try {
      for (;;) {
        const init = await source.waitForUpdate?.();
        if (!init) {
          return;
        }
        this.#inits[index] = init;
        this.#changed = true;
        this.#updatedRanges = this.#updatedRanges &&
          init.updatedRanges && [...this.#updatedRanges, ...init.updatedRanges];
        this.#wake?.();
      }
    } catch (error) {
      log.error("Source update failed", error);
    } finally {
      this.#updating -= 1;
      this.#wake?.();
    }
  }

  /**
   * Resolves with the merged Initialization whenever one of the sources has grown (at most once per
   * MIN_UPDATE_INTERVAL_MS), and with undefined once none of them can grow any more.
   */
  public async waitForUpdate(): Promise<Initialization | undefined> {
    while (!this.#changed && this.#updating > 0) {
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
    if (!this.#changed) {
      return undefined;
    }
    // The last update (no source can grow any more) goes out right away
    const until = this.#lastUpdate + MIN_UPDATE_INTERVAL_MS;
    while (this.#updating > 0 && Date.now() < until && !this.#urgent) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, until - Date.now());
        this.#wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    this.#lastUpdate = Date.now();
    this.#changed = false;
    this.#urgent = false;
    this.#sortSources();
    const merged = this.mergeInitializations(this.#inits);
    merged.updatedRanges = this.#updatedRanges;
    this.#updatedRanges = [];
    return merged;
  }

  // Touch earliest sources in descending start order so the earliest become most-recently-used.
  // Prewarm failures are non-fatal; the source will hydrate on demand later.
  async #prewarmEarliestSources(): Promise<void> {
    if (!this.#pool) {
      return;
    }
    const warmCount = Math.min(PREWARM_EARLIEST_COUNT, this.sourceImpl.length);
    for (let index = warmCount - 1; index >= 0; index--) {
      try {
        await this.sourceImpl[index]?.prewarm?.();
      } catch (err) {
        log.debug("prewarmEarliestSources: source prewarm failed", err);
      }
    }
  }

  public async *messageIterator(
    opt: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
    // Restrict iteration to sources overlapping the requested time range to avoid irrelevant
    // remote reads during block loading.
    const relevantSources = filterSourcesByTimeRange(this.sourceImpl, opt.start, opt.end);

    // Start later iterators only when playback reaches their start time, avoiding concurrent
    // byte-range requests to all remote MCAP files.
    yield* mergeSequentialIterators(relevantSources, opt);
  }
  public async getBackfillMessages(
    args: GetBackfillMessagesArgs,
  ): Promise<MessageEvent<Uint8Array>[]> {
    // Only consider sources that could contain messages at or before the backfill time.
    const relevantSources = filterSourcesForBackfill(this.sourceImpl, args.time);

    // Iterate newest-first so we start near the seek target and stop once every topic has a value,
    // avoiding redundant reads from earlier sources.
    const backfillMessages: MessageEvent<Uint8Array>[] = [];
    const missingTopics = new Map(args.topics);

    for (let index = relevantSources.length - 1; index >= 0; index--) {
      if (missingTopics.size === 0) {
        break;
      }

      const source = relevantSources[index]!;
      // Pass a snapshot of the still-missing topics so later mutation of `missingTopics` cannot
      // alias the map handed to the source.
      const topicsForSource = new Map(missingTopics);
      const messages = await source.getBackfillMessages({ ...args, topics: topicsForSource });
      if (messages.length === 0) {
        continue;
      }

      backfillMessages.push(...messages);
      for (const message of messages) {
        missingTopics.delete(message.topic);
      }
    }

    return backfillMessages;
  }

  public async terminate(): Promise<void> {
    try {
      // Attempt every source terminate; one rejection must not skip the others or the pool teardown.
      const results = await Promise.allSettled(
        this.sourceImpl.map(async (source) => await source.terminate?.()),
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (rejected.length > 0) {
        for (const failure of rejected) {
          log.error("MultiIterableSource source terminate failed", failure.reason);
        }
        throw rejected[0]!.reason;
      }
    } finally {
      // Always tear down the pool, even if a source failed to terminate.
      await this.#pool?.terminate();
    }
  }

  private mergeInitializations(initializations: Initialization[]): Initialization {
    const resultInit: Initialization = {
      start: { sec: Number.MAX_SAFE_INTEGER, nsec: Number.MAX_SAFE_INTEGER },
      end: { sec: Number.MIN_SAFE_INTEGER, nsec: Number.MIN_SAFE_INTEGER },
      datatypes: new Map(),
      metadata: [],
      alerts: [],
      profile: "",
      publishersByTopic: new Map(),
      topics: [],
      topicStats: new Map(),
    };

    for (const init of initializations) {
      if (init.recordingFiles) {
        resultInit.recordingFiles = [...(resultInit.recordingFiles ?? []), ...init.recordingFiles];
      }
      resultInit.start = setStartTime(resultInit.start, init.start);
      resultInit.end = setEndTime(resultInit.end, init.end);

      resultInit.profile = init.profile ?? resultInit.profile;
      resultInit.publishersByTopic = accumulateMap(
        resultInit.publishersByTopic,
        init.publishersByTopic,
      );
      resultInit.topicStats = mergeTopicStats(resultInit.topicStats, init.topicStats);
      resultInit.metadata = mergeMetadata(resultInit.metadata, init.metadata);
      resultInit.alerts.push(...init.alerts);
      validateAndAddNewDatatypes(resultInit, init);
      validateAndAddNewTopics(resultInit, init);
    }
    if (this.#compared) {
      resultInit.compareSides = this.#compared.map((source) => source.side());
    }
    // A partial container summary would understate storage and channel totals.
    if (initializations.some((init) => init.recordingFiles == undefined)) {
      resultInit.recordingFiles = undefined;
    }
    return resultInit;
  }
}
