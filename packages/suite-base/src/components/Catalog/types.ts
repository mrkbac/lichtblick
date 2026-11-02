// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";

/**
 * How to open a catalog entry. A local folder scan produces "local-file" entries; served catalogs
 * will produce the remote types.
 */
export type CatalogSource =
  | { type: "local-file"; path: string }
  | { type: "remote-file"; url: string }
  | { type: "foxglove-websocket"; url: string };

export type CatalogTopic = {
  name: string;
  schema: string;
  messages?: number;
};

/** What reading an MCAP summary yields; cached per file. */
export type CatalogSummary = {
  /** Message time bounds, ignoring outlier stamps (e.g. 1970 or far future) when possible. */
  start?: Time;
  end?: Time;
  messages?: number;
  topics?: CatalogTopic[];
  /** The file has no summary section, so nothing is known without a full scan. */
  noSummary?: boolean;
  /** Reading the summary failed. */
  error?: string;
};

export type CatalogRecording = CatalogSummary & {
  /** Stable and unique within the catalog. */
  id: string;
  name: string;
  source: CatalogSource;
  size?: number;
};
