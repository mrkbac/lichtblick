// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** Regrowth headroom, so a slowly growing count doesn't reallocate on every new maximum */
const GROWTH = 1.5;
/** A fit is small when the count uses less than 1/SHRINK_BELOW of the capacity */
const SHRINK_BELOW = 4;
/**
 * Shrink only after this many small fits in a row: sizes that take turns (a large and a small
 * cloud sharing a buffer, a cloud that is sometimes empty) keep the capacity instead of
 * reallocating on every call.
 */
const SHRINK_AFTER = 30;

/**
 * Capacity of a reusable buffer: grows right away (the first allocation is exact, regrowth adds
 * headroom), shrinks once the count has stayed small for a while.
 */
export class ElasticCapacity {
  public capacity = 0;
  #smallFits = 0;

  /**
   * @param minShrinkCapacity capacities up to this are never shrunk, nor shrunk below it
   * @param maxHeadroom headroom never grows the capacity past this
   */
  public constructor(
    private readonly minShrinkCapacity: number,
    private readonly maxHeadroom = Infinity,
  ) {}

  /** The capacity to reallocate to for `count` items, or undefined to keep the current buffer. */
  public fit(count: number): number | undefined {
    const capacity = this.capacity;
    if (count > capacity) {
      this.#smallFits = 0;
      this.capacity =
        capacity === 0
          ? count
          : Math.max(count, Math.min(Math.ceil(capacity * GROWTH), this.maxHeadroom));
      return this.capacity;
    }
    if (capacity <= this.minShrinkCapacity || count * SHRINK_BELOW >= capacity) {
      this.#smallFits = 0;
      return undefined;
    }
    if (++this.#smallFits < SHRINK_AFTER) {
      return undefined;
    }
    this.#smallFits = 0;
    this.capacity = Math.max(this.minShrinkCapacity, Math.ceil(count * GROWTH));
    return this.capacity;
  }
}
