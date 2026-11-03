// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  bearingDegrees,
  distanceMeters,
  ellipseRing,
  formatArea,
  formatDistance,
  pathLengthMeters,
  polygonAreaSquareMeters,
  surfaceProfile,
  utmToLngLat,
  webMercatorToLngLat,
} from "./geo";

describe("geo", () => {
  it("measures distance and path length", () => {
    // One degree of latitude on the mean-radius sphere.
    expect(distanceMeters([0, 0], [0, 1])).toBeCloseTo(111_195, -1);
    expect(
      pathLengthMeters([
        [0, 0],
        [0, 1],
        [0, 2],
      ]),
    ).toBeCloseTo(2 * 111_195, -1);
  });

  it("computes bearings clockwise from north", () => {
    expect(bearingDegrees([0, 0], [0, 1])).toBeCloseTo(0);
    expect(bearingDegrees([0, 0], [1, 0])).toBeCloseTo(90);
    expect(bearingDegrees([0, 0], [-1, 0])).toBeCloseTo(270);
  });

  it("computes spherical polygon area", () => {
    const area = polygonAreaSquareMeters([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    expect(area / 1e6).toBeCloseTo(12_363.7, 0);
  });

  it("builds a closed ellipse ring with the requested radii", () => {
    const ring = ellipseRing([10, 50], [10, 5], 0, 4);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(distanceMeters([10, 50], ring[0]!)).toBeCloseTo(10, 1); // east, major axis
    expect(distanceMeters([10, 50], ring[1]!)).toBeCloseTo(5, 1); // north, minor axis
  });

  it("inverts Web Mercator and UTM", () => {
    const [lon, lat] = webMercatorToLngLat(1113194.9, 1118889.97);
    expect(lon).toBeCloseTo(10, 4);
    expect(lat).toBeCloseTo(10, 4);

    expect(utmToLngLat(500_000, 0, 32, "N")).toEqual([9, 0]);
    // On the central meridian, northing is the scaled meridian arc (5540847 m at 50°N).
    const [mLon, mLat] = utmToLngLat(500_000, 5_540_847.04 * 0.9996, 33, "N");
    expect(mLon).toBeCloseTo(15, 6);
    expect(mLat).toBeCloseTo(50, 3);
    // Southern hemisphere uses a 10,000 km false northing.
    expect(utmToLngLat(500_000, 10_000_000, 33, "S")[1]).toBeCloseTo(0, 9);
  });

  it("formats values per unit system", () => {
    expect(formatDistance(12.345, "metric")).toBe("12.35 m");
    expect(formatDistance(2500, "metric")).toBe("2.500 km");
    expect(formatDistance(1852, "nautical")).toBe("1.00 nmi");
    expect(formatArea(20_000, "metric")).toBe("2.000 ha");
    expect(formatArea(4046.8564224, "imperial")).toBe("1.000 ac");
  });

  it("profiles a path over terrain", () => {
    // A 1 km path climbing 100 m linearly, then a flat leg back.
    const path: [number, number][] = [
      [0, 0],
      [0, 0.0089932],
      [0, 0],
    ];
    const profile = surfaceProfile(path, ([, lat]) => (lat / 0.0089932) * 100);
    expect(profile!.climbMeters).toBeCloseTo(100, 6);
    expect(profile!.descentMeters).toBeCloseTo(100, 6);
    expect(profile!.surfaceMeters).toBeCloseTo(2 * Math.hypot(1000, 100), -1);
    expect(surfaceProfile(path, () => undefined)).toBeUndefined();
  });
});
