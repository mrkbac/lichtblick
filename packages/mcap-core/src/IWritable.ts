// SPDX-FileCopyrightText: Copyright (c) Foxglove Technologies Inc
// SPDX-License-Identifier: MIT

/**
 * IWritable describes a writer interface.
 */
export interface IWritable {
  // Write buffer to the output
  write(buffer: Uint8Array): Promise<unknown>;

  // The current position in bytes from the start of the output
  position(): bigint;
}
