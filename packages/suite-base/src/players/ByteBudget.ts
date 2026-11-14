// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

function assertByteCount(bytes: number, what: string): void {
  if (!(Number.isFinite(bytes) && bytes >= 0)) {
    throw new Error(`Invariant: ${what} must be a finite, non-negative byte count, got ${bytes}`);
  }
}

/**
 * The bytes a message cache holds, against a fixed cap. Caches count every message they keep and
 * free here, so the cap can't be skipped:
 * - the cap is required, finite and positive (no `Infinity`, no default);
 * - a size that is NaN, negative or infinite (e.g. a message without `sizeInBytes`) throws instead
 *   of silently turning the count into NaN, which compares false against every cap;
 * - freeing more than was counted throws, catching double frees.
 */
export class ByteBudget {
  public readonly capacity: number;
  #used = 0;

  public constructor(capacity: number) {
    assertByteCount(capacity, "budget capacity");
    if (capacity === 0) {
      throw new Error("Invariant: budget capacity must be positive");
    }
    this.capacity = capacity;
  }

  public used(): number {
    return this.#used;
  }

  /** Whether `bytes` more stay within the cap */
  public fits(bytes: number): boolean {
    return this.#used + bytes <= this.capacity;
  }

  public add(bytes: number): void {
    assertByteCount(bytes, "message size");
    this.#used += bytes;
  }

  public release(bytes: number): void {
    assertByteCount(bytes, "message size");
    // Sizes may be fractional, so allow rounding error
    if (bytes > this.#used + 1) {
      throw new Error(`Invariant: released ${bytes} bytes but only ${this.#used} are counted`);
    }
    this.#used = Math.max(0, this.#used - bytes);
  }

  public reset(): void {
    this.#used = 0;
  }
}
