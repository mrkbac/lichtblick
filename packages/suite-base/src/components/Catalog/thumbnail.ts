// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapIndexedReader } from "@mcap/core";

import { parseChannel } from "@lichtblick/mcap-support";
import { COMPRESSED_IMAGE_DATATYPES as FOXGLOVE_COMPRESSED_IMAGE } from "@lichtblick/suite-base/panels/ThreeDeeRender/foxglove";
import { normalizeByteArray } from "@lichtblick/suite-base/panels/ThreeDeeRender/normalizeMessages";
import { COMPRESSED_IMAGE_DATATYPES as ROS_COMPRESSED_IMAGE } from "@lichtblick/suite-base/panels/ThreeDeeRender/ros";

const THUMBNAIL_WIDTH = 240;

export type CompressedFrame = { data: Uint8Array; format: string };

/**
 * The frame at the middle of the first compressed image topic (by name), which tends to show more
 * than the first frame of a recording.
 */
export async function readMiddleFrame(
  reader: McapIndexedReader,
  middleNs: bigint | undefined,
): Promise<CompressedFrame | undefined> {
  const channel = [...reader.channelsById.values()]
    .filter((c) => {
      const name = reader.schemasById.get(c.schemaId)?.name ?? "";
      return ROS_COMPRESSED_IMAGE.has(name) || FOXGLOVE_COMPRESSED_IMAGE.has(name);
    })
    .sort((a, b) => a.topic.localeCompare(b.topic))[0];
  if (!channel) {
    return undefined;
  }
  const schema = reader.schemasById.get(channel.schemaId)!;
  const { deserialize } = parseChannel({
    messageEncoding: channel.messageEncoding,
    schema,
  });
  for await (const message of reader.readMessages({
    topics: [channel.topic],
    startTime: middleNs,
  })) {
    const image = deserialize(message.data) as {
      data?: unknown;
      format?: string;
    };
    const data = normalizeByteArray(image.data);
    return data.length > 0 ? { data, format: image.format ?? "" } : undefined;
  }
  return undefined;
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
