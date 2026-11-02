// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { buildingsGeometry } from "./mapBuildings";

describe("buildingsGeometry", () => {
  const center = { lat: 0, lon: 0 };
  // ~11 m square just north-east of the center.
  const square = [
    [0, 0],
    [0.0001, 0],
    [0.0001, 0.0001],
    [0, 0.0001],
    [0, 0],
  ];

  it("extrudes footprints from base to height above the ground", () => {
    const geometry = buildingsGeometry(
      [
        {
          geometry: { type: "Polygon", coordinates: [square] },
          layer: {
            paint: {
              "fill-extrusion-base": 2,
              "fill-extrusion-height": 12,
              "fill-extrusion-color": { r: 0.5, g: 0, b: 0, a: 0.5 },
            },
          },
        },
        // Flat and non-polygon features are skipped.
        {
          geometry: { type: "Polygon", coordinates: [square] },
          layer: { paint: { "fill-extrusion-height": 0 } },
        },
        { geometry: { type: "Point", coordinates: [0, 0] }, layer: {} },
      ],
      center,
      () => 100,
    )!;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.min.z).toBeCloseTo(102);
    expect(box.max.z).toBeCloseTo(112);
    expect(box.min.x).toBeCloseTo(0, 1);
    expect(box.max.x).toBeCloseTo(11.1, 0);
    expect(box.max.y).toBeCloseTo(11.1, 0);
    const color = new THREE.Color().fromBufferAttribute(
      geometry.attributes.color as THREE.BufferAttribute,
      0,
    );
    expect(color.getHexString(THREE.SRGBColorSpace)).toBe("ff0000");
  });

  it("returns nothing without buildings", () => {
    expect(buildingsGeometry([], center, () => 0)).toBeUndefined();
  });
});
