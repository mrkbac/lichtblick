// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// VP9 uncompressed header parsing (VP9 bitstream specification section 6.2). Only what keyframe
// detection and the WebCodecs codec string (`vp09.PP.LL.DD`) need is decoded. A superframe packs
// several frames into one message; its first frame decides, since a key frame always comes first.

import { BitReader } from "./BitReader";

const FRAME_MARKER = 2;
const KEY_FRAME = 0;
const SYNC_CODE = 0x498342;
const CS_RGB = 7;

/**
 * Smallest VP9 level whose max luma picture size fits the frame (Annex A). The level is not coded
 * in the bitstream, but the WebCodecs codec string requires one.
 */
const LEVELS: [maxLumaPictureSize: number, level: string][] = [
  [36864, "10"],
  [73728, "11"],
  [122880, "20"],
  [245760, "21"],
  [552960, "30"],
  [983040, "31"],
  [2228224, "40"],
  [8912896, "50"],
  [35651584, "60"],
];

type VP9FrameHeader = { profile: number; keyframe: boolean; bits: BitReader };

function parseFrameHeader(data: Uint8Array): VP9FrameHeader | undefined {
  const bits = new BitReader(data);
  if (bits.read(2) !== FRAME_MARKER) {
    return undefined;
  }
  const profileLow = bits.read(1);
  const profile = (bits.read(1) << 1) | profileLow;
  if (profile === 3) {
    bits.read(1); // reserved_zero
  }
  if (bits.flag()) {
    return { profile, keyframe: false, bits }; // show_existing_frame
  }
  const keyframe = bits.read(1) === KEY_FRAME;
  bits.read(2); // show_frame, error_resilient_mode
  return { profile, keyframe, bits };
}

export function isVP9Keyframe(data: Uint8Array): boolean {
  try {
    return parseFrameHeader(data)?.keyframe === true;
  } catch {
    return false;
  }
}

/** Builds a decoder config from a key frame's header; undefined for any other frame. */
export function parseVP9DecoderConfig(data: Uint8Array): VideoDecoderConfig | undefined {
  try {
    const header = parseFrameHeader(data);
    if (header?.keyframe !== true) {
      return undefined;
    }
    const { profile, bits } = header;
    if (bits.read(24) !== SYNC_CODE) {
      return undefined;
    }
    // color_config()
    const bitDepth = profile >= 2 ? (bits.flag() ? 12 : 10) : 8;
    if (bits.read(3) !== CS_RGB) {
      bits.read(1); // color_range
      if (profile === 1 || profile === 3) {
        bits.read(3); // subsampling_x, subsampling_y, reserved_zero
      }
    } else if (profile === 1 || profile === 3) {
      bits.read(1); // reserved_zero
    }
    // frame_size()
    const codedWidth = bits.read(16) + 1;
    const codedHeight = bits.read(16) + 1;

    const level = LEVELS.find(([max]) => codedWidth * codedHeight <= max)?.[1] ?? "62";
    const pad = (n: number) => n.toString().padStart(2, "0");
    return { codec: `vp09.${pad(profile)}.${level}.${pad(bitDepth)}`, codedWidth, codedHeight };
  } catch {
    return undefined;
  }
}
