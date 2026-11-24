// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Feature, FeatureCollection } from "geojson";
import type { LayerSpecification, SourceSpecification } from "maplibre-gl";

import { MessageEvent } from "@lichtblick/suite";
import { turboColorString } from "@lichtblick/suite-base/util/colorUtils";
import { darkColor, lightColor } from "@lichtblick/suite-base/util/plotColors";
import { upperBound } from "@lichtblick/suite-base/util/sortedSearch";

import { normalize } from "./colorBy";
import { DEFAULT_POINT_SIZE, TopicStyle } from "./config";
import { bearingDegrees, ellipseRing, LngLat } from "./geo";
import { getAccuracy } from "./getAccuracy";
import { GeoJsonMessage, hasFix, parseGeoJSON } from "./support";
import { nearestFix, TrackStore } from "./track";
import { NavSatFixMsg } from "./types";

export type NavMessage = MessageEvent<NavSatFixMsg>;

/** Data sources owned by the panel, drawn above all map layers. */
export const OVERLAY = {
  track: "lb:track",
  trackLine: "lb:track-line",
  accuracy: "lb:accuracy",
  geojson: "lb:geojson",
  current: "lb:current",
  preview: "lb:preview",
  measure: "lb:measure",
} as const;
export type OverlaySource = (typeof OVERLAY)[keyof typeof OVERLAY];
export type OverlayData = Record<OverlaySource, FeatureCollection>;

export const ARROW_IMAGE = "lb:arrow";
export const MEASURE_COLOR = "#ff6d00";
/** Measurement handles, for hit testing: `kind` is "vertex" or "mid", `i` the segment start. */
export const MEASURE_HANDLE_LAYERS = ["lb:measure-point", "lb:measure-mid"];

/** Layers that report hovers/clicks, with feature property `i` indexing into their message list. */
export const INTERACTIVE_LAYERS = {
  track: "lb:track",
  current: ["lb:current", "lb:current-arrow"],
  geojson: ["lb:geojson-fill", "lb:geojson-line", "lb:geojson-point"],
} as const;

export function emptyOverlayData(): OverlayData {
  return Object.fromEntries(
    Object.values(OVERLAY).map((source): [OverlaySource, FeatureCollection] => [
      source,
      { type: "FeatureCollection", features: [] },
    ]),
  ) as OverlayData;
}

const get = (name: string): ["get", string] => ["get", name];
const geometryIn = (...types: string[]) =>
  ["in", ["geometry-type"], ["literal", types]] as unknown as ["==", string, string];

