// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  decodeElevation,
  demTilesFor,
  enuOffset,
  metersPerMercator,
  sampleElevation,
  toMercator,
  zoomForSpan,
} from "./mapGeo";

describe("mapGeo", () => {
  it("measures east/north offsets, across the antimeridian too", () => {
    const north = enuOffset({ lat: 48, lon: 11 }, { lat: 48.001, lon: 11 });
    expect(north.north).toBeCloseTo(111.32, 1);
    expect(north.east).toBeCloseTo(0);

    const wrap = enuOffset({ lat: 0, lon: 179.9999 }, { lat: 0, lon: -179.9999 });
    expect(wrap.east).toBeCloseTo(22.26, 1);
  });

  it("picks the zoom where the canvas spans the requested size", () => {
    const zoom = zoomForSpan(48, 500, 2048);
    const metersPerPixel = metersPerMercator(48) / (512 * 2 ** zoom);
    expect(metersPerPixel * 2048).toBeCloseTo(500);
  });

  it("decodes terrarium and mapbox elevation", () => {
    expect(decodeElevation(128, 0, 0, "terrarium")).toBe(0);
    expect(decodeElevation(0x01, 0x86, 0xa0, "mapbox")).toBe(0);
  });

  it("samples bilinearly across tile edges", () => {
    // Zoom 1 has 2x2 tiles; left tiles are 0 m, right tiles 100 m.
    const tile = (value: number) => new Float32Array(4).fill(value);
    const dem = {
      zoom: 1,
      tileSize: 2,
      tiles: new Map([
        ["0/0", tile(0)],
        ["1/0", tile(100)],
        ["0/1", tile(0)],
        ["1/1", tile(100)],
      ]),
    };
    expect(sampleElevation(dem, { x: 0.5, y: 0.25 })).toBeCloseTo(50);
    expect(sampleElevation(dem, { x: 0.1, y: 0.25 })).toBeCloseTo(0);
    expect(sampleElevation(dem, { x: 0.8, y: 0.25 })).toBeCloseTo(100);
  });

  it("covers the map with at most 16 DEM tiles", () => {
    const source = { url: "", tileSize: 256, maxZoom: 15, encoding: "terrarium" as const };
    const center = { lat: 48, lon: 11 };
    const { zoom, tiles } = demTilesFor(source, center, 500, 4);
    expect(zoom).toBe(15);
    expect(tiles.length).toBeLessThanOrEqual(16);
    const merc = toMercator(center);
    expect(tiles).toContainEqual([Math.floor(merc.x * 2 ** zoom), Math.floor(merc.y * 2 ** zoom)]);

    expect(demTilesFor(source, center, 20000, 4).tiles.length).toBeLessThanOrEqual(16);
  });
});
