// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Binary min-heap with only what the indexed reader needs to merge chunk cursors: the smallest
 * item is `peek()`; after it changes in place, `replace()` sinks it to its new position.
 */
export class MinHeap<T> {
  readonly #items: T[] = [];
  readonly #compare: (a: T, b: T) => number;

  public constructor(compare: (a: T, b: T) => number) {
    this.#compare = compare;
  }

  public peek(): T | undefined {
    return this.#items[0];
  }

  public push(item: T): void {
    const items = this.#items;
    let i = items.push(item) - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.#compare(items[parent]!, item) <= 0) {
        break;
      }
      items[i] = items[parent]!;
      i = parent;
    }
    items[i] = item;
  }

  /** Removes and returns the smallest item. */
  public pop(): T | undefined {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      this.#sinkFromTop(last!);
    }
    return top;
  }

  /** Replaces the smallest item with `item` (which may be the same, changed object). */
  public replace(item: T): void {
    if (this.#items.length === 0) {
      this.#items.push(item);
      return;
    }
    this.#sinkFromTop(item);
  }

  #sinkFromTop(item: T): void {
    const items = this.#items;
    const n = items.length;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= n) {
        break;
      }
      if (child + 1 < n && this.#compare(items[child + 1]!, items[child]!) < 0) {
        child++;
      }
      if (this.#compare(items[child]!, item) >= 0) {
        break;
      }
      items[i] = items[child]!;
      i = child;
    }
    items[i] = item;
  }
}
