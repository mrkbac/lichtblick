// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { isAV1Keyframe, parseAV1DecoderConfig } from "./av1";
import { H264 as H264Parser } from "./h264";
import { H265 as H265Parser } from "./h265";
import { H265_TARGET_FRAME_WAIT_MS } from "./h265/constants";
import { isVP9Keyframe, parseVP9DecoderConfig } from "./vp9";

/**
 * Canonical codec identifier used internally so callers do not need to know that some recordings
 * tag H.265 streams as "hevc" while others tag them as "h265".
 */
export enum VideoCodec {
  H264 = "h264",
  H265 = "h265",
  VP9 = "vp9",
  AV1 = "av1",
}

/**
 * H.264 and VP9 decoders typically emit a decoded VideoFrame within a couple of milliseconds of
 * submitting a chunk, so a tight ceiling lets us return quickly when decoding is healthy. Frames
 * that arrive later are still shown (see `VideoPlayer`), one call late.
 */
export const DEFAULT_TARGET_FRAME_WAIT_MS = 10;

type VideoCodecSpec = {
  /** Whether a `CompressedVideo.format` string names this codec. */
  matchesFormat: (format: string) => boolean;
  /** Prefixes of the WebCodecs codec strings `decoderConfig` produces. */
  codecStringPrefixes: readonly string[];
  /** Whether decoding can start at this frame. */
  isKeyframe: (data: Uint8Array) => boolean;
  /** Decoder config parsed from a keyframe, or undefined if the frame carries none. */
  decoderConfig: (data: Uint8Array) => VideoDecoderConfig | undefined;
  /**
   * Whether non-keyframes can only be decoded by replaying the full GOP inside the renderable.
   * H.265 and AV1 decoders hold many submitted chunks in their pipeline before emitting the target
   * frame, so the renderable must drive submission in order. H.264 and VP9 emit promptly and can
   * decode in parallel; serializing them through the drain queue adds per-frame latency that
   * surfaces as jank. Use `needsSeekBackfill` (not this) to decide whether a seek target needs its
   * preceding GOP attached.
   */
  needsKeyframeReplay: boolean;
  /**
   * Whether a seek target may be a delta frame that cannot be decoded without first replaying the
   * preceding GOP (most recent keyframe → target). Every inter-coded codec needs this; without it
   * a forward seek produces garbled output and a backward seek waits for the next keyframe.
   */
  needsSeekBackfill: boolean;
  /** How long `VideoPlayer` waits for the target frame before returning. */
  targetFrameWaitMs: number;
};

/**
 * Every supported video codec. Adding a codec means adding one entry here; all call sites read
 * from this table.
 */
export const VIDEO_CODECS: Record<VideoCodec, VideoCodecSpec> = {
  [VideoCodec.H264]: {
    matchesFormat: (format) => format === "h264",
    codecStringPrefixes: ["avc1", "avc3"],
    isKeyframe: (data) => H264Parser.IsKeyframe(data),
    decoderConfig: (data) => H264Parser.ParseDecoderConfig(data),
    needsKeyframeReplay: false,
    needsSeekBackfill: true,
    targetFrameWaitMs: DEFAULT_TARGET_FRAME_WAIT_MS,
  },
  [VideoCodec.H265]: {
    matchesFormat: (format) =>
      ["h265", "hevc", "hvc1", "hev1"].some((prefix) => format.startsWith(prefix)),
    codecStringPrefixes: ["hvc1", "hev1"],
    isKeyframe: (data) => H265Parser.IsKeyframe(data),
    decoderConfig: (data) => H265Parser.ParseDecoderConfig(data),
    needsKeyframeReplay: true,
    needsSeekBackfill: true,
    targetFrameWaitMs: H265_TARGET_FRAME_WAIT_MS,
  },
  [VideoCodec.VP9]: {
    matchesFormat: (format) => format === "vp9",
    codecStringPrefixes: ["vp09"],
    isKeyframe: isVP9Keyframe,
    decoderConfig: parseVP9DecoderConfig,
    needsKeyframeReplay: false,
    needsSeekBackfill: true,
    targetFrameWaitMs: DEFAULT_TARGET_FRAME_WAIT_MS,
  },
  [VideoCodec.AV1]: {
    matchesFormat: (format) => format === "av1",
    codecStringPrefixes: ["av01"],
    isKeyframe: isAV1Keyframe,
    decoderConfig: parseAV1DecoderConfig,
    needsKeyframeReplay: true,
    needsSeekBackfill: true,
    targetFrameWaitMs: H265_TARGET_FRAME_WAIT_MS,
  },
};

const VIDEO_CODEC_ENTRIES = Object.entries(VIDEO_CODECS) as [VideoCodec, VideoCodecSpec][];

/**
 * Maps an external `CompressedVideo.format` string to the canonical {@link VideoCodec}, or returns
 * undefined if the format is not a recognized video codec.
 */
export function canonicalVideoCodec(format: string): VideoCodec | undefined {
  return VIDEO_CODEC_ENTRIES.find(([, spec]) => spec.matchesFormat(format))?.[0];
}

/** Maps a WebCodecs codec string (e.g. `avc1.42C01F`) to its {@link VideoCodec}. */
export function videoCodecFromCodecString(codecString: string): VideoCodec | undefined {
  return VIDEO_CODEC_ENTRIES.find(([, spec]) =>
    spec.codecStringPrefixes.some((prefix) => codecString.startsWith(prefix)),
  )?.[0];
}

/**
 * Returns whether the given frame is a keyframe, dispatching to the parser for its (normalized)
 * codec. Non-video formats always return false.
 */
export function isVideoKeyframe(
  format: string,
  data: Uint8Array,
  resolvedCodec?: VideoCodec,
): boolean {
  const codec = resolvedCodec ?? canonicalVideoCodec(format);
  return codec != undefined && VIDEO_CODECS[codec].isKeyframe(data);
}

/** See {@link VideoCodecSpec.needsKeyframeReplay}. */
export function videoCodecNeedsKeyframeReplay(codec: VideoCodec | undefined): boolean {
  return codec != undefined && VIDEO_CODECS[codec].needsKeyframeReplay;
}

/** See {@link VideoCodecSpec.needsSeekBackfill}. */
export function videoCodecNeedsSeekBackfill(codec: VideoCodec | undefined): boolean {
  return codec != undefined && VIDEO_CODECS[codec].needsSeekBackfill;
}
