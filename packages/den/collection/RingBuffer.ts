// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** Read-only view of a {@link RingBuffer}, for handing history to consumers. */
export interface ReadonlyRingBuffer<T> extends Iterable<T> {
  readonly capacity: number;
  /** Number of retained items. */
  size(): number;
  /**
   * Total items ever pushed (not reset by eviction). The retained item at index `i` has sequence
   * number `pushed() - size() + i`, so consumers can process only what is new since they last
   * looked, see {@link since}.
   */
  pushed(): number;
  /** Item at `index` (0 = oldest retained), or undefined when out of range. */
  at(index: number): T | undefined;
  last(): T | undefined;
  /** Retained items with sequence number `>= seq`, oldest first. */
  since(seq: number): T[];
  toArray(): T[];
}

/**
 * Fixed-capacity history: pushing beyond `capacity` evicts the oldest item. Push is O(1) and never
 * copies the retained items, so a growing live history costs the same per message at any length.
 *
 * The capacity is required and must be a finite, non-negative integer: an unbounded history is
 * exactly the bug class this type exists to prevent.
 */
export class RingBuffer<T> implements ReadonlyRingBuffer<T> {
  public readonly capacity: number;
  #items: T[] = [];
  /** Index of the oldest item in #items once the buffer has wrapped. */
  #head = 0;
  #pushed = 0;

  public constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      throw new RangeError(`RingBuffer capacity must be a finite integer >= 0, got ${capacity}`);
    }
    this.capacity = capacity;
  }

  /** A buffer holding the newest `capacity` items of `items`. */
  public static from<T>(capacity: number, items: Iterable<T>): RingBuffer<T> {
    const buffer = new RingBuffer<T>(capacity);
    buffer.pushAll(items);
    return buffer;
  }

  public size(): number {
    return this.#items.length;
  }

  public pushed(): number {
    return this.#pushed;
  }

  public push(item: T): void {
    this.#pushed++;
    if (this.capacity === 0) {
      return;
    }
    if (this.#items.length < this.capacity) {
      this.#items.push(item);
      return;
    }
    this.#items[this.#head] = item;
    this.#head = (this.#head + 1) % this.capacity;
  }

  public pushAll(items: Iterable<T>): void {
    for (const item of items) {
      this.push(item);
    }
  }

  public at(index: number): T | undefined {
    const size = this.#items.length;
    if (!Number.isInteger(index) || index < 0 || index >= size) {
      return undefined;
    }
    return this.#items[(this.#head + index) % size];
  }

  public last(): T | undefined {
    return this.at(this.#items.length - 1);
  }

  public since(seq: number): T[] {
    const first = this.#pushed - this.#items.length;
    const out: T[] = [];
    for (let i = Math.max(0, seq - first); i < this.#items.length; i++) {
      out.push(this.at(i)!);
    }
    return out;
  }

  public toArray(): T[] {
    return this.since(0);
  }

  public clear(): void {
    this.#items = [];
    this.#head = 0;
  }

  public *[Symbol.iterator](): Iterator<T> {
    for (let i = 0; i < this.#items.length; i++) {
      yield this.at(i)!;
    }
  }
}
