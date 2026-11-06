// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec } from "@foxglove/rostime";
import { RawImage } from "@foxglove/schemas";
import * as _ from "lodash-es";

import {
  decodeBGR8,
  decodeBGRA8,
  decodeBayerBGGR8,
  decodeBayerGBRG8,
  decodeBayerGRBG8,
  decodeBayerRGGB8,
  decodeFloat1c,
  decodeMono16,
  decodeMono8,
  decodeRGB8,
  decodeRGBA8,
  decodeUYVY,
  decodeYUV420,
  decodeYUYV,
} from "@lichtblick/den/image";
import {
  H265 as H265Parser,
  VIDEO_CODECS,
  VideoCodec,
  VideoPlayer,
  canonicalVideoCodec,
  isVideoKeyframe,
} from "@lichtblick/den/video";

import { CompressedImageTypes, CompressedVideo } from "./ImageTypes";
import { PreparedVideoFrame, PreparedVideoFrameStatus, PrepareVideoFrameContext } from "./types";
import { makeRgba, rgbaGradient, stringToRgba } from "../../color";
import { Image as RosImage } from "../../ros";
import { ColorModeSettings, getColorConverter } from "../colorMode";

// Codec normalization (`VideoCodec`, `canonicalVideoCodec`, `isVideoKeyframe`) lives in
// `@lichtblick/den/video` so both the renderer and the player-side seek backfill share a single
// source of truth.

export async function decodeCompressedImageToBitmap(
  image: CompressedImageTypes,
  resizeWidth?: number,
): Promise<ImageBitmap> {
  const bitmapData = new Blob([new Uint8Array(image.data)], { type: `image/${image.format}` });
  return await createImageBitmap(bitmapData, { resizeWidth });
}

export function isCompressedVideoKeyframe(
  frameMsg: CompressedVideo,
  resolvedCodec?: VideoCodec,
): boolean {
  return isVideoKeyframe(frameMsg.format, frameMsg.data, resolvedCodec);
}

export function getVideoDecoderConfig(frameMsg: CompressedVideo): VideoDecoderConfig | undefined {
  const codec = canonicalVideoCodec(frameMsg.format);
  return codec == undefined ? undefined : VIDEO_CODECS[codec].decoderConfig(frameMsg.data);
}

export function prepareVideoFrame(
  frameMsg: CompressedVideo,
  context?: PrepareVideoFrameContext,
  resolvedCodec?: VideoCodec,
): PreparedVideoFrame {
  const codec = resolvedCodec ?? canonicalVideoCodec(frameMsg.format) ?? VideoCodec.H264;
  switch (codec) {
    case VideoCodec.H265: {
      const frameInfo = H265Parser.InspectFrame(frameMsg.data, context?.h265);
      if (frameInfo.bitstreamFormat === "unknown" || frameInfo.normalizedData == undefined) {
        return {
          data: frameMsg.data,
          status: PreparedVideoFrameStatus.UnsupportedBitstream,
          diagnostics: "unsupported H.265 bitstream format",
          type: "delta",
        };
      }
      if (frameInfo.frameType === "B") {
        return {
          data: frameInfo.normalizedData,
          status: PreparedVideoFrameStatus.UnsupportedBFrame,
          diagnostics: "H.265 B frames are not supported",
          type: "delta",
        };
      }

      const type = frameInfo.isKeyframe ? "key" : "delta";
      return {
        data:
          type === "key"
            ? frameInfo.normalizedData
            : (frameInfo.strippedData ?? frameInfo.normalizedData),
        decoderConfig: H265Parser.ParseDecoderConfig(frameInfo.normalizedData),
        status: PreparedVideoFrameStatus.Ok,
        type,
      };
    }
    default: {
      const frameData = frameMsg.data;
      const spec = VIDEO_CODECS[codec];
      const type = spec.isKeyframe(frameData) ? "key" : "delta";
      return {
        data: frameData,
        // Only keyframes carry a decoder config; delta frames have nothing to parse.
        decoderConfig: type === "key" ? spec.decoderConfig(frameData) : undefined,
        status: PreparedVideoFrameStatus.Ok,
        type,
      };
    }
  }
}

