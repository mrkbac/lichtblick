// SPDX-FileCopyrightText: Copyright (c) Foxglove Technologies Inc
// SPDX-License-Identifier: MIT

// For performance reasons we use a single TextDecoder instance whose internal state is merely
// the encoding (defaults to UTF-8). This means that a TextDecoder.decode() call is not affected
// by previous calls. `ignoreBOM` keeps a leading U+FEFF as part of the string: MCAP strings are
// stored verbatim. Invalid bytes still decode to U+FFFD so a file with one bad string stays readable.
const textDecoder = new TextDecoder("utf-8", { ignoreBOM: true });

/**
 * Cursor over a `DataView` that reads little-endian primitives, strings, and maps.
 *
 * This is a low-level binary parser used by {@link parseMagic} and {@link parseRecord}. It is not
 * an MCAP file reader; use {@link McapIndexedReader} or {@link McapRecoveryScanner} to read MCAP
 * files.
 */
export default class McapByteReader {
  #view: DataView;
  #viewU8: Uint8Array;
  /** Current read position in bytes from the start of the view. */
  public offset: number;

  public constructor(view: DataView, offset = 0) {
    this.#view = view;
    this.#viewU8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    this.offset = offset;
  }

  /**
   * Reinitialize the reader for a new view without allocating a new instance.
   *
   * Used internally to avoid allocation / GC overhead when the view changes.
   */
  public reset(view: DataView, offset = 0): void {
    this.#view = view;
    this.#viewU8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    this.offset = offset;
  }

  /** Number of unread bytes remaining in the view. */
  public bytesRemaining(): number {
    return this.#viewU8.length - this.offset;
  }

  /** Read an unsigned 8-bit integer and advance the offset. */
  public uint8(): number {
    const value = this.#view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  /** Read an unsigned 16-bit little-endian integer and advance the offset. */
  public uint16(): number {
    const value = this.#view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  /** Read an unsigned 32-bit little-endian integer and advance the offset. */
  public uint32(): number {
    const value = this.#view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  /** Read an unsigned 64-bit little-endian integer and advance the offset. */
  public uint64(): bigint {
    const value = this.#view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  /**
   * Read a length-prefixed UTF-8 string (uint32 length, then that many bytes) and advance the
   * offset.
   */
  public string(): string {
    const length = this.uint32();
    if (length === 0) {
      return "";
    } else if (length > this.bytesRemaining()) {
      throw new Error(`String length ${length} exceeds bounds of buffer`);
    }
    return textDecoder.decode(this.u8ArrayBorrow(length));
  }

  /**
   * Read a length-prefixed sequence of key-value pairs (uint32 byte length of the entries, then
   * entries until that many bytes have been consumed).
   */
  public keyValuePairs<K, V>(
    readKey: (reader: McapByteReader) => K,
    readValue: (reader: McapByteReader) => V,
  ): [K, V][] {
    const length = this.uint32();
    if (this.offset + length > this.#view.byteLength) {
      throw new Error(`Key-value pairs length ${length} exceeds bounds of buffer`);
    }
    const result: [K, V][] = [];
    const endOffset = this.offset + length;
    try {
      while (this.offset < endOffset) {
        result.push([readKey(this), readValue(this)]);
      }
    } catch (err) {
      throw new Error(
        `Error reading key-value pairs: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (this.offset !== endOffset) {
      throw new Error(
        `Key-value pairs length (${
          this.offset - endOffset + length
        }) greater than expected (${length})`,
      );
    }
    return result;
  }

  /**
   * Read a length-prefixed map (uint32 byte length of the entries, then key-value entries until
   * that many bytes have been consumed). Duplicate keys are an error.
   */
  public map<K, V>(
    readKey: (reader: McapByteReader) => K,
    readValue: (reader: McapByteReader) => V,
  ): Map<K, V> {
    const length = this.uint32();
    if (this.offset + length > this.#view.byteLength) {
      throw new Error(`Map length ${length} exceeds bounds of buffer`);
    }
    const result = new Map<K, V>();
    const endOffset = this.offset + length;
    try {
      while (this.offset < endOffset) {
        const key = readKey(this);
        const value = readValue(this);
        if (result.has(key)) {
          throw new Error(
            `Duplicate key ${String(key)} (${String(result.get(key))} vs ${String(value)})`,
          );
        }
        result.set(key, value);
      }
    } catch (err) {
      throw new Error(`Error reading map: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (this.offset !== endOffset) {
      throw new Error(
        `Map length (${this.offset - endOffset + length}) greater than expected (${length})`,
      );
    }
    return result;
  }

  /**
   * Read `length` bytes as a view into the underlying buffer and advance the offset.
   *
   * The returned array shares memory with the source buffer. Do not use it after the source
   * buffer is reused or after the reader is reset. Use {@link u8ArrayCopy} when the data must
   * outlive the current parse.
   */
  public u8ArrayBorrow(length: number): Uint8Array {
    if (!(length >= 0 && length <= this.bytesRemaining())) {
      throw new Error(`Byte array length ${length} exceeds bounds of buffer`);
    }
    const result = this.#viewU8.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }

  /**
   * Read `length` bytes as a copy of the underlying buffer and advance the offset.
   *
   * Unlike {@link u8ArrayBorrow}, the returned array does not share memory with the source buffer.
   */
  public u8ArrayCopy(length: number): Uint8Array {
    if (!(length >= 0 && length <= this.bytesRemaining())) {
      throw new Error(`Byte array length ${length} exceeds bounds of buffer`);
    }
    const result = this.#viewU8.slice(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
}
