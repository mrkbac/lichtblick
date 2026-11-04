// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { annexBBoxSize, findNextStartCode, findNextStartCodeEnd } from "../utils";
import { SPS as SPSNALU } from "./SPS";

export enum H264NaluType {
  NDR = 1,
  IDR = 5,
  SEI = 6,
  SPS = 7,
  PPS = 8,
  AUD = 9,
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class H264 {
  public static IsAnnexB(data: Uint8Array): boolean {
    return annexBBoxSize(data) != undefined;
  }

  public static IsKeyframe(data: Uint8Array): boolean {
    return H264.GetFirstNALUOfType(data, H264NaluType.IDR) != undefined;
  }

  public static GetFirstNALUOfType(
    data: Uint8Array,
    naluType: H264NaluType,
  ): Uint8Array | undefined {
    // Determine what type of encoding is used
    const boxSize = annexBBoxSize(data);
    if (boxSize == undefined) {
      return undefined;
    }

    // Iterate over the NAL units in the H264 Annex B frame, looking for the requested naluType
    let i = boxSize;
    while (i < data.length) {
      // Annex B NALU type is the 5 least significant bits of the first byte following the start
      // code
      const byte = data[i];
      if (byte == undefined) {
        break;
      }
      const curNaluType = byte & 0x1f;
      if (curNaluType === naluType) {
        // Find the end of this NALU
        const end = findNextStartCode(data, i + 1);

        // Return the NALU
        return data.subarray(i, end);
      }

      // Scan for another start code, signifying the beginning of the next NAL unit
      i = findNextStartCodeEnd(data, i + 1);
    }

    return undefined;
  }

  public static ParseDecoderConfig(data: Uint8Array): VideoDecoderConfig | undefined {
    // Find the first SPS NALU and extrat MIME, picHeight, and picWidth fields
    const spsData = H264.GetFirstNALUOfType(data, H264NaluType.SPS);
    if (spsData == undefined) {
      return undefined;
    }

    // Extract the SPS fields
    const sps = new SPSNALU(spsData);
    if (sps.nal_unit_type !== H264NaluType.SPS) {
      return undefined;
    }

    const config: VideoDecoderConfig = {
      codec: sps.MIME(),
      codedWidth: sps.picWidth,
      codedHeight: sps.picHeight,
    };

    // If the aspect ratio is specified, use it to calculate the display aspect ratio
    const aspectWidth = sps.sar_width ?? 0;
    const aspectHeight = sps.sar_height ?? 0;
    if (aspectWidth > 1 || aspectHeight > 1) {
      // The Sample Aspect Ratio (SAR) is the ratio of the width to the height of an individual
      // pixel. Display Aspect Ratio (DAR) is the ratio of the width to the height of the video as
      // it should be displayed
      config.displayAspectWidth = Math.round(sps.picWidth * (aspectWidth / aspectHeight));
      config.displayAspectHeight = sps.picHeight;
    }

    return config;
  }
}
