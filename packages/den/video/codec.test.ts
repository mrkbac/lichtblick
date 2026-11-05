// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  VideoCodec,
  canonicalVideoCodec,
  isVideoKeyframe,
  videoCodecFromCodecString,
  videoCodecNeedsKeyframeReplay,
  videoCodecNeedsSeekBackfill,
} from "./codec";
import { H264 } from "./h264";
import { H265 } from "./h265";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("canonicalVideoCodec", () => {
  it("maps H.265 codec-string prefixes to H265", () => {
    // GIVEN codec strings that start with known H.265 identifiers
    // WHEN canonicalVideoCodec normalizes them
    // THEN each one maps to the H265 canonical codec
    expect(canonicalVideoCodec("hvc1.1.6.L93.B0")).toBe(VideoCodec.H265);
    expect(canonicalVideoCodec("hev1.2.4.L120.B0")).toBe(VideoCodec.H265);
    expect(canonicalVideoCodec("hevc-main10")).toBe(VideoCodec.H265);
  });

  it("normalizes both 'h265' and the 'hevc' alias to H265", () => {
    // GIVEN direct H.265 format aliases
    // WHEN canonicalVideoCodec normalizes them
    // THEN both aliases map to the H265 canonical codec
    expect(canonicalVideoCodec("h265")).toBe(VideoCodec.H265);
    expect(canonicalVideoCodec("hevc")).toBe(VideoCodec.H265);
  });

  it("maps 'vp9' and 'av1' to their codecs", () => {
    expect(canonicalVideoCodec("vp9")).toBe(VideoCodec.VP9);
    expect(canonicalVideoCodec("av1")).toBe(VideoCodec.AV1);
  });

  it("maps 'h264' to H264", () => {
    // GIVEN the H.264 format string
    // WHEN canonicalVideoCodec normalizes it
    // THEN it maps to the H264 canonical codec
    expect(canonicalVideoCodec("h264")).toBe(VideoCodec.H264);
  });

  it("does not classify non-video strings as H265", () => {
    // GIVEN strings that contain H.265 tokens but do not start with a valid video prefix
    // WHEN canonicalVideoCodec normalizes them
    // THEN none of them are classified as H.265
    expect(canonicalVideoCodec("video/hevc")).toBeUndefined();
    expect(canonicalVideoCodec("codec=hvc1.1.6.L93.B0")).toBeUndefined();
    expect(canonicalVideoCodec("x-hev1-profile")).toBeUndefined();
  });

  it("returns undefined for unrecognized formats", () => {
    // GIVEN formats that are not recognized video codecs
    // WHEN canonicalVideoCodec normalizes them
    // THEN no canonical codec is returned
    expect(canonicalVideoCodec("mjpeg")).toBeUndefined();
    expect(canonicalVideoCodec("")).toBeUndefined();
  });
});

describe("isVideoKeyframe", () => {
  it("dispatches to the H264 parser for h264", () => {
    const spy = vi.spyOn(H264, "IsKeyframe").mockReturnValue(true);
    const data = new Uint8Array([0x65]);
    expect(isVideoKeyframe("h264", data)).toBe(true);
    expect(spy).toHaveBeenCalledWith(data);
  });

  it("dispatches to the H265 parser for the 'hevc' alias", () => {
    const spy = vi.spyOn(H265, "IsKeyframe").mockReturnValue(true);
    const data = new Uint8Array([0x26]);
    expect(isVideoKeyframe("hevc", data)).toBe(true);
    expect(spy).toHaveBeenCalledWith(data);
  });

  it("returns false for unrecognized formats without consulting any parser", () => {
    const h264Spy = vi.spyOn(H264, "IsKeyframe");
    const h265Spy = vi.spyOn(H265, "IsKeyframe");
    expect(isVideoKeyframe("mjpeg", new Uint8Array([0x01]))).toBe(false);
    expect(h264Spy).not.toHaveBeenCalled();
    expect(h265Spy).not.toHaveBeenCalled();
  });
});

describe("videoCodecNeedsKeyframeReplay", () => {
  it("is true only for codecs that cannot decode a delta frame in isolation", () => {
    expect(videoCodecNeedsKeyframeReplay(VideoCodec.H265)).toBe(true);
    expect(videoCodecNeedsKeyframeReplay(VideoCodec.AV1)).toBe(true);
    expect(videoCodecNeedsKeyframeReplay(VideoCodec.H264)).toBe(false);
    expect(videoCodecNeedsKeyframeReplay(VideoCodec.VP9)).toBe(false);
    expect(videoCodecNeedsKeyframeReplay(undefined)).toBe(false);
  });
});

describe("videoCodecNeedsSeekBackfill", () => {
  it("is true for every inter-frame-dependent codec", () => {
    // H.264 belongs here too even though it does not need the renderable's queue at playback time:
    // a seek that lands on a P-frame still needs the preceding GOP for the decoder to produce a
    // picture, so backfill is required at the player/source boundary.
    expect(videoCodecNeedsSeekBackfill(VideoCodec.H264)).toBe(true);
    expect(videoCodecNeedsSeekBackfill(VideoCodec.H265)).toBe(true);
    expect(videoCodecNeedsSeekBackfill(VideoCodec.VP9)).toBe(true);
    expect(videoCodecNeedsSeekBackfill(VideoCodec.AV1)).toBe(true);
    expect(videoCodecNeedsSeekBackfill(undefined)).toBe(false);
  });
});

describe("videoCodecFromCodecString", () => {
  it("maps WebCodecs codec strings to their codec", () => {
    expect(videoCodecFromCodecString("avc1.42C01F")).toBe(VideoCodec.H264);
    expect(videoCodecFromCodecString("hvc1.1.6.L93.B0")).toBe(VideoCodec.H265);
    expect(videoCodecFromCodecString("vp09.00.10.08")).toBe(VideoCodec.VP9);
    expect(videoCodecFromCodecString("av01.0.00M.08")).toBe(VideoCodec.AV1);
    expect(videoCodecFromCodecString("")).toBeUndefined();
  });
});
