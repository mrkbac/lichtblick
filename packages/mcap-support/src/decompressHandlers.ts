// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { McapTypes } from "@mcap/core";

let handlersPromise: Promise<McapTypes.DecompressHandlers> | undefined;
export async function loadDecompressHandlers(): Promise<McapTypes.DecompressHandlers> {
  return await (handlersPromise ??= _loadDecompressHandlers());
}

// eslint-disable-next-line no-underscore-dangle
async function _loadDecompressHandlers(): Promise<McapTypes.DecompressHandlers> {
  const [decompressZstd, decompressLZ4, bzip2] = await Promise.all([
    import("@foxglove/wasm-zstd").then(async (mod) => {
      await mod.isLoaded;
      return mod.decompress;
    }),
    import("@foxglove/wasm-lz4").then(async (mod) => {
      await mod.default.isLoaded;
      return mod.default;
    }),
    import("@foxglove/wasm-bz2").then(async (mod) => await mod.default.init()),
  ]);

  return {
    lz4: (buffer, decompressedSize): Uint8Array => {
      const decompressed = decompressLZ4(buffer, Number(decompressedSize));
      return view(decompressed);
    },

    bz2: (buffer, decompressedSize): Uint8Array => {
      const decompressed = bzip2.decompress(buffer, Number(decompressedSize), { small: false });
      return view(decompressed);
    },

    zstd: (buffer, decompressedSize): Uint8Array => {
      const decompressed = decompressZstd(buffer, Number(decompressedSize));
      return view(decompressed);
    },
  };
}

/** A Uint8Array on the same memory: each decompressor already returns a fresh copy of its output */
function view(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
