// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** [longitude, latitude] in degrees, GeoJSON order. */
export type LngLat = [number, number];

export type Units = "metric" | "imperial" | "nautical";

const EARTH_RADIUS = 6371008.8;
const DEG = Math.PI / 180;

export function distanceMeters(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north in [0, 360). */
export function bearingDegrees(a: LngLat, b: LngLat): number {
  const lat1 = a[1] * DEG;
  const lat2 = b[1] * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

export function pathLengthMeters(points: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distanceMeters(points[i - 1]!, points[i]!);
  }
  return total;
}

/** Area of a simple polygon on the sphere in m². The ring may be open or closed. */
export function polygonAreaSquareMeters(ring: readonly LngLat[]): number {
  if (ring.length < 3) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i]!;
    const p2 = ring[(i + 1) % ring.length]!;
    sum += (p2[0] - p1[0]) * DEG * (2 + Math.sin(p1[1] * DEG) + Math.sin(p2[1] * DEG));
  }
  return Math.abs((sum * EARTH_RADIUS * EARTH_RADIUS) / 2);
}

/** Move `east`/`north` meters from origin (local flat-earth approximation, fine below ~10 km). */
export function offsetMeters(origin: LngLat, east: number, north: number): LngLat {
  const lat = origin[1] + north / EARTH_RADIUS / DEG;
  const lon = origin[0] + east / (EARTH_RADIUS * Math.cos(origin[1] * DEG)) / DEG;
  return [lon, lat];
}

/**
 * Closed polygon ring of an ellipse. `tilt` follows getAccuracy(): degrees clockwise from east,
 * radii[0] along the tilted axis.
 */
export function ellipseRing(
  center: LngLat,
  radii: readonly [number, number],
  tilt: number,
  steps = 32,
): LngLat[] {
  const theta = -tilt * DEG;
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const x = radii[0] * Math.cos(t);
    const y = radii[1] * Math.sin(t);
    const east = x * Math.cos(theta) - y * Math.sin(theta);
    const north = x * Math.sin(theta) + y * Math.cos(theta);
    ring.push(offsetMeters(center, east, north));
  }
  return ring;
}

export function formatDistance(meters: number, units: Units): string {
  switch (units) {
    case "imperial": {
      const feet = meters / 0.3048;
      return feet < 5280
        ? `${feet.toFixed(feet < 100 ? 1 : 0)} ft`
        : `${(feet / 5280).toFixed(2)} mi`;
    }
    case "nautical":
      return `${(meters / 1852).toFixed(meters < 1852 ? 3 : 2)} nmi`;
    case "metric":
      return meters < 1000
        ? `${meters.toFixed(meters < 100 ? 2 : 1)} m`
        : `${(meters / 1000).toFixed(3)} km`;
  }
}

export function formatArea(squareMeters: number, units: Units): string {
  switch (units) {
    case "imperial": {
      const acres = squareMeters / 4046.8564224;
      return acres < 640 ? `${acres.toFixed(3)} ac` : `${(acres / 640).toFixed(3)} mi²`;
    }
    case "nautical":
      return `${(squareMeters / 1852 ** 2).toFixed(4)} nmi²`;
    case "metric":
      if (squareMeters < 10_000) {
        return `${squareMeters.toFixed(1)} m²`;
      }
      return squareMeters < 1e6
        ? `${(squareMeters / 10_000).toFixed(3)} ha`
        : `${(squareMeters / 1e6).toFixed(3)} km²`;
  }
}

export function webMercatorToLngLat(x: number, y: number): LngLat {
  const R = 6378137;
  return [x / R / DEG, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / DEG];
}

/** Inverse UTM on WGS84 (Krüger series, sub-millimetre inside a zone). */
export function utmToLngLat(
  easting: number,
  northing: number,
  zone: number,
  hemisphere: "N" | "S",
): LngLat {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const beta = [
    n / 2 - (2 * n ** 2) / 3 + (37 * n ** 3) / 96,
    n ** 2 / 48 + n ** 3 / 15,
    (17 * n ** 3) / 480,
  ];
  const delta = [
    2 * n - (2 * n ** 2) / 3 - 2 * n ** 3,
    (7 * n ** 2) / 3 - (8 * n ** 3) / 5,
    (56 * n ** 3) / 15,
  ];

  const xi = (northing - (hemisphere === "S" ? 10_000_000 : 0)) / (k0 * A);
  const eta = (easting - 500_000) / (k0 * A);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 3; j++) {
    xiP -= beta[j - 1]! * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= beta[j - 1]! * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let lat = chi;
  for (let j = 1; j <= 3; j++) {
    lat += delta[j - 1]! * Math.sin(2 * j * chi);
  }
  const lon0 = zone * 6 - 183;
  return [lon0 + Math.atan2(Math.sinh(etaP), Math.cos(xiP)) / DEG, lat / DEG];
}

export type SurfaceProfile = {
  /** Distance along the ground, including slope. */
  surfaceMeters: number;
  climbMeters: number;
  descentMeters: number;
};

/**
 * Walk a path over terrain, sampling elevation about every `stepMeters` (at most 200 samples per
 * segment). Returns undefined if any elevation is unknown (e.g. terrain tiles not loaded).
 */
export function surfaceProfile(
  points: readonly LngLat[],
  elevationAt: (point: LngLat) => number | undefined,
  stepMeters = 10,
): SurfaceProfile | undefined {
  const profile: SurfaceProfile = { surfaceMeters: 0, climbMeters: 0, descentMeters: 0 };
  let previous: { point: LngLat; elevation: number } | undefined;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const steps = Math.min(200, Math.max(1, Math.ceil(distanceMeters(from, to) / stepMeters)));
    for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
      const t = s / steps;
      // Linear interpolation in lon/lat is accurate enough at sampling distances.
      const point: LngLat = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      const elevation = elevationAt(point);
      if (elevation == undefined) {
        return undefined;
      }
      if (previous) {
        const rise = elevation - previous.elevation;
        profile.surfaceMeters += Math.hypot(distanceMeters(previous.point, point), rise);
        profile.climbMeters += Math.max(0, rise);
        profile.descentMeters += Math.max(0, -rise);
      }
      previous = { point, elevation };
    }
  }
  return profile;
}

/** Heights and elevations: always meters or feet, never km or miles. */
export function formatElevation(meters: number, units: Units): string {
  return units === "imperial" ? `${(meters / 0.3048).toFixed(0)} ft` : `${meters.toFixed(1)} m`;
}
