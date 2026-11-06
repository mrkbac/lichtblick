// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type {
  AdjustStep,
  RotationConvention,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms/transformOffsets";
import { Quaternion, Vector3 } from "@lichtblick/suite-base/util/geometry";

/** One parent->child transform extracted from a TF message. */
export type TransformSample = {
  parent: string;
  child: string;
  translation: Vector3;
  rotation: Quaternion;
  /** Header stamp in seconds. */
  stamp: number;
};

/** Latest known state of one child frame. */
export type FrameEntry = TransformSample & {
  topic: string;
  /** Receive time of the latest sample, in seconds. */
  receiveTime: number;
  /** Earliest receive time seen for this frame, in seconds. */
  firstReceiveTime: number;
  /** Receive times of the most recent samples (oldest first), used for the rate. */
  recentReceiveTimes: number[];
  /** Every parent this child has been published with. More than one is a TF error. */
  parents: string[];
};

/** child frame id -> entry */
export type FrameEntries = ReadonlyMap<string, FrameEntry>;

export type FrameWarning = "multipleParents" | "stale" | "noData";

export type FrameRow = {
  frame: string;
  depth: number;
  hasChildren: boolean;
  /** True when the frame comes from a topic marked as static. */
  isStatic: boolean;
  /**
   * True when playback is before the frame's first sample, e.g. at the start of a recording
   * after looping. Expected while the tree builds up, so it is not a warning.
   */
  notYetPublished: boolean;
  /** Undefined for root frames, which are only ever referenced as a parent. */
  entry?: FrameEntry;
  /** Seconds since the last sample, undefined for root frames. */
  age?: number;
  /** Samples per second, undefined when not enough samples. */
  rate?: number;
  warnings: FrameWarning[];
};

export type TopicConfig = {
  visible?: boolean;
  /** Static transforms never go stale and are preloaded from the whole recording. */
  static?: boolean;
};

export type TransformTreeConfig = {
  collapsed?: string[];
  /** Step size of the offset editor's arrows and scrubbing */
  adjustStep?: AdjustStep;
  /** How roll/pitch/yaw are shown and typed in the table and editor */
  rotationConvention?: RotationConvention;
  /** Per-topic settings, keyed by topic name. Topics without an entry use the defaults. */
  topics?: Record<string, TopicConfig>;
};
