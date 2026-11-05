// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// AV1 header parsing, ported from lichtblick-suite/lichtblick#1314. Section numbers refer to the
// AV1 bitstream specification. Only what keyframe detection and the WebCodecs codec string
// (`av01.P.LLT.DD`) need is decoded.

import { BitReader } from "./BitReader";

const OBU_SEQUENCE_HEADER = 1;
const OBU_FRAME_HEADER = 3;
const OBU_FRAME = 6;
const KEY_FRAME = 0;
const PROFILE_PROFESSIONAL = 2;

/** Yields `[obu_type, payload]` for each OBU of a temporal unit (section 5.3). */
function* parseObus(data: Uint8Array): Generator<[number, Uint8Array]> {
  let offset = 0;
  while (offset < data.byteLength) {
    const header = data[offset++]!;
    if ((header & 0x81) !== 0) {
      throw new Error("Invalid AV1 OBU header"); // forbidden or reserved bit set
    }
    const type = (header >> 3) & 0x0f;
    if ((header & 0x04) !== 0) {
      offset++; // obu_extension_header
    }
    let size = data.byteLength - offset;
    const hasSize = (header & 0x02) !== 0;
    if (hasSize) {
      // leb128 (section 4.10.5)
      size = 0;
      for (let i = 0; ; i++) {
        const byte = data[offset++];
        if (byte == undefined || i === 8) {
          throw new Error("Invalid AV1 OBU size");
        }
        size += (byte & 0x7f) * 2 ** (i * 7);
        if ((byte & 0x80) === 0) {
          break;
        }
      }
    }
    if (offset + size > data.byteLength) {
      throw new Error("Truncated AV1 OBU");
    }
    yield [type, data.subarray(offset, offset + size)];
    offset += size;
    if (!hasSize) {
      return; // an OBU without a size field runs to the end of the temporal unit
    }
  }
}

/**
 * A temporal unit is a random-access point when it carries a Sequence Header OBU (needed to
 * configure the decoder) and a coded KEY_FRAME, i.e. `show_existing_frame == 0` and
 * `frame_type == KEY_FRAME` (section 5.9.2). A repeated sequence header alone is not enough: it may
 * precede inter frames. Every frame header is checked because hidden frames can come first.
 */
export function isAV1Keyframe(data: Uint8Array): boolean {
  try {
    let reducedStillPictureHeader: boolean | undefined;
    for (const [type, payload] of parseObus(data)) {
      if (type === OBU_SEQUENCE_HEADER) {
        const bits = new BitReader(payload);
        bits.read(4); // seq_profile, still_picture
        reducedStillPictureHeader = bits.flag();
      } else if (
        (type === OBU_FRAME_HEADER || type === OBU_FRAME) &&
        reducedStillPictureHeader != undefined
      ) {
        if (reducedStillPictureHeader) {
          return true; // implies a single shown key frame
        }
        const bits = new BitReader(payload);
        if (!bits.flag() && bits.read(2) === KEY_FRAME) {
          return true;
        }
      }
    }
  } catch {
    // malformed: not a usable start point
  }
  return false;
}

/** Builds a decoder config from the first Sequence Header OBU (section 5.5), if any. */
export function parseAV1DecoderConfig(data: Uint8Array): VideoDecoderConfig | undefined {
  try {
    for (const [type, payload] of parseObus(data)) {
      if (type === OBU_SEQUENCE_HEADER) {
        return parseSequenceHeader(payload);
      }
    }
  } catch {
    // malformed
  }
  return undefined;
}

function parseSequenceHeader(data: Uint8Array): VideoDecoderConfig | undefined {
  const bits = new BitReader(data);
  const profile = bits.read(3);
  bits.read(1); // still_picture
  const reduced = bits.flag();
  let level: number;
  let tier = 0;
  if (reduced) {
    level = bits.read(5);
  } else {
    let decoderModelInfoPresent = false;
    let bufferDelayLength = 0;
    if (bits.flag()) {
      // timing_info()
      bits.read(32); // num_units_in_display_tick
      bits.read(32); // time_scale
      if (bits.flag()) {
        // equal_picture_interval: num_ticks_per_picture_minus_1 is uvlc()
        let leadingZeros = 0;
        while (!bits.flag()) {
          leadingZeros++;
        }
        if (leadingZeros < 32) {
          bits.read(leadingZeros);
        }
      }
      decoderModelInfoPresent = bits.flag();
      if (decoderModelInfoPresent) {
        bufferDelayLength = bits.read(5) + 1;
        bits.read(32); // num_units_in_decoding_tick
        bits.read(10); // buffer_removal_time_length_minus_1, frame_presentation_time_length_minus_1
      }
    }
    const initialDisplayDelayPresent = bits.flag();
    const operatingPoints = bits.read(5) + 1;
    level = 0;
    for (let i = 0; i < operatingPoints; i++) {
      bits.read(12); // operating_point_idc
      const opLevel = bits.read(5);
      const opTier = opLevel > 7 ? bits.read(1) : 0;
      if (i === 0) {
        level = opLevel;
        tier = opTier;
      }
      if (decoderModelInfoPresent && bits.flag()) {
        bits.read(bufferDelayLength); // decoder_buffer_delay
        bits.read(bufferDelayLength); // encoder_buffer_delay
        bits.read(1); // low_delay_mode_flag
      }
      if (initialDisplayDelayPresent && bits.flag()) {
        bits.read(4); // initial_display_delay_minus_1
      }
    }
  }

  const widthBits = bits.read(4) + 1;
  const heightBits = bits.read(4) + 1;
  const codedWidth = bits.read(widthBits) + 1;
  const codedHeight = bits.read(heightBits) + 1;
  if (!reduced && bits.flag()) {
    bits.read(7); // delta_frame_id_length_minus_2, additional_frame_id_length_minus_1
  }
  bits.read(3); // use_128x128_superblock, enable_filter_intra, enable_intra_edge_filter
  if (!reduced) {
    bits.read(4); // interintra, masked compound, warped motion, dual filter
    const enableOrderHint = bits.flag();
    if (enableOrderHint) {
      bits.read(2); // enable_jnt_comp, enable_ref_frame_mvs
    }
    // seq_choose_screen_content_tools ? SELECT : seq_force_screen_content_tools
    if (bits.flag() || bits.flag()) {
      if (!bits.flag()) {
        bits.read(1); // seq_force_integer_mv
      }
    }
    if (enableOrderHint) {
      bits.read(3); // order_hint_bits_minus_1
    }
  }
  bits.read(3); // enable_superres, enable_cdef, enable_restoration
  // color_config() (section 5.5.2)
  let bitDepth = bits.flag() ? 10 : 8;
  if (profile === PROFILE_PROFESSIONAL && bitDepth === 10 && bits.flag()) {
    bitDepth = 12;
  }
  if (profile > PROFILE_PROFESSIONAL) {
    return undefined; // reserved profiles (section 6.4.1)
  }

  const pad = (n: number) => n.toString().padStart(2, "0");
  return {
    codec: `av01.${profile}.${pad(level)}${tier === 1 ? "H" : "M"}.${pad(bitDepth)}`,
    codedWidth,
    codedHeight,
  };
}
