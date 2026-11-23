// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";

import {
  IIterableSource,
  Initialization,
  IteratorResult,
} from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";

// Contract a caller supplies to HydratedSourcePool for a hydrated (heavyweight) value.
export type SourceHydrator<T> = {
  // Create the heavyweight value (open readable, build reader, parse channels, ...).
  open: () => Promise<T>;
  // Release the heavyweight value (close readable/connection, drop references).
  close: (value: T) => Promise<void>;
  // Optional estimated resident memory (bytes) of the hydrated value, used by the byte budget.
  // When omitted, every entry weighs 1 so the pool behaves as a pure count cap.
  weigh?: (value: T) => number;
};

export type HydratedSourcePoolOptions = {
  // Primary limiter: evict LRU unpinned entries while total estimated bytes exceeds this.
  maxBytes?: number;
  // Safety cap on resident entry count (bounds open connections/readers regardless of weight).
  maxCount?: number;
};

export type MultiSource = (
  | {
      type: "files";
      // Local files; a string is a remote URL, so a comparison can mix both
      files: (Blob | string)[];
    }
  | {
      type: "urls";
      urls: string[];
      credentials?: RequestCredentials;
    }
) & {
  // Keep recordings apart instead of merging them: the side name of each file/URL, in order. Each
  // side's topics go under its own prefix (/a, /b, … in order of first appearance), files with the
  // same side name are merged, and every side is shifted to start at the same time.
  compare?: readonly string[];
  /** Initial offsets in seconds, in order of first appearance of each side. */
  compareOffsets?: readonly number[];
};

export type IterableSourceConstructor<T extends IIterableSource, P> = new (args: P) => T;

export type InitMetadata = Initialization["metadata"];

export type InitTopicStatsMap = Initialization["topicStats"];

export type SourceWithTime = {
  source: IIterableSource;
  startTime: Time;
  endTime: Time;
};

export type SequentialIteratorMergeOptions<T extends IteratorResult> = {
  value: T;
  iterator: AsyncIterableIterator<Readonly<IteratorResult>>;
};
