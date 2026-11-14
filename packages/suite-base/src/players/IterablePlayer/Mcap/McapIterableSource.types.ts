// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { McapIndexedReader } from "@mcap/core";

import type { ISerializedIterableSource } from "../IIterableSource";
import type { LiveReader } from "./McapRecoveryScanner";
import type { RemoteFileReadable } from "./RemoteFileReadable";
import type { RemoteFileReadableOptions } from "./RemoteFileReadable.types";
import type { HydratedSourcePool } from "../shared/HydratedSourcePool";

export type McapSource =
  // `handle`: follow the file while it is still being written (see McapIterableSource)
  | { type: "file"; file: Blob; handle?: FileSystemFileHandle; pool?: HydratedSourcePool }
  | ({ type: "url"; url: string; pool?: HydratedSourcePool } & RemoteFileReadableOptions);

export type HydratedInner = {
  inner: ISerializedIterableSource;
  readable?: RemoteFileReadable;
  weightBytes: number;
};

export type IndexedReaderResult =
  | { status: "indexed"; reader: McapIndexedReader }
  | { status: "unindexed" }
  | { status: "recover"; error: Error };

export type OpenedInner = {
  inner: ISerializedIterableSource;
  readable?: RemoteFileReadable;
  indexed: boolean;
  weightBytes: number;
  /** For a reader on a rebuilt index: adds what was indexed since (see openLiveReader) */
  live?: LiveReader;
};
