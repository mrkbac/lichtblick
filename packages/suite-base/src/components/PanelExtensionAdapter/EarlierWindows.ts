// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare, Time } from "@foxglove/rostime";

import { MessageEvent } from "@lichtblick/suite";

/**
 * For a consumer of a playhead-first range read (see BuiltinRangeOptions.playheadFirst) whose
 * store can only append: collects each window of history earlier than what it loaded in a store
 * of its own, and puts it in front once the window ends.
 */
export class EarlierWindows<T> {
  readonly #create: () => T;
  readonly #prepend: (earlier: T) => void;
  /** The time span loaded so far, and the earlier window being collected */
  #loaded?: { first: Time; last: Time };
  #earlier?: { first: Time; last: Time; store: T };

  public constructor(create: () => T, prepend: (earlier: T) => void) {
    this.#create = create;
    this.#prepend = prepend;
  }

  /**
   * Where `batch` goes: undefined when it comes after everything loaded (append it as usual), else
   * the store collecting its window of earlier history.
   */
  public place(batch: readonly MessageEvent[]): T | undefined {
    const first = batch[0]?.receiveTime;
    const last = batch.at(-1)?.receiveTime;
    if (!first || !last) {
      return undefined;
    }
    if (!this.#loaded || compare(first, this.#loaded.last) >= 0) {
      this.flush();
      this.#loaded ??= { first, last };
      this.#loaded.last = last;
      return undefined;
    }
    if (!this.#earlier || compare(first, this.#earlier.last) < 0) {
      // An earlier window starts
      this.flush();
      this.#earlier = { first, last, store: this.#create() };
    }
    this.#earlier.last = last;
    return this.#earlier.store;
  }

  /**
   * Reads `iterator`, handing each batch to `onBatch` with where it goes (see place), and puts the
   * last earlier window in front at the end. Once `cancelled()` it stops and leaves that window out:
   * the stores may belong to a newer read by then. Returns whether it read to the end.
   */
  public async read(
    iterator: AsyncIterable<readonly MessageEvent[]>,
    cancelled: () => boolean,
    onBatch: (batch: readonly MessageEvent[], into: T | undefined) => void,
  ): Promise<boolean> {
    for await (const batch of iterator) {
      if (cancelled()) {
        return false;
      }
      onBatch(batch, this.place(batch));
    }
    if (cancelled()) {
      return false;
    }
    this.flush();
    return true;
  }

  /** Puts the earlier window collected so far in front; call it when the read ends */
  public flush(): void {
    if (this.#earlier && this.#loaded) {
      this.#prepend(this.#earlier.store);
      this.#loaded.first = this.#earlier.first;
    }
    this.#earlier = undefined;
  }
}
