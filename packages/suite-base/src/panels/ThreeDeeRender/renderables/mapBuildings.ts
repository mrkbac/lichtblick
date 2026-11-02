// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { LatLon, Mercator, metersPerMercator, toMercator } from "./mapGeo";

/** A rendered fill-extrusion feature; MapLibre evaluates the layer's paint for each feature. */
export type BuildingFeature = {
  geometry: GeoJSON.Geometry;
  layer: { paint?: unknown };
};

const DEFAULT_COLOR = "hsl(35,8%,85%)";

const meters = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

function paintColor(value: unknown): THREE.Color {
  if (typeof value === "string") {
    return new THREE.Color(value);
  }
  // MapLibre's evaluated colors are premultiplied sRGB.
  const { r, g, b, a } = (value ?? {}) as Partial<Record<"r" | "g" | "b" | "a", number>>;
  if (r == undefined || g == undefined || b == undefined || a == undefined || a === 0) {
    return new THREE.Color(DEFAULT_COLOR);
  }
  return new THREE.Color().setRGB(r / a, g / a, b / a, THREE.SRGBColorSpace);
}

/**
 * Extrude building footprints into one mesh in the plane's frame: x east and y north of
 * `center` in meters, z up from the ground that `groundAt` returns for a Mercator point.
 */
export function buildingsGeometry(
  features: readonly BuildingFeature[],
  center: LatLon,
  groundAt: (point: Mercator) => number,
): THREE.BufferGeometry | undefined {
  const origin = toMercator(center);
  const scale = metersPerMercator(center.lat);
  const parts: THREE.BufferGeometry[] = [];
  for (const { geometry, layer } of features) {
    const paint = (layer.paint ?? {}) as Record<string, unknown>;
    const base = meters(paint["fill-extrusion-base"]);
    const height = meters(paint["fill-extrusion-height"]);
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    if (height <= base || polygons.length === 0) {
      continue;
    }
    const color = paintColor(paint["fill-extrusion-color"]);
    for (const [outer, ...holes] of polygons) {
      if (!outer || outer.length < 4) {
        continue;
      }
      const mercator = (ring: GeoJSON.Position[]) =>
        ring.map(([lon, lat]) => toMercator({ lat: lat ?? 0, lon: lon ?? 0 }));
      const local = (ring: Mercator[]) =>
        ring.map((m) => new THREE.Vector2((m.x - origin.x) * scale, (origin.y - m.y) * scale));
      const footprint = mercator(outer);
      const shape = new THREE.Shape(local(footprint));
      shape.holes = holes.map((hole) => new THREE.Path(local(mercator(hole))));
      const part = new THREE.ExtrudeGeometry(shape, {
        depth: height - base,
        bevelEnabled: false,
      });
      // Sit on the lowest footprint corner so buildings on slopes don't float.
      part.translate(0, 0, Math.min(...footprint.map(groundAt)) + base);
      part.deleteAttribute("uv");
      const colors = new Float32Array(part.attributes.position!.count * 3);
      for (let i = 0; i < colors.length; i += 3) {
        color.toArray(colors, i);
      }
      part.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      parts.push(part);
    }
  }
  const merged = parts.length > 0 ? mergeGeometries(parts) : undefined;
  for (const part of parts) {
    part.dispose();
  }
  return merged;
}