export async function decodeCompressedVideoToBitmap(
  frameMsg: Pick<CompressedVideo, "timestamp">,
  preparedFrame: PreparedVideoFrame,
  videoPlayer: VideoPlayer,
  firstMessageTime: bigint,
  resizeWidth?: number,
): Promise<ImageBitmap> {
  if (!videoPlayer.isInitialized()) {
    return await emptyVideoFrame(videoPlayer, resizeWidth);
  }

  // Match Foxglove/WebCodecs behavior by using integer microseconds relative to the first frame.
  const timestampMicros = Number((toNanoSec(frameMsg.timestamp) - firstMessageTime) / 1000n);

  const videoFrame = await videoPlayer.decode(
    preparedFrame.data,
    timestampMicros,
    preparedFrame.type,
  );
  try {
    const frameToRender = videoFrame ?? videoPlayer.lastVideoFrame;
    if (!frameToRender) {
      return videoPlayer.lastImageBitmap ?? (await emptyVideoFrame(videoPlayer, resizeWidth));
    }
    // Skip re-encoding the same frame when the decoder produced nothing new.
    if (!videoFrame && videoPlayer.lastImageBitmap) {
      return videoPlayer.lastImageBitmap;
    }
    const imageBitmap = await globalThis.createImageBitmap(frameToRender, { resizeWidth });
    videoPlayer.lastImageBitmap?.close();
    videoPlayer.lastImageBitmap = imageBitmap;
    return imageBitmap;
  } finally {
    videoFrame?.close();
  }
}

export const IMAGE_DEFAULT_COLOR_MODE_SETTINGS: Required<
  Omit<ColorModeSettings, "colorField" | "minValue" | "maxValue">
> = {
  colorMode: "gradient",
  flatColor: "#ffffff",
  gradient: ["#000000", "#ffffff"],
  colorMap: "turbo",
  explicitAlpha: 0,
};
const MIN_MAX_8_BIT = { minValue: 0, maxValue: 255 };
const MIN_MAX_16_BIT = { minValue: 0, maxValue: 65535 };

export type RawImageOptions = ColorModeSettings;

// Linear -> sRGB transfer function, sampled; index with round(linear * (SIZE - 1))
const LINEAR_TO_SRGB_SIZE = 4096;
const LINEAR_TO_SRGB = Float32Array.from({ length: LINEAR_TO_SRGB_SIZE }, (_v, i) => {
  const c = i / (LINEAR_TO_SRGB_SIZE - 1);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
});
function linearToSrgb(c: number): number {
  return LINEAR_TO_SRGB[Math.round(Math.min(Math.max(c, 0), 1) * (LINEAR_TO_SRGB_SIZE - 1))]!;
}

/**
 * Maps a single-channel value to a color using the panel's gradient/colormap and value range.
 * Returns undefined for color modes that don't apply to single-channel images (flat, rgba-fields).
 *
 * The output is sRGB: image textures are uploaded as-is and the image shader does no color space
 * conversion (same as for compressed images), whereas `getColorConverter` produces linear colors
 * for the 3D scene. So gradients are interpolated between the sRGB colors the user picked (the
 * default black -> white gradient is plain grayscale) and colormap colors are converted back.
 */
