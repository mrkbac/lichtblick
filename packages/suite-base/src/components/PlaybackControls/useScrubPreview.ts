// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useMemo, useRef, useState } from "react";

import { Time } from "@lichtblick/rostime";
import { Immutable, MessageEvent } from "@lichtblick/suite";
import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { useAppConfigurationValue } from "@lichtblick/suite-base/hooks";
import { PartialMessage } from "@lichtblick/suite-base/panels/ThreeDeeRender/SceneExtension";
import { WorkerImageDecoder } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/WorkerImageDecoder";
import { decodeCompressedImageToBitmap } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/decodeImage";
import {
  normalizeCompressedImage,
  normalizeRawImage,
  normalizeRosImage,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/imageNormalizers";

import {
  COMPRESSED_IMAGE_SCHEMAS,
  RAW_IMAGE_SCHEMAS,
  THUMBNAIL_WIDTH,
  ThumbnailCache,
  findCachedMessage,
  previewableTopics,
  requestThumbnail,
  resolvePreviewTopic,
  timeBucket,
} from "./scrubPreview";
import * as foxglove from "../../panels/ThreeDeeRender/foxglove";

const DEBOUNCE_MS = 40;

const selectTopics = (ctx: MessagePipelineContext) => ctx.sortedTopics;
const selectPlayerId = (ctx: MessagePipelineContext) => ctx.playerState.playerId;

/** Image topics available for the scrub preview, and the one currently selected (if any). */
export function usePreviewTopic(): {
  imageTopics: string[];
  topic: string | undefined;
  setting: string | undefined;
  setSetting: (value?: string) => Promise<void>;
} {
  const [setting, setSetting] = useAppConfigurationValue<string>(AppSetting.PLAYBACK_PREVIEW_TOPIC);
  const topics = useMessagePipeline(selectTopics);
  const imageTopics = useMemo(() => previewableTopics(topics), [topics]);
  return { imageTopics, topic: resolvePreviewTopic(setting, imageTopics), setting, setSetting };
}

async function decodeThumbnail(
  { schemaName, message }: Immutable<MessageEvent>,
  getWorker: () => WorkerImageDecoder,
): Promise<ImageBitmap | undefined> {
  const resizeWidth = Math.round(THUMBNAIL_WIDTH * window.devicePixelRatio);
  if (COMPRESSED_IMAGE_SCHEMAS.has(schemaName)) {
    const image = normalizeCompressedImage(
      message as PartialMessage<{ format: string; data: Uint8Array }>,
    );
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

/**
 * Thumbnail of the preview topic at the hovered playback time. Reads the preloaded block cache
 * when it covers the topic, otherwise does an indexed backfill read. Debounced, cancels stale
 * reads, and caches decoded thumbnails per time bucket.
 */
export function useScrubPreview(stamp: Time | undefined): ImageBitmap | undefined {
  const { topic } = usePreviewTopic();
  const playerId = useMessagePipeline(selectPlayerId);
  const getPipeline = useMessagePipelineGetter();

  const [cache] = useState(() => new ThumbnailCache());
  const workerRef = useRef<WorkerImageDecoder | undefined>(undefined);
  const [bitmap, setBitmap] = useState<ImageBitmap | undefined>();

  useEffect(
    () => () => {
      cache.clear();
      workerRef.current?.terminate();
      workerRef.current = undefined;
    },
    [cache],
  );

  // Thumbnails belong to one topic of one recording.
  useEffect(() => {
    cache.clear();
    setBitmap(undefined);
  }, [cache, topic, playerId]);

  useEffect(() => {
    // Read times via the getter: activeData changes every tick during playback, and re-running
    // this effect would cancel the in-flight read.
    const { startTime, endTime } = getPipeline().playerState.activeData ?? {};
    if (!stamp || !topic || !startTime || !endTime) {
      setBitmap(undefined);
      return;
    }
    // Keep showing the previous thumbnail until the new one is ready (like video players) to
    // avoid flicker while scrubbing.
    return requestThumbnail({
      key: timeBucket(stamp, startTime, endTime),
      cache,
      delayMs: DEBOUNCE_MS,
      onResult: setBitmap,
      load: async (signal) => {
        const pipeline = getPipeline();
        const msg =
          findCachedMessage(pipeline.playerState.progress.messageCache, endTime, topic, stamp) ??
          (await pipeline.getMessageAtTime(topic, stamp, signal));
        if (!msg || signal.aborted) {
          return undefined;
        }
        return await decodeThumbnail(msg, () => (workerRef.current ??= new WorkerImageDecoder()));
      },
    });
  }, [cache, getPipeline, playerId, stamp, topic]);

  return bitmap;
}
