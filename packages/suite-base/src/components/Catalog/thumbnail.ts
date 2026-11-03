// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { COMPRESSED_IMAGE_DATATYPES as FOXGLOVE_COMPRESSED_IMAGE } from "@lichtblick/suite-base/panels/ThreeDeeRender/foxglove";
import { normalizeByteArray } from "@lichtblick/suite-base/panels/ThreeDeeRender/normalizeMessages";
import { COMPRESSED_IMAGE_DATATYPES as ROS_COMPRESSED_IMAGE } from "@lichtblick/suite-base/panels/ThreeDeeRender/ros";

const THUMBNAIL_WIDTH = 240;

export type CompressedFrame = { data: Uint8Array; format: string };

export function isCompressedImageSchema(name: string): boolean {
  return ROS_COMPRESSED_IMAGE.has(name) || FOXGLOVE_COMPRESSED_IMAGE.has(name);
}

/** The image in a deserialized CompressedImage message, if it has one. */
export function toFrame(message: unknown): CompressedFrame | undefined {
  const image = message as { data?: unknown; format?: string };
  const data = normalizeByteArray(image.data);
  return data.length > 0 ? { data, format: image.format ?? "" } : undefined;
}

/** Scale a compressed image down to a small JPEG data URL. */
export async function renderThumbnail(frame: CompressedFrame): Promise<string> {
  // The format string is not a reliable MIME type (e.g. "rgb8; jpeg compressed bgr8"); browsers
  // sniff the actual content.
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(frame.data)]), {
    resizeWidth: THUMBNAIL_WIDTH,
    resizeQuality: "medium",
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: 0.75,
  });
  return await new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.onload = () => {
      resolve(fileReader.result as string);
    };
    fileReader.onerror = () => {
      reject(fileReader.error ?? new Error("Failed to read thumbnail"));
    };
    fileReader.readAsDataURL(blob);
  });
}
