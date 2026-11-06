// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { toNanoSec } from "@foxglove/rostime";

import { Immutable, Topic } from "@lichtblick/suite";
import { ALL_SUPPORTED_ANNOTATION_SCHEMAS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/ImageMode/annotations/normalizeAnnotations";
import { Annotation } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/ImageMode/annotations/types";
import { getTopicMatchPrefix } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/topicPrefixMatching";
import { Color, Point2D } from "@lichtblick/suite-base/types/Messages";

import { Matrix } from "./view";

/** One received annotation message, normalized. */
export type AnnotationEntry = {
  /** Stamp of the first annotation; matched against the image stamp when syncing. */
  stampNs?: bigint;
  annotations: Annotation[];
};

/** How many messages per annotation topic are kept to find one matching a late image. */
export const ANNOTATION_HISTORY = 20;

export function annotationTopicNames(topics: Immutable<Topic[]> | undefined): string[] {
  return (topics ?? [])
    .filter((topic) => ALL_SUPPORTED_ANNOTATION_SCHEMAS.has(topic.schemaName))
    .map((topic) => topic.name)
    .sort();
}

/**
 * Annotation topics that belong to `imageTopic`, using the Image panel's rule: they share the image
 * topic's namespace (everything up to its last `/`).
 */
export function matchAnnotationTopics(imageTopic: string, annotationTopics: string[]): string[] {
  const prefix = getTopicMatchPrefix(imageTopic);
  return prefix == undefined ? [] : annotationTopics.filter((topic) => topic.startsWith(prefix));
}

/** The tile's own pick, or the automatic match while the user hasn't picked any. */
export function tileAnnotationTopics(
  tile: { topic: string; annotationTopics?: string[] },
  annotationTopics: string[],
): string[] {
  return tile.annotationTopics ?? matchAnnotationTopics(tile.topic, annotationTopics);
}

export function makeAnnotationEntry(annotations: Annotation[]): AnnotationEntry {
  const first = annotations[0];
  return { stampNs: first ? toNanoSec(first.stamp) : undefined, annotations };
}

/**
 * The entry to draw over an image stamped `imageStampNs`: the newest one, or with `sync` the one
 * stamped like the image (none if it hasn't arrived), like the Image panel's "Sync annotations".
 */
export function pickAnnotations(
  history: readonly AnnotationEntry[] | undefined,
  imageStampNs: bigint | undefined,
  { sync }: { sync: boolean },
): AnnotationEntry | undefined {
  if (!history) {
    return undefined;
  }
  if (!sync) {
    return history[history.length - 1];
  }
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.stampNs === imageStampNs) {
      return history[i];
    }
  }
  return undefined;
}

const cssCache = new WeakMap<Immutable<Color>, string>();

function css(color: Immutable<Color> | undefined): string | undefined {
  if (!color || color.a <= 0) {
    return undefined;
  }
  let value = cssCache.get(color);
  if (value == undefined) {
    const channel = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255);
    value = `rgba(${channel(color.r)},${channel(color.g)},${channel(color.b)},${color.a})`;
    cssCache.set(color, value);
  }
  return value;
}

const WHITE = "rgba(255,255,255,1)";

/**
 * Draws annotations given in image pixels. `m` maps image to canvas pixels and `scale` is canvas
 * pixels per image pixel, so shapes and text grow with the image like in the Image panel; text
 * stays upright.
 */
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: readonly Annotation[],
  m: Readonly<Matrix>,
  scale: number,
): void {
  for (const annotation of annotations) {
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    switch (annotation.type) {
      case "circle": {
        const { position, radius, thickness } = annotation;
        ctx.beginPath();
        ctx.arc(position.x, position.y, radius, 0, 2 * Math.PI);
        const fill = css(annotation.fillColor);
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill();
        }
        const stroke = css(annotation.outlineColor);
        if (stroke && thickness > 0) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = thickness;
          ctx.stroke();
        }
        break;
      }
      case "points":
        drawPoints(ctx, annotation);
        break;
      case "text": {
        const { position, text, fontSize, padding } = annotation;
        // Upright text at the transformed anchor, whatever the tile's rotation or flip.
        const x = m.a * position.x + m.c * position.y + m.e;
        const y = m.b * position.x + m.d * position.y + m.f;
        const size = fontSize * scale;
        const pad = padding * scale;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.font = `${size}px sans-serif`;
        ctx.textBaseline = "top";
        const background = css(annotation.backgroundColor);
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(x, y, ctx.measureText(text).width + 2 * pad, size + 2 * pad);
        }
        ctx.fillStyle = css(annotation.textColor) ?? WHITE;
        ctx.fillText(text, x + pad, y + pad);
        break;
      }
    }
  }
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  annotation: Extract<Annotation, { type: "points" }>,
): void {
  const { style, points, outlineColors, thickness } = annotation;
  const outline = css(annotation.outlineColor);
  const fill = css(annotation.fillColor);
  if (style === "points") {
    // `thickness` is the point radius (as in the Image panel).
    const fallback = outline ?? fill ?? WHITE;
    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      ctx.fillStyle = css(outlineColors[i]) ?? fallback;
      ctx.beginPath();
      ctx.arc(point.x, point.y, thickness, 0, 2 * Math.PI);
      ctx.fill();
    }
    return;
  }

  const closed = style === "polygon";
  ctx.lineWidth = thickness;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (closed && fill && points.length > 2) {
    tracePath(ctx, points);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (outlineColors.length === 0) {
    ctx.strokeStyle = outline ?? WHITE;
    if (style === "line_list") {
      ctx.beginPath();
      for (let i = 0; i + 1 < points.length; i += 2) {
        ctx.moveTo(points[i]!.x, points[i]!.y);
        ctx.lineTo(points[i + 1]!.x, points[i + 1]!.y);
      }
    } else {
      tracePath(ctx, points);
      if (closed) {
        ctx.closePath();
      }
    }
    ctx.stroke();
    return;
  }
  // Per-vertex colors: each segment takes the color of its first point.
  const step = style === "line_list" ? 2 : 1;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += step) {
    const from = points[i]!;
    const to = points[(i + 1) % points.length]!;
    ctx.strokeStyle = css(outlineColors[i]) ?? outline ?? WHITE;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}

function tracePath(ctx: CanvasRenderingContext2D, points: readonly Point2D[]): void {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    if (i === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
}
