// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as Comlink from "@foxglove/comlink";

import { IterableSourceInitializeArgs } from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";
import { WorkerIterableSourceWorker } from "@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSourceWorker";

import { SyncFile } from "./WasmDataLoader";
import { WasmDataLoaderIterableSource } from "./WasmDataLoaderIterableSource";

// The loader reads files synchronously, which only a worker can do with a File.
// ponytail: one FileReaderSync call per guest read; add a block cache if loaders do many tiny reads.
function syncFile(file: File): SyncFile {
  const reader = new FileReaderSync();
  return {
    size: file.size,
    read: (offset, length) =>
      new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + length))),
  };
}

export async function initialize(
  args: IterableSourceInitializeArgs,
): Promise<WorkerIterableSourceWorker<Uint8Array>> {
  const files = args.files ?? (args.file ? [args.file] : []);
  if (!args.wasmUrl || files.length === 0) {
    throw new Error("wasmUrl and files required");
  }
  const response = await fetch(args.wasmUrl);
  const wasm = await WebAssembly.compile(await response.arrayBuffer());
  const source = new WasmDataLoaderIterableSource(
    wasm,
    new Map(files.map((file) => [file.name, syncFile(file)])),
  );
  return Comlink.proxy(new WorkerIterableSourceWorker(source));
}

Comlink.expose(initialize);
