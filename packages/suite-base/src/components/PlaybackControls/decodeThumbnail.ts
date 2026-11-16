// SPDX-License-Identifier: MPL-2.0

import { Immutable, MessageEvent } from "@lichtblick/suite";
import type { PartialMessage } from "@lichtblick/suite-base/panels/ThreeDeeRender/SceneExtension";
import { WorkerImageDecoder } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/WorkerImageDecoder";
import { isCompressedDepthFormat } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/decodeCompressedDepth";
import { decodeCompressedImageToBitmap } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/decodeImage";
import {
  normalizeCompressedImage,
  normalizeRawImage,
  normalizeRosImage,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/imageNormalizers";

import { COMPRESSED_IMAGE_SCHEMAS, RAW_IMAGE_SCHEMAS, THUMBNAIL_WIDTH } from "./scrubPreview";
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
  return undefined;
}
