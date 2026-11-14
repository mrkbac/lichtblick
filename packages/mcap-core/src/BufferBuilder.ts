// SPDX-FileCopyrightText: Copyright (c) Foxglove Technologies Inc
// SPDX-License-Identifier: MIT

const LITTLE_ENDIAN = true;

/**
 * BufferBuilder provides methods to create a buffer from primitive values. The buffer grows as
 * needed.
 *
 * Each method on buffer builder appends the value to the end of the buffer.
 *
 * A buffer can be reset to re-use the underlying memory and start writing at the start of the buffer.
 */
export class BufferBuilder {
  #fullBuffer = new Uint8Array(4096);
  #view: DataView;
  #textEncoder = new TextEncoder();

  // location of the write head - new writes will start here
  #offset = 0;

  public constructor() {
    this.#view = new DataView(this.#fullBuffer.buffer);
  }

  /**
   * Length in bytes of the written buffer
   */
  public get length(): number {
    return this.#offset;
  }

  /** Returns a copy of the written data. */
  public get buffer(): Readonly<Uint8Array> {
    return this.#fullBuffer.slice(0, this.#offset);
  }

  /** Returns a temporary view into the underlying buffer (not a copy). */
  public bufferView(byteOffset: number, byteLength: number): Uint8Array {
    return new Uint8Array(this.#fullBuffer.buffer, byteOffset, byteLength);
  }

  public int8(value: number): this {
    this.#ensureAdditionalCapacity(1);
    this.#view.setInt8(this.#offset, value);
    this.#offset += 1;
    return this;
  }
  public uint8(value: number): this {
    this.#ensureAdditionalCapacity(1);
    this.#view.setUint8(this.#offset, value);
    this.#offset += 1;
    return this;
  }
  public int16(value: number): this {
    this.#ensureAdditionalCapacity(2);
    this.#view.setInt16(this.#offset, value, LITTLE_ENDIAN);
    this.#offset += 2;
    return this;
  }
  public uint16(value: number): this {
    this.#ensureAdditionalCapacity(2);
    this.#view.setUint16(this.#offset, value, LITTLE_ENDIAN);
    this.#offset += 2;
    return this;
  }
  public int32(value: number): this {
    this.#ensureAdditionalCapacity(4);
    this.#view.setInt32(this.#offset, value, LITTLE_ENDIAN);
    this.#offset += 4;
    return this;
  }
  public uint32(value: number): this {
    this.#ensureAdditionalCapacity(4);
    this.#view.setUint32(this.#offset, value, LITTLE_ENDIAN);
    this.#offset += 4;
    return this;
  }
  public int64(value: bigint): this {
    this.#ensureAdditionalCapacity(8);
    this.#view.setBigInt64(this.#offset, value, LITTLE_ENDIAN);
    this.#offset += 8;
    return this;
  }
  public uint64(value: bigint): this {
    this.#ensureAdditionalCapacity(8);
    this.#view.setBigUint64(this.#offset, value, LITTLE_ENDIAN);
    this.#offset += 8;
    return this;
  }
  public string(value: string): this {
    const stringBytes = this.#textEncoder.encode(value);
    this.#ensureAdditionalCapacity(stringBytes.byteLength + 4);
    this.uint32(stringBytes.length);
    this.#fullBuffer.set(stringBytes, this.#offset);
    this.#offset += stringBytes.length;
    return this;
  }
  public bytes(buffer: Uint8Array): this {
    this.#ensureAdditionalCapacity(buffer.byteLength);
    this.#fullBuffer.set(buffer, this.#offset);
    this.#offset += buffer.length;
    return this;
  }
  public tupleArray<T1, T2>(
    write1: (_: T1) => void,
    write2: (_: T2) => void,
    array: Iterable<[T1, T2]>,
  ): this {
    // We placeholder the byte length of the array and will come back to
    // set it once we have written the array items
    const sizeOffset = this.#offset;
    this.uint32(0); // placeholder length of 0

    for (const [key, value] of array) {
      write1.call(this, key);
      write2.call(this, value);
    }
    const currentOffset = this.#offset;

    // go back and write the actual byte length of the array
    this.#offset = sizeOffset;
    const byteLength = currentOffset - sizeOffset - 4;
    this.uint32(byteLength);

    // put the offset back to after the array items
    this.#offset = currentOffset;
    return this;
  }

  /**
   * Move the write head to offset bytes from the start of the buffer.
   *
   * If the buffer is smaller than the new offset location, the buffer expands.
   */
  public seek(offset: number): this {
    this.#ensureCapacity(offset);
    this.#offset = offset;
    return this;
  }

  /**
   * reset the write head to the start of the buffer
   */
  public reset(): this {
    this.#offset = 0;
    return this;
  }

  #ensureAdditionalCapacity(capacity: number): void {
    this.#ensureCapacity(this.#offset + capacity);
  }

  #ensureCapacity(capacity: number): void {
    if (capacity > this.#fullBuffer.byteLength) {
      const newSize = Math.max(this.#fullBuffer.byteLength * 1.5, capacity);
      const newBuffer = new Uint8Array(newSize);
      newBuffer.set(this.#fullBuffer);

      this.#fullBuffer = newBuffer;
      this.#view = new DataView(this.#fullBuffer.buffer);
    }
  }
}
