// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

const EARTH_RADIUS = 6378137;
const EARTH_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS;
export const MAX_LATITUDE = 85.051129;

export type LatLon = { lat: number; lon: number };
/** Web Mercator coordinates, [0, 1] from the top left of the world. */
export type Mercator = { x: number; y: number };

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * East/north offset of `to` from `from` in meters. ponytail: equirectangular, off by ~0.1% at
 * 10 km; maps are re-centered well before that.
 */
export function enuOffset(from: LatLon, to: LatLon): { east: number; north: number } {
  const dLon = ((((to.lon - from.lon) % 360) + 540) % 360) - 180;
  return {
    east: toRad(dLon) * EARTH_RADIUS * Math.cos(toRad((from.lat + to.lat) / 2)),
    north: toRad(to.lat - from.lat) * EARTH_RADIUS,
  };
}

/** Ground meters per Web Mercator unit at a latitude. */
export function metersPerMercator(lat: number): number {
  return EARTH_CIRCUMFERENCE * Math.cos(toRad(lat));
}

export function toMercator({ lat, lon }: LatLon): Mercator {
  const sin = Math.sin(toRad(lat));
  return {
    x: (lon + 180) / 360,
    y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  };
}

/** MapLibre zoom (512 px tiles) at which `pixels` span `meters` on the ground. */
export function zoomForSpan(lat: number, meters: number, pixels: number): number {
  return Math.log2((metersPerMercator(lat) * pixels) / (512 * meters));
}

export type DemEncoding = "terrarium" | "mapbox";

export function decodeElevation(r: number, g: number, b: number, encoding: DemEncoding): number {
  return encoding === "terrarium"
    ? r * 256 + g + b / 256 - 32768
    : -10000 + (r * 65536 + g * 256 + b) * 0.1;
}

export type DemTiles = {
  zoom: number;
  tileSize: number;
  /** Decoded elevations in meters, row-major, keyed by `${x}/${y}`. */
  tiles: ReadonlyMap<string, Float32Array>;
};

/** Bilinear elevation at a Mercator point; 0 where no tile is loaded. */
export function sampleElevation(dem: DemTiles, point: Mercator): number {
  const scale = 2 ** dem.zoom * dem.tileSize;
  const px = point.x * scale - 0.5;
  const py = point.y * scale - 0.5;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const pixel = (x: number, y: number) => {
    const tile = dem.tiles.get(`${Math.floor(x / dem.tileSize)}/${Math.floor(y / dem.tileSize)}`);
    const ix = ((x % dem.tileSize) + dem.tileSize) % dem.tileSize;
    const iy = ((y % dem.tileSize) + dem.tileSize) % dem.tileSize;
    return tile?.[iy * dem.tileSize + ix] ?? 0;
  };
  const fx = px - x0;
  const fy = py - y0;
  const top = pixel(x0, y0) * (1 - fx) + pixel(x0 + 1, y0) * fx;
  const bottom = pixel(x0, y0 + 1) * (1 - fx) + pixel(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

export type DemSource = {
  /** XYZ template with {z} {x} {y}. */
  url: string;
  tileSize: number;
  maxZoom: number;
  encoding: DemEncoding;
};

const MAX_DEM_TILES = 16;

/** Tiles at the most detailed zoom (up to `spacing` m/px) covering a square around `center`. */
export function demTilesFor(
  source: DemSource,
  center: LatLon,
  size: number,
  spacing: number,
): { zoom: number; tiles: [number, number][] } {
  const merc = toMercator(center);
  const half = size / 2 / metersPerMercator(center.lat);
  let zoom = Math.ceil(Math.log2(metersPerMercator(center.lat) / (source.tileSize * spacing)));
  zoom = Math.max(0, Math.min(source.maxZoom, zoom));
  for (;;) {
    const n = 2 ** zoom;
    const clamp = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v * n)));
    const [x0, x1] = [clamp(merc.x - half), clamp(merc.x + half)];
    const [y0, y1] = [clamp(merc.y - half), clamp(merc.y + half)];
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_DEM_TILES || zoom === 0) {
      const tiles: [number, number][] = [];
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          tiles.push([x, y]);
        }
      }
      return { zoom, tiles };
    }
    zoom--;
  }
}

async function fetchDemTile(
  source: DemSource,
  z: number,
  x: number,
  y: number,
  signal: AbortSignal,
): Promise<Float32Array | undefined> {
  const url = source.url
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
  const response = await fetch(url, { signal });
  if (!response.ok) {
    return undefined; // Missing tiles (oceans) read as sea level.
  }
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < out.length; i++) {
    out[i] = decodeElevation(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, source.encoding);
  }
  return out;
}

export async function loadDem(
  source: DemSource,
  center: LatLon,
  size: number,
  spacing: number,
  signal: AbortSignal,
): Promise<DemTiles> {
  const { zoom, tiles } = demTilesFor(source, center, size, spacing);
  const loaded = new Map<string, Float32Array>();
  await Promise.all(
    tiles.map(async ([x, y]) => {
      const tile = await fetchDemTile(source, zoom, x, y, signal);
      if (tile) {
        loaded.set(`${x}/${y}`, tile);
      }
    }),
  );
  return { zoom, tileSize: source.tileSize, tiles: loaded };
}
