// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import {
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectPlayerId,
  selectSortedTopics,
} from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { useAppConfigurationValue } from "@lichtblick/suite-base/hooks";
import type { WorkerImageDecoder } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/WorkerImageDecoder";
import { readVideoGopForSeekTarget } from "@lichtblick/suite-base/players/IterablePlayer/videoSeekBackfill";

import {
  ThumbnailCache,
  findCachedMessage,
  isPreviewFrame,
  previewableTopics,
  requestThumbnail,
  resolvePreviewTopic,
  timeBucket,
} from "./scrubPreview";

const DEBOUNCE_MS = 40;

async function* emptyIterator(): AsyncIterableIterator<never> {}

/** Image topics available for the scrub preview, and the one currently selected (if any). */
export function usePreviewTopic(): {
  imageTopics: string[];
  topic: string | undefined;
  setting: string | undefined;
  setSetting: (value?: string) => Promise<void>;
} {
  const [setting, setSetting] = useAppConfigurationValue<string>(AppSetting.PLAYBACK_PREVIEW_TOPIC);
  const topics = useMessagePipeline(selectSortedTopics);
  const imageTopics = useMemo(() => previewableTopics(topics), [topics]);
  return { imageTopics, topic: resolvePreviewTopic(setting, imageTopics), setting, setSetting };
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
        let msg =
          findCachedMessage(
            pipeline.playerState.progress.messageCache,
            endTime,
            topic,
            stamp,
            isPreviewFrame,
          ) ?? (await pipeline.getMessageAtTime(topic, stamp, signal));
        if (msg && !isPreviewFrame(msg)) {
          // A video delta frame: read back to its GOP's keyframe.
          const gop = await readVideoGopForSeekTarget(
            msg,
            {
              messageIterator: ({ start, end }) =>
                pipeline.getBatchIterator(topic, { start, end }) ?? emptyIterator(),
            },
            () => signal,
          );
          msg = gop[0];
        }
        if (!msg || signal.aborted) {
          return undefined;
        }
        const { decodeThumbnail } = await import("./decodeThumbnail");
        return await decodeThumbnail(msg, workerRef);
      },
    });
  }, [cache, getPipeline, playerId, stamp, topic]);

  return bitmap;
}
