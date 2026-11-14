// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as Comlink from "@foxglove/comlink";

import { IterableSourceInitializeArgs } from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";
import { WorkerIterableSourceWorker } from "@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSourceWorker";

import { CsvIterableSource } from "./CsvIterableSource";

export function initialize(args: IterableSourceInitializeArgs): WorkerIterableSourceWorker {
  const files = args.files ?? (args.file ? [args.file] : []);
  if (files.length === 0) {
    throw new Error("file required");
  }
  return Comlink.proxy(new WorkerIterableSourceWorker(new CsvIterableSource(files)));
}

Comlink.expose(initialize);
