// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Plain MSB-first bit reader for VP9 and AV1 headers. Unlike {@link Bitstream}, it does not strip
 * H.26x emulation-prevention bytes, which would corrupt these bitstreams.
 */
export class BitReader {
  readonly #data: Uint8Array;
  #offset = 0;

  public constructor(data: Uint8Array) {
    this.#data = data;
  }

  /** Reads `width` (≤ 32) bits as an unsigned number; throws when the data runs out. */
  public read(width: number): number {
    if (this.#offset + width > this.#data.byteLength * 8) {
      throw new Error("Bitstream exhausted");
    }
    let value = 0;
    for (let i = 0; i < width; i++) {
      const byte = this.#data[this.#offset >> 3]!;
      value = value * 2 + ((byte >> (7 - (this.#offset & 7))) & 1);
      this.#offset++;
    }
    return value;
  }

  public flag(): boolean {
    return this.read(1) === 1;
  }
}