export function overlayStyle(data: OverlayData): {
  sources: Record<string, SourceSpecification>;
  layers: LayerSpecification[];
} {
  const sources: Record<string, SourceSpecification> = {};
  for (const [id, collection] of Object.entries(data)) {
    sources[id] = { type: "geojson", data: collection };
  }
  const layers: LayerSpecification[] = [
    {
      id: "lb:accuracy",
      type: "fill",
      source: OVERLAY.accuracy,
      paint: { "fill-color": get("c"), "fill-opacity": 0.2 },
    },
    {
      id: "lb:track-line",
      type: "line",
      source: OVERLAY.trackLine,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": get("c"),
        "line-width": get("w"),
        "line-opacity": 0.85,
      },
    },
    {
      id: "lb:track",
      type: "circle",
      source: OVERLAY.track,
      paint: {
        // Constant pixel size when tilted (the default scales with distance to the camera).
        "circle-pitch-scale": "viewport",
        "circle-radius": get("r"),
        "circle-color": get("c"),
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: "lb:geojson-fill",
      type: "fill",
      source: OVERLAY.geojson,
      filter: geometryIn("Polygon", "MultiPolygon"),
      paint: { "fill-color": get("fc"), "fill-opacity": get("fo") },
    },
    {
      id: "lb:geojson-line",
      type: "line",
      source: OVERLAY.geojson,
      filter: geometryIn("LineString", "MultiLineString", "Polygon", "MultiPolygon"),
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": get("c"),
        "line-width": get("w"),
        "line-opacity": get("o"),
      },
    },
    {
      id: "lb:geojson-point",
      type: "circle",
      source: OVERLAY.geojson,
      filter: geometryIn("Point", "MultiPoint"),
      paint: {
        "circle-pitch-scale": "viewport",
        "circle-radius": get("r"),
        "circle-color": get("fc"),
        "circle-opacity": get("o"),
        "circle-stroke-color": get("c"),
        "circle-stroke-width": 2,
      },
    },
    {
      id: "lb:current",
      type: "circle",
      source: OVERLAY.current,
      filter: ["<", get("h"), 0],
      paint: {
        "circle-pitch-scale": "viewport",
        "circle-radius": ["+", get("r"), 2],
        "circle-color": get("c"),
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: "lb:current-arrow",
      type: "symbol",
      source: OVERLAY.current,
      filter: [">=", get("h"), 0],
      layout: {
        "icon-image": ARROW_IMAGE,
        "icon-rotate": get("h"),
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        // ~30 px at the default point size: it must stand out on a track of the same color.
        "icon-size": ["/", ["+", get("r"), 2], 4],
      },
      paint: {
        "icon-color": get("c"),
        "icon-halo-color": "#ffffff",
        "icon-halo-width": 2,
      },
    },
    {
      id: "lb:preview",
      type: "circle",
      source: OVERLAY.preview,
      paint: {
        "circle-pitch-scale": "viewport",
        "circle-radius": ["+", get("r"), 3],
        "circle-color": get("c"),
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    },
    {
      id: "lb:measure-fill",
      type: "fill",
      source: OVERLAY.measure,
      filter: geometryIn("Polygon"),
      paint: { "fill-color": MEASURE_COLOR, "fill-opacity": 0.15 },
    },
    {
      // Dark casing keeps the line readable on imagery and snow.
      id: "lb:measure-casing",
      type: "line",
      source: OVERLAY.measure,
      filter: geometryIn("LineString", "Polygon"),
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#000000", "line-opacity": 0.35, "line-width": 5 },
    },
    {
      // Solid: dashes scale up badly where lines are draped over 3D terrain near the camera.
      id: "lb:measure-line",
      type: "line",
      source: OVERLAY.measure,
      filter: ["all", geometryIn("LineString", "Polygon"), ["!", ["boolean", get("live"), false]]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": MEASURE_COLOR, "line-width": 2.5 },
    },
    {
      id: "lb:measure-live",
      type: "line",
      source: OVERLAY.measure,
      filter: ["boolean", get("live"), false],
      layout: { "line-cap": "round" },
      paint: { "line-color": MEASURE_COLOR, "line-width": 2, "line-dasharray": [2, 2] },
    },
    {
      id: "lb:measure-mid",
      type: "circle",
      source: OVERLAY.measure,
      filter: ["==", get("kind"), "mid"],
      paint: {
        "circle-pitch-scale": "viewport",
        "circle-radius": 3.5,
        "circle-color": "#ffffff",
        "circle-opacity": 0.75,
        "circle-stroke-color": MEASURE_COLOR,
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: "lb:measure-point",
      type: "circle",
      source: OVERLAY.measure,
      filter: ["==", get("kind"), "vertex"],
      paint: {
        "circle-pitch-scale": "viewport",
        "circle-radius": 5,
        "circle-color": "#ffffff",
        "circle-stroke-color": MEASURE_COLOR,
        "circle-stroke-width": 2.5,
      },
    },
  ];
  return { sources, layers };
}

/** An arrow pointing up, used as an SDF icon so it can take any color. */
export function createArrowImage(size = 48): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.moveTo(size / 2, size * 0.08);
  ctx.lineTo(size * 0.85, size * 0.9);
  ctx.lineTo(size / 2, size * 0.7);
  ctx.lineTo(size * 0.15, size * 0.9);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

/** Where fixes come from: a recording's range, or live data as it arrives. */
export type DataSource = "recorded" | "live";

/**
 * How long to batch track updates. Each flush thins and recolors the whole track, so wait longer
 * as it grows: total work while loading stays proportional to the track length instead of
 * growing with its square.
 */
export function trackFlushDelayMs(trackLength: number, source: DataSource): number {
  // Live trails start slower: they are redrawn for as long as data arrives.
  return Math.max(source === "live" ? 500 : 50, trackLength / 2000);
}

export function lngLatOf(event: NavMessage): LngLat {
  return [event.message.longitude, event.message.latitude];
}

const collection = (features: Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

/** Colors of "color by" values, quantized so runs of similar values share one line feature. */
const VALUE_COLORS = Array.from({ length: 64 }, (_unused, i) => turboColorString(i / 63));

/** Values mapped onto the color scale between `range`, high to low when `reverse`. */
export type ColorScale = {
  values: Float64Array;
  range: [number, number];
  reverse: boolean;
  /** Appended to values in labels, e.g. " km/h". */
  unit: string;
};

/** A topic's track as drawn: the fixes to draw (see `thinTrack`) and how. */
export type DrawnTrack = {
  store: TrackStore;
  indices: Uint32Array;
  runs: readonly number[];
  /** `store.version` when `indices` were chosen; they are stale once it changes. */
  version: number;
  /** `store.length` and `store.tailReplacements` then: rows past or replaced since aren't drawn. */
  length: number;
  tailReplacements: number;
  color: string;
  style: TopicStyle;
  /** Per-fix values (NaN where unknown) and their color scale, when colored by a value. */
  colorScale?: ColorScale;
};

/**
 * Point property `k` indexes into `tracks`, `i` into that track's store, and `g` is the
 * `generation` of `tracks`, so hovers resolve against the tracks the map actually shows.
 */
export function trackFeatures(
  tracks: readonly DrawnTrack[],
  generation = 0,
): {
  points: FeatureCollection;
  lines: FeatureCollection;
} {
  const points: Feature[] = [];
  const lines: Feature[] = [];
  tracks.forEach(({ store, version, indices, runs, color, style, colorScale }, k) => {
    // Rows moved (cleared or thinned) since `indices` were chosen: skip it until the next redraw,
    // which the change schedules, rather than draw the wrong fixes.
    if (store.version !== version) {
      return;
    }
    const history = style.history ?? "points";
    const base = lightColor(color);
    const colorAt = (i: number) => {
      const value = colorScale?.values[i] ?? NaN;
      // Infinite readings aren't on the scale: draw them like unknown ones.
      if (!colorScale || !isFinite(value)) {
        return base;
      }
      const t = normalize(value, colorScale.range);
      return VALUE_COLORS[Math.round((colorScale.reverse ? 1 - t : t) * 63)]!;
    };
    const r = style.pointSize ?? DEFAULT_POINT_SIZE;
    if (history === "points" || history === "both") {
      for (const i of indices) {
        points.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: store.lngLat(i) },
          properties: { g: generation, k, i, c: colorAt(i), r },
        });
      }
    }
    if (history === "line" || history === "both") {
      const w = Math.max(1.5, r * 0.8);
      const line = (coordinates: LngLat[], c: string) => {
        if (coordinates.length > 1) {
          lines.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates },
            properties: { c, w },
          });
        }
      };
      runs.forEach((start, run) => {
        const end = runs[run + 1] ?? indices.length;
        if (!colorScale) {
          const coordinates: LngLat[] = [];
          for (let j = start; j < end; j++) {
            coordinates.push(store.lngLat(indices[j]!));
          }
          line(coordinates, base);
          return;
        }
        // Colored by value: each segment takes the color of its end; equal colors share a line.
        let coordinates = [store.lngLat(indices[start]!)];
        let c = "";
        for (let j = start + 1; j < end; j++) {
          const i = indices[j]!;
          const next = colorAt(i);
          if (next !== c && coordinates.length > 1) {
            line(coordinates, c);
            coordinates = [coordinates[coordinates.length - 1]!];
          }
          c = next;
          coordinates.push(store.lngLat(i));
        }
        line(coordinates, c);
      });
    }
  });
  return { points: collection(points), lines: collection(lines) };
}

