// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Feature, FeatureCollection } from "geojson";
import type { LayerSpecification, SourceSpecification } from "maplibre-gl";

import { MessageEvent } from "@lichtblick/suite";
import { darkColor, lightColor } from "@lichtblick/suite-base/util/plotColors";

import { DEFAULT_POINT_SIZE, TopicStyle } from "./config";
import { bearingDegrees, distanceMeters, ellipseRing, LngLat } from "./geo";
import { getAccuracy } from "./getAccuracy";
import { GeoJsonMessage, hasFix, parseGeoJSON } from "./support";
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
  const empty = (): FeatureCollection => ({
    type: "FeatureCollection",
    features: [],
  });
  return {
    [OVERLAY.track]: empty(),
    [OVERLAY.trackLine]: empty(),
    [OVERLAY.accuracy]: empty(),
    [OVERLAY.geojson]: empty(),
    [OVERLAY.current]: empty(),
    [OVERLAY.preview]: empty(),
    [OVERLAY.measure]: empty(),
  };
}

const get = (name: string) => ["get", name] as ["get", string];
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

export function lngLatOf(event: NavMessage): LngLat {
  return [event.message.longitude, event.message.latitude];
}

const collection = (features: Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

/** Full recorded track. Point property `i` indexes into `messages`. */
/** Per-message color and label when a track is colored by a value (speed, message path). */
export type ValueStyle = { color: string; label: string };

export function trackFeatures(
  messages: readonly NavMessage[],
  colors: ReadonlyMap<string, string>,
  styles: Readonly<Record<string, TopicStyle>>,
  valueStyleAt?: (index: number) => ValueStyle | undefined,
): { points: FeatureCollection; lines: FeatureCollection } {
  const points: Feature[] = [];
  const lines: Feature[] = [];
  const lineCoords = new Map<string, LngLat[]>();
  const previous = new Map<string, LngLat>();
  messages.forEach((event, i) => {
    const style = styles[event.topic] ?? {};
    const history = style.history ?? "points";
    const base = colors.get(event.topic);
    if (history === "none" || base == undefined) {
      return;
    }
    const valueStyle = valueStyleAt?.(i);
    const position = lngLatOf(event);
    if (history === "points" || history === "both") {
      points.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: position },
        properties: {
          i,
          c: valueStyle?.color ?? lightColor(base),
          r: style.pointSize ?? DEFAULT_POINT_SIZE,
          ...(valueStyle ? { v: valueStyle.label } : {}),
        },
      });
    }
    if (history === "line" || history === "both") {
      const width = Math.max(1.5, (style.pointSize ?? DEFAULT_POINT_SIZE) * 0.8);
      const from = previous.get(event.topic);
      previous.set(event.topic, position);
      if ((style.colorBy ?? "topic") !== "topic") {
        // Colored by value: one segment per fix pair, in the color of its end point.
        if (from) {
          lines.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: [from, position] },
            properties: { c: valueStyle?.color ?? lightColor(base), w: width },
          });
        }
        return;
      }
      let coords = lineCoords.get(event.topic);
      if (!coords) {
        coords = [];
        lineCoords.set(event.topic, coords);
      }
      coords.push(position);
    }
  });
  for (const [topic, coordinates] of lineCoords) {
    lines.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: {
        c: lightColor(colors.get(topic)!),
        w: Math.max(1.5, (styles[topic]?.pointSize ?? DEFAULT_POINT_SIZE) * 0.8),
      },
    });
  }
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

/** Direction of travel from the most recent fix at least `minDistance` meters back. */
export function headingFromTrack(
  track: readonly NavMessage[],
  minDistance = 1,
): number | undefined {
  const last = track[track.length - 1];
  if (!last) {
    return undefined;
  }
  const to = lngLatOf(last);
  for (let i = track.length - 2; i >= 0; i--) {
    const from = lngLatOf(track[i]!);
    // ponytail: below 1 m GNSS jitter dominates, so a stationary receiver keeps its last heading.
    if (distanceMeters(from, to) >= minDistance) {
      return bearingDegrees(from, to);
    }
  }
  return undefined;
}
