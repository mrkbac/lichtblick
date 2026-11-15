// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * `reopen` (e.g. from a file handle) replaces a stale `file`: browsers refuse to read a File
 * snapshot once the file on disk has changed, which a file that is still being written always does.
 */
export class BlobReadable {
  public constructor(
    public file: Blob,
    private reopen?: () => Promise<Blob>,
  ) {}
  public async size(): Promise<bigint> {
    return BigInt(this.file.size);
  }
  public async read(offset: bigint, size: bigint): Promise<Uint8Array> {
    if (offset + size > this.file.size) {
      throw new Error(
        `Read of ${size} bytes at offset ${offset} exceeds file size ${this.file.size}`,
      );
    }
    const read = async () =>
      new Uint8Array(await this.file.slice(Number(offset), Number(offset + size)).arrayBuffer());
    try {
      return await read();
    } catch (error) {
      if (!this.reopen) {
        throw error;
      }
      this.file = await this.reopen();
      return await read();
    }
  }
}