function monoColorConverter(
  options: Partial<RawImageOptions>,
  defaultRange: { minValue: number; maxValue: number },
): ((value: number) => { r: number; g: number; b: number; a: number }) | undefined {
  // lodash merge replaces undefined values in options with defaults, whereas a spread would let
  // undefined overwrite them
  const settings = _.merge({}, IMAGE_DEFAULT_COLOR_MODE_SETTINGS, defaultRange, options);
  const { minValue, maxValue } = settings;
  const tempColor = { r: 0, g: 0, b: 0, a: 0 };
  switch (settings.colorMode) {
    case "gradient": {
      const minColor = stringToRgba(makeRgba(), settings.gradient[0]);
      const maxColor = stringToRgba(makeRgba(), settings.gradient[1]);
      const valueDelta = Math.max(maxValue - minValue, Number.EPSILON);
      return (value: number) => {
        const frac = Math.max(0, Math.min((value - minValue) / valueDelta, 1));
        return rgbaGradient(tempColor, minColor, maxColor, frac);
      };
    }
    case "colormap": {
      const converter = getColorConverter(
        { ...settings, colorMode: "colormap" },
        minValue,
        maxValue,
      );
      return (value: number) => {
        converter(tempColor, value);
        tempColor.r = linearToSrgb(tempColor.r);
        tempColor.g = linearToSrgb(tempColor.g);
        tempColor.b = linearToSrgb(tempColor.b);
        return tempColor;
      };
    }
    default:
      return undefined;
  }
}

/**
 * See also:
 * https://github.com/ros2/common_interfaces/blob/366eea24ffce6c87f8860cbcd27f4863f46ad822/sensor_msgs/include/sensor_msgs/image_encodings.hpp
 */
export function decodeRawImage(
  image: RosImage | RawImage,
  options: Partial<RawImageOptions>,
  output: Uint8ClampedArray,
): void {
  const { encoding, width, height, step } = image;
  const is_bigendian = "is_bigendian" in image ? image.is_bigendian : false;
  const rawData = image.data as Uint8Array;
  switch (encoding) {
    case "yuv422":
    case "uyvy":
      decodeUYVY(rawData, width, height, step, output);
      break;
    case "yuv422_yuy2":
    case "yuyv":
      decodeYUYV(rawData, width, height, step, output);
      break;
    case "yuv420":
    case "i420":
      decodeYUV420(rawData, width, height, step, "i420", output);
      break;
    case "nv12":
      decodeYUV420(rawData, width, height, step, "nv12", output);
      break;
    case "nv21":
      decodeYUV420(rawData, width, height, step, "nv21", output);
      break;
    case "rgb8":
      decodeRGB8(rawData, width, height, step, output);
      break;
    case "rgba8":
      decodeRGBA8(rawData, width, height, step, output);
      break;
    case "bgra8":
      decodeBGRA8(rawData, width, height, step, output);
      break;
    case "bgr8":
    case "8UC3":
      decodeBGR8(rawData, width, height, step, output);
      break;
    case "32FC1":
      decodeFloat1c(rawData, width, height, step, is_bigendian, output);
      break;
    case "bayer_rggb8":
      decodeBayerRGGB8(rawData, width, height, step, output);
      break;
    case "bayer_bggr8":
      decodeBayerBGGR8(rawData, width, height, step, output);
      break;
    case "bayer_gbrg8":
      decodeBayerGBRG8(rawData, width, height, step, output);
      break;
    case "bayer_grbg8":
      decodeBayerGRBG8(rawData, width, height, step, output);
      break;
    case "mono8":
    case "8UC1":
      decodeMono8(rawData, width, height, step, output, {
        // Unsupported color modes fall back to plain grayscale
        colorConverter: monoColorConverter(options, MIN_MAX_8_BIT),
      });
      break;
    case "mono16":
    case "16UC1": {
      const colorConverter = monoColorConverter(options, MIN_MAX_16_BIT);
      if (!colorConverter) {
        throw Error(`${options.colorMode} color mode is not supported for mono16 images`);
      }
      decodeMono16(rawData, width, height, step, is_bigendian, output, { colorConverter });
      break;
    }
    default:
      throw new Error(`Unsupported encoding ${encoding}`);
  }
}

// Performance sensitive, skip the extra await when returning a blank image
// eslint-disable-next-line @typescript-eslint/promise-function-async
export function emptyVideoFrame(
  videoPlayer?: VideoPlayer,
  resizeWidth?: number,
): Promise<ImageBitmap> {
  const width = resizeWidth ?? 32;
  const size = videoPlayer?.codedSize() ?? { width, height: width };
  const data = new ImageData(size.width, size.height);
  return createImageBitmap(data, { resizeWidth });
}
