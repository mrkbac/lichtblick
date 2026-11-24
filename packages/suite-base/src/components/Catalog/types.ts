// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";

import type { PreviewFrame } from "./preview";

/**
 * How to open a catalog entry. A local folder scan produces "local-file" entries; a catalog URL
 * produces the remote types.
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
export type CatalogTrack = {
  topic: string;
  /** [longitude, latitude] pairs (GeoJSON order), sampled over the recording. */
  points: [number, number][];
};

export type CatalogEvent = {
  name: string;
  start: Time;
  end?: Time;
};

export type CatalogSummary = {
  events?: CatalogEvent[];
  eventsTruncated?: boolean;
  eventsError?: boolean;
  /** Message time bounds, ignoring outlier stamps (e.g. 1970 or far future) when possible. */
  start?: Time;
  end?: Time;
  messages?: number;
  topics?: CatalogTopic[];
  /** Image URL (also `data:`) of a frame from the recording. */
  thumbnail?: string;
  /** Image topics with a cached preview clip, the first one being the thumbnail's. */
  previewTopics?: string[];
  /** One per GPS topic. */
  tracks?: CatalogTrack[];
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
  /** Where this recording's preview clips are cached locally. */
  previewKey?: string;
  size?: number;
  /** The machine a live recording came from ("robot.local:8765"). */
  machine?: string;
  dataset?: string;
  session?: string;
  episode?: string;
  /** Credits or a short description, e.g. a dataset's attribution and license. */
  description?: string;
  /** Layout to apply when the recording opens. */
  layoutUrl?: string;
  /** Preview clips listed by a catalog URL, per image topic (in `previewTopics` order). */
  previews?: Record<string, PreviewFrame[]>;
};

export type CatalogBackend = {
  /** Display name of the catalog, once available. */
  name?: string;
  /** The folder picked last time, which may need a click to grant access again. */
  lastFolder?: FileSystemDirectoryHandle;
  recordings: CatalogRecording[];
  progress?: { done: number; total: number };
  error?: string;
  /** Undefined for a catalog that is not a folder, e.g. one from a URL. */
  pickFolder?: () => Promise<void>;
  reopenLastFolder?: () => Promise<void>;
  /** Look for new files and retry failed ones; undefined while no folder is open. */
  rescan?: () => Promise<void>;
  open: (recording: CatalogRecording) => Promise<void>;
  /** Preview frames of one of a recording's image topics. */
  loadPreview: (recording: CatalogRecording, topic: string) => Promise<PreviewFrame[]>;
  /**
   * Open a folder dropped from the file manager. Returns whether the drop held one, synchronously,
   * so the caller can stop the drop from also opening its files.
   */
  dropFolder?: (dataTransfer: DataTransfer) => boolean;
  /** The browser refused to read the picked folder; `pickFolderWithInput` may still work. */
  accessDenied?: boolean;
  /**
   * The folder picker closed without a folder. Usually a cancel, but embedded browsers also abort
   * it themselves, even after a folder was picked, so the upload picker is offered too.
   */
  pickerClosed?: boolean;
  /** Pick a folder with the classic upload dialog, which works where folder handles don't. */
  pickFolderWithInput?: () => void;
  /** More buttons for a recording in its details, next to Open. */
  recordingActions?: (recording: CatalogRecording) => React.ReactNode;
};