/**
 * Markers for the latest fixes. Property `i` indexes into `messages`; `h` is the heading in
 * degrees or -1 when unknown.
 */
export function currentFeatures(
  messages: readonly NavMessage[],
  colors: ReadonlyMap<string, string>,
  styles: Readonly<Record<string, TopicStyle>>,
  headings: ReadonlyMap<string, number>,
): { markers: FeatureCollection; accuracy: FeatureCollection } {
  const markers: Feature[] = [];
  const accuracy: Feature[] = [];
  messages.forEach((event, i) => {
    const base = colors.get(event.topic);
    if (base == undefined) {
      return;
    }
    const style = styles[event.topic] ?? {};
    const fix = hasFix(event);
    const color = fix ? base : darkColor(base);
    markers.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: lngLatOf(event) },
      properties: {
        i,
        c: color,
        r: style.pointSize ?? DEFAULT_POINT_SIZE,
        h: headings.get(event.topic) ?? -1,
      },
    });
    if (style.accuracy !== false) {
      const ellipse = getAccuracy(event.message);
      if (ellipse) {
        accuracy.push({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [ellipseRing(lngLatOf(event), ellipse.radii, ellipse.tilt)],
          },
          properties: { c: color },
        });
      }
    }
  });
  return { markers: collection(markers), accuracy: collection(accuracy) };
}

