// SPDX-License-Identifier: MPL-2.0

import { VideoPlayer } from "@lichtblick/den/video";
import { Immutable, MessageEvent } from "@lichtblick/suite";
import type { PartialMessage } from "@lichtblick/suite-base/panels/ThreeDeeRender/SceneExtension";
import { WorkerImageDecoder } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/WorkerImageDecoder";
import { isCompressedDepthFormat } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/decodeCompressedDepth";
import {
  decodeCompressedImageToBitmap,
  prepareVideoFrame,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/decodeImage";
import {
  normalizeCompressedImage,
  normalizeCompressedVideo,
  normalizeRawImage,
  normalizeRosImage,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/imageNormalizers";

import {
  COMPRESSED_IMAGE_SCHEMAS,
  RAW_IMAGE_SCHEMAS,
  THUMBNAIL_WIDTH,
  VIDEO_SCHEMAS,
} from "./scrubPreview";
import * as foxglove from "../../panels/ThreeDeeRender/foxglove";

/**
 * Decode an image message into a thumbnail. Imported with import() by useScrubPreview: the 3D
 * image decoders pull in three (~270 KB), which must stay out of the startup bundle.
 */
export async function decodeThumbnail(
  { schemaName, message }: Immutable<MessageEvent>,
  workerRef: { current: WorkerImageDecoder | undefined },
): Promise<ImageBitmap | undefined> {
  const getWorker = () => (workerRef.current ??= new WorkerImageDecoder());
  const resizeWidth = Math.round(THUMBNAIL_WIDTH * window.devicePixelRatio);
  if (COMPRESSED_IMAGE_SCHEMAS.has(schemaName)) {
    const image = normalizeCompressedImage(
      message as PartialMessage<{ format: string; data: Uint8Array }>,
    );
    if (isCompressedDepthFormat(image.format)) {
      return await createImageBitmap(await getWorker().decode(image, {}), { resizeWidth });
    }
    return await decodeCompressedImageToBitmap(image, resizeWidth);
  }
  if (RAW_IMAGE_SCHEMAS.has(schemaName)) {
    const image = foxglove.RAW_IMAGE_DATATYPES.has(schemaName)
      ? normalizeRawImage(message as Parameters<typeof normalizeRawImage>[0])
      : normalizeRosImage(message as Parameters<typeof normalizeRosImage>[0]);
    const imageData = await getWorker().decode(image, {});
    return await createImageBitmap(imageData, { resizeWidth });
  }
  if (VIDEO_SCHEMAS.has(schemaName)) {
    return await decodeVideoKeyframe(message as PartialMessage<never>, resizeWidth);
  }
  return undefined;
}

/** Decodes a lone keyframe with a throwaway decoder; anything else yields no thumbnail. */
async function decodeVideoKeyframe(
  message: PartialMessage<never>,
  resizeWidth: number,
): Promise<ImageBitmap | undefined> {
  const prepared = prepareVideoFrame(normalizeCompressedVideo(message));
  if (prepared.type !== "key" || !prepared.decoderConfig || !VideoPlayer.IsSupported()) {
    return undefined;
  }
  const player = new VideoPlayer();
  try {
    await player.init(prepared.decoderConfig);
    if (!player.isInitialized()) {
      return undefined;
    }
    const frame = await player.decode(prepared.data, 0, "key");
    if (!frame) {
      return undefined;
    }
    try {
      return await createImageBitmap(frame, { resizeWidth });
    } finally {
      frame.close();
    }
  } finally {
    player.close();
  }
}
