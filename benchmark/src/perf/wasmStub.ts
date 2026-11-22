// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Stands in for @foxglove/wasm-lz4 and @foxglove/wasm-bz2 in the perf bundle: under Node their
// Emscripten loaders look for the WASM relative to the working directory. The bench file is zstd.
const unavailable = Object.assign(
  () => {
    throw new Error("lz4/bz2 are not available in the perf bench");
  },
  { isLoaded: Promise.resolve(), init: async () => unavailable },
);

export default unavailable;
