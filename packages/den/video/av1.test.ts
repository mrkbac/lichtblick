// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { isAV1Keyframe, parseAV1DecoderConfig } from "./av1";

// Temporal units from a 64x48 SVT-AV1 encode. Tile data is cut to one byte: the parsers only read
// headers, but OBU sizes must still be consistent.
const TEMPORAL_DELIMITER = [0x12, 0x00];
const SEQUENCE_HEADER_8BIT = [
  0x0a, 0x0a, 0x00, 0x00, 0x00, 0x02, 0xaf, 0xf7, 0x8d, 0x5f, 0x20, 0x08,
];
const SEQUENCE_HEADER_10BIT = [
  0x0a, 0x0a, 0x00, 0x00, 0x00, 0x02, 0xaf, 0xf7, 0x8d, 0x5f, 0x28, 0x08,
];
const KEY_FRAME = [0x32, 0x01, 0x14]; // OBU_FRAME, show_existing_frame = 0, frame_type = KEY_FRAME
const INTER_FRAME = [0x32, 0x01, 0x30]; // OBU_FRAME, frame_type = INTER_FRAME
const SHOW_EXISTING_FRAME = [0x1a, 0x01, 0x80]; // OBU_FRAME_HEADER, show_existing_frame = 1

const tu = (...obus: number[][]) => new Uint8Array(obus.flat());

describe("isAV1Keyframe", () => {
  it("detects a key frame with a sequence header", () => {
    expect(isAV1Keyframe(tu(TEMPORAL_DELIMITER, SEQUENCE_HEADER_8BIT, KEY_FRAME))).toBe(true);
  });

  it("finds a key frame after a hidden inter frame in the same temporal unit", () => {
    expect(isAV1Keyframe(tu(SEQUENCE_HEADER_8BIT, INTER_FRAME, KEY_FRAME))).toBe(true);
  });

  it("rejects inter frames, even with a repeated sequence header", () => {
    expect(isAV1Keyframe(tu(TEMPORAL_DELIMITER, INTER_FRAME))).toBe(false);
    expect(isAV1Keyframe(tu(SEQUENCE_HEADER_8BIT, INTER_FRAME))).toBe(false);
  });

  it("rejects a key frame without a sequence header and show_existing_frame", () => {
    expect(isAV1Keyframe(tu(TEMPORAL_DELIMITER, KEY_FRAME))).toBe(false);
    expect(isAV1Keyframe(tu(SEQUENCE_HEADER_8BIT, SHOW_EXISTING_FRAME))).toBe(false);
  });

  it("rejects malformed data", () => {
    expect(isAV1Keyframe(new Uint8Array([0x0a, 0x7f, 0x00]))).toBe(false); // truncated OBU
    expect(isAV1Keyframe(new Uint8Array([0x80]))).toBe(false); // forbidden bit
    expect(isAV1Keyframe(new Uint8Array())).toBe(false);
  });
});

describe("parseAV1DecoderConfig", () => {
  it("builds the codec string and size from the sequence header", () => {
    expect(parseAV1DecoderConfig(tu(TEMPORAL_DELIMITER, SEQUENCE_HEADER_8BIT, KEY_FRAME))).toEqual({
      codec: "av01.0.00M.08",
      codedWidth: 64,
      codedHeight: 48,
    });
    expect(parseAV1DecoderConfig(tu(SEQUENCE_HEADER_10BIT, KEY_FRAME))?.codec).toBe(
      "av01.0.00M.10",
    );
  });

  it("returns undefined without a sequence header", () => {
    expect(parseAV1DecoderConfig(tu(TEMPORAL_DELIMITER, INTER_FRAME))).toBeUndefined();
  });
});
