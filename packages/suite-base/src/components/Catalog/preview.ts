// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapIndexedReader } from "@mcap/core";

import { loadDecompressHandlers } from "@lichtblick/mcap-support";
import { BlobReadable } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/BlobReadable";

import { SampledFrame, sampleRecording } from "./sampleRecording";
import { renderThumbnail } from "./thumbnail";

/** Slow enough to follow, fast enough to see motion: 48 frames loop in 8 s. */
export const PREVIEW_FPS = 6;

export type PreviewFrame = {
  /** Seconds since the start of the recording. */
  offsetSec: number;
  /** Image URL (also `data:`). */
  url: string;
};

/** Preview frames per image topic. */
export type Previews = Record<string, PreviewFrame[]>;

/** Scale sampled frames down to small JPEGs. Frames that fail to decode are left out. */
export async function renderPreviews(
  frames: ReadonlyMap<string, readonly SampledFrame[]>,
  originNs: bigint | undefined,
): Promise<Previews> {
  const previews: Previews = {};
  for (const [topic, sampled] of frames) {
    const origin = originNs ?? sampled[0]?.logTime ?? 0n;
    const rendered: PreviewFrame[] = [];
    for (const { logTime, frame } of sampled) {
      try {
        rendered.push({
          offsetSec: Number(logTime - origin) / 1e9,
          url: await renderThumbnail(frame),
        });
      } catch (err: unknown) {
        console.warn(`Catalog preview frame on ${topic} failed`, err);
      }
    }
    if (rendered.length > 0) {
      previews[topic] = rendered;
    }
  }
  return previews;
}

/** Preview of one image topic, for topics the index skipped. */
export async function previewMcap(file: Blob, topic: string): Promise<PreviewFrame[]> {
  const reader = await McapIndexedReader.Initialize({
    readable: new BlobReadable(file),
    decompressHandlers: await loadDecompressHandlers(),
  });
  const { frames } = await sampleRecording(reader, { imageTopics: [topic] });
  const origin = reader.statistics?.messageStartTime;
  return (await renderPreviews(frames, origin))[topic] ?? [];
}
