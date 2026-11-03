// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { isGeoJSONSchema, isSupportedSchema } from "@lichtblick/suite-base/panels/Map/support";
import { NavSatFixMsg, NavSatFixStatus } from "@lichtblick/suite-base/panels/Map/types";

import { CatalogTrack } from "./types";

/** ~1 m; finer digits only make the cache bigger. */
const DECIMALS = 5;

export function isFixSchema(name: string): boolean {
  return isSupportedSchema(name) && !isGeoJSONSchema(name);
}

function round(value: number): number {
  return Number(value.toFixed(DECIMALS));
}

export function toPoint(fix: Partial<NavSatFixMsg>): [number, number] | undefined {
  const { latitude: lat, longitude: lon } = fix;
  if (
    lat == undefined ||
    lon == undefined ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180 ||
    (lat === 0 && lon === 0) ||
    fix.status?.status === NavSatFixStatus.STATUS_NO_FIX
  ) {
    return undefined;
  }
  return [round(lon), round(lat)];
}

export type Bounds = [west: number, south: number, east: number, north: number];

export function trackBounds(points: readonly [number, number][]): Bounds | undefined {
  if (points.length === 0) {
    return undefined;
  }
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** The track for `topic`, or the first track when no topic is chosen or the recording lacks it. */
export function pickTrack(
  tracks: readonly CatalogTrack[] | undefined,
  topic: string | undefined,
): CatalogTrack | undefined {
  return tracks?.find((t) => t.topic === topic) ?? tracks?.[0];
}
