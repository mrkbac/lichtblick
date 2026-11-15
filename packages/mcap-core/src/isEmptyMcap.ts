// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MCAP_MAGIC, Opcode } from "./constants.ts";

/**
 * True if an MCAP file holds no message: only its header, e.g. a recording cut off before its first
 * chunk was written. Only small files are read; anything bigger has data.
 */
export async function isEmptyMcap(file: Blob): Promise<boolean> {
  const MAX_EMPTY_BYTES = 64 * 1024;
  if (file.size > MAX_EMPTY_BYTES) {
    return false;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!MCAP_MAGIC.every((byte, i) => bytes[i] === byte)) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Records follow the magic: opcode (1), content length (8), content; a finished file ends with
  // the magic again. Anything that doesn't add up exactly counts as data, since an empty file gets
  // deleted.
  for (let offset = MCAP_MAGIC.length; offset < bytes.length; ) {
    if (
      offset > MCAP_MAGIC.length &&
      offset + MCAP_MAGIC.length === bytes.length &&
      MCAP_MAGIC.every((byte, i) => bytes[offset + i] === byte)
    ) {
      return true;
    }
    if (offset + 9 > bytes.length) {
      return false;
    }
    const opcode = bytes[offset]!;
    if (offset === MCAP_MAGIC.length && opcode !== Opcode.HEADER) {
      return false;
    }
    if (opcode === Opcode.MESSAGE || opcode === Opcode.CHUNK) {
      return false;
    }
    const end = BigInt(offset) + 9n + view.getBigUint64(offset + 1, true);
    if (end > BigInt(bytes.length)) {
      return false;
    }
    offset = Number(end);
  }
  // Magic only, without a header: not something this app wrote.
  return bytes.length > MCAP_MAGIC.length;
}
