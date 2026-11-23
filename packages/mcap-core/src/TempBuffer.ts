// SPDX-FileCopyrightText: Copyright (c) Foxglove Technologies Inc
// SPDX-License-Identifier: MIT

import type { IWritable } from "./IWritable.ts";
import type { IReadable } from "./types.ts";

/**
 * In-memory buffer used for reading and writing MCAP files in tests. Can be used as both an IReadable and an IWritable.
 */
export class TempBuffer implements IReadable, IWritable {
  #buffer = new ArrayBuffer(0);
  #position = 0;

  public constructor(source?: ArrayBufferView | ArrayBuffer) {
    if (source instanceof ArrayBuffer) {
      this.#buffer = source;
    } else if (source) {
      this.#buffer = new Uint8Array(
        source.buffer,
        source.byteOffset,
        source.byteLength,
      ).slice().buffer;
    }
  }

  #setCapacity(capacity: number) {
    if (this.#buffer.byteLength !== capacity) {
      const newBuffer = new ArrayBuffer(capacity);
      new Uint8Array(newBuffer).set(
        new Uint8Array(this.#buffer, 0, Math.min(this.#buffer.byteLength, capacity)),
      );
      this.#buffer = newBuffer;
    }
  }

  public position(): bigint {
    return BigInt(this.#position);
  }

  public async write(data: Uint8Array): Promise<void> {
    if (this.#position + data.byteLength > this.#buffer.byteLength) {
      this.#setCapacity(this.#position + data.byteLength);
    }
    new Uint8Array(this.#buffer, this.#position).set(data);
    this.#position += data.byteLength;
  }

  public async size(): Promise<bigint> {
    return BigInt(this.#buffer.byteLength);
  }

  public async read(offset: bigint, size: bigint): Promise<Uint8Array> {
    if (offset < 0n || offset + size > BigInt(this.#buffer.byteLength)) {
      throw new Error("read out of range");
    }
    return new Uint8Array(this.#buffer, Number(offset), Number(size));
  }

  public get(): Uint8Array {
    return new Uint8Array(this.#buffer);
  }
}
