// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@foxglove/comlink";
import type { RawImage } from "@foxglove/schemas";

import type { CompressedImageTypes } from "./ImageTypes";
import { decodeCompressedDepth } from "./decodeCompressedDepth";
import { decodeRawImage, RawImageOptions } from "./decodeImage";
import { DecodedDepth, DepthDecodeOptions } from "./imageRenderModeSettings";
import { colorizeDepth, decodeDepthImage, defaultDepthScale } from "./imageRenderModes";
import type { Image as RosImage } from "../../ros";

async function decode(
  input: RosImage | RawImage | CompressedImageTypes,
  options: Partial<RawImageOptions>,
): Promise<ImageData> {
  // Compressed images only reach the worker when they are compressedDepth images
  const image = "format" in input ? await decodeCompressedDepth(input) : input;
  const result = new ImageData(image.width, image.height);
  decodeRawImage(image, options, result.data);
  return Comlink.transfer(result, [result.data.buffer]);
}

async function decodeDepth(
  input: RosImage | RawImage | CompressedImageTypes,
  options: DepthDecodeOptions,
): Promise<DecodedDepth> {
  const image = "format" in input ? await decodeCompressedDepth(input) : input;
  const { width, height } = image;
  const depth = new Float32Array(width * height);
  decodeDepthImage(image, options.depthScale ?? defaultDepthScale(image.encoding), depth);
  let colors: Uint8Array | undefined;
  if (options.color) {
    colors = new Uint8Array(width * height * 4);
    colorizeDepth(depth, options.color, colors);
  }
  const transfers = colors ? [depth.buffer, colors.buffer] : [depth.buffer];
  return Comlink.transfer({ width, height, depth, colors }, transfers);
}

export const service = {
  decode,
  decodeDepth,
};
Comlink.expose(service);