function numberOr(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return typeof n === "number" && isFinite(n) ? n : fallback;
}

/**
 * Features of GeoJSON messages, with Leaflet-style `properties.style` resolved into flat paint
 * properties. Property `i` indexes into `messages`.
 */
export function geoJsonFeatures(
  messages: readonly GeoJsonMessage[],
  colors: ReadonlyMap<string, string>,
): FeatureCollection {
  const features: Feature[] = [];
  messages.forEach((event, i) => {
    // The topic color is the default; per-feature styles win.
    const topicColor = colors.get(event.topic) ?? "#3388ff";
    for (const { feature, style } of parseGeoJSON(event.message.geojson)) {
      // Null geometries are valid GeoJSON, though the types disallow them.
      if ((feature.geometry as Feature["geometry"] | null) == undefined) {
        continue;
      }
      const color = style.color ?? topicColor;
      features.push({
        ...feature,
        properties: {
          ...feature.properties,
          i,
          c: color,
          w: numberOr(style.weight, 3),
          o: numberOr(style.opacity, 1),
          fc: style.fillColor ?? color,
          fo: numberOr(style.fillOpacity, 0.2),
          r: numberOr(style.radius, 6),
        },
      });
    }
  });
  return collection(features);
}

/** Metres per degree of latitude */
const METERS_PER_DEGREE = 111_195;

/** Direction of travel to `to` from the latest fix before `end` at least 1 m back. */
export function headingFromTrack(track: TrackStore, end: number, to: LngLat): number | undefined {
  // Scans back to wherever the receiver last moved, however long it stood still, so the distance
  // is a flat-earth one on the columns (exact enough at 1 m, no trig or allocation per fix).
  // Below 1 m GNSS jitter dominates, so a stationary receiver keeps its last heading.
  const { lon, lat } = track.columns;
  const lonScale = Math.cos((to[1] * Math.PI) / 180);
  for (let i = end - 1; i >= 0; i--) {
    const dx = (lon[i]! - to[0]) * lonScale;
    const dy = lat[i]! - to[1];
    if ((dx * dx + dy * dy) * METERS_PER_DEGREE * METERS_PER_DEGREE >= 1) {
      return bearingDegrees(track.lngLat(i), to);
    }
  }
  return undefined;
}

/**
 * The fix under the cursor for a track point feature (`k`, `i` from `trackFeatures`) drawn from
 * `tracks`: the full-resolution fix nearest `at` among those the point stands for. Undefined when
 * the feature doesn't belong to `tracks` or the track changed since (cleared or thinned).
 */
export function resolveTrackFix(
  tracks: readonly DrawnTrack[] | undefined,
  k: unknown,
  i: unknown,
  at: LngLat,
): { track: DrawnTrack; fix: number } | undefined {
  const track = typeof k === "number" ? tracks?.[k] : undefined;
  if (
    !track ||
    typeof i !== "number" ||
    track.store.version !== track.version ||
    i >= track.length
  ) {
    return undefined;
  }
  // The newest drawn row may have been replaced in place by a later fix since.
  const usable =
    track.store.tailReplacements === track.tailReplacements ? track.length : track.length - 1;
  const position = upperBound(track.indices, 0, track.indices.length, i) - 1;
  if (track.indices[position] !== i) {
    return undefined;
  }
  const fix = nearestFix(track.store, track.indices, position, at, usable);
  return fix < usable ? { track, fix } : undefined;
}

/**
 * Identity of a track fix for hover state. An index alone can stand for another fix after the
 * store is thinned (`version`) or the newest row is replaced in place (`tailReplacements`, which
 * also tells apart a replacement with the same receive time).
 */
export function trackFixKey(store: TrackStore, fix: number): string {
  const replacement = fix === store.length - 1 ? store.tailReplacements : -1;
  return `${store.topic}\0${store.version}\0${fix}\0${replacement}`;
}
