// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { isVP9Keyframe, parseVP9DecoderConfig } from "./vp9";

// Leading bytes of 64x48 libvpx-vp9 frames; the parsers only read the uncompressed header.
const KEY_8BIT = new Uint8Array([0x82, 0x49, 0x83, 0x42, 0x00, 0x03, 0xf0, 0x02, 0xf6, 0x06]);
const KEY_10BIT = new Uint8Array([0x92, 0x49, 0x83, 0x42, 0x00, 0x01, 0xf8, 0x01, 0x7b, 0x04]);
const INTER_8BIT = new Uint8Array([0x86, 0x00, 0x40, 0x92, 0x9c, 0x0c, 0x50]);
const SHOW_EXISTING = new Uint8Array([0x88]); // frame_marker, profile 0, show_existing_frame = 1

describe("isVP9Keyframe", () => {
  it("detects key frames", () => {
    expect(isVP9Keyframe(KEY_8BIT)).toBe(true);
    expect(isVP9Keyframe(KEY_10BIT)).toBe(true);
  });

  it("rejects inter, show-existing and malformed frames", () => {
    expect(isVP9Keyframe(INTER_8BIT)).toBe(false);
    expect(isVP9Keyframe(SHOW_EXISTING)).toBe(false);
    expect(isVP9Keyframe(new Uint8Array([0x00]))).toBe(false); // bad frame_marker
    expect(isVP9Keyframe(new Uint8Array())).toBe(false);
  });
});

describe("parseVP9DecoderConfig", () => {
  it("builds the codec string and size from a key frame", () => {
    expect(parseVP9DecoderConfig(KEY_8BIT)).toEqual({
      codec: "vp09.00.10.08",
      codedWidth: 64,
      codedHeight: 48,
    });
    expect(parseVP9DecoderConfig(KEY_10BIT)?.codec).toBe("vp09.02.10.10");
  });

  it("returns undefined for inter frames and a bad sync code", () => {
    expect(parseVP9DecoderConfig(INTER_8BIT)).toBeUndefined();
    expect(parseVP9DecoderConfig(new Uint8Array([0x82, 0x00, 0x00, 0x00, 0x00]))).toBeUndefined();
  });
});
