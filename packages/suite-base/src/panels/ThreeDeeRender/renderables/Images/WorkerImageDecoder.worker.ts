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

export const service = {
  decode,
};
Comlink.expose(service);
