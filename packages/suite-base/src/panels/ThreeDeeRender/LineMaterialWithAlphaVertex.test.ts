// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three/webgpu";

import { LineMaterialWithAlphaVertex } from "./LineMaterialWithAlphaVertex";

describe("LineMaterialWithAlphaVertex", () => {
  it.each([
    [true, 0.25],
    [true, 1],
    [false, 0.25],
    [false, 1],
  ])(
    "never builds as opaque, keeping its opacity (transparent=%s, opacity=%s)",
    (transparent, opacity) => {
      let opaque: boolean | undefined;
      let composited: boolean | undefined;
      const spy = vi
        .spyOn(THREE.Line2NodeMaterial.prototype, "setupDiffuseColor")
        .mockImplementation(function (this: THREE.Line2NodeMaterial) {
          // What NodeBuilder.isOpaque() and the superclass's compositing read
          opaque = (
            THREE.NodeBuilder.prototype as unknown as {
              isOpaque(this: { material: THREE.Material }): boolean;
            }
          ).isOpaque.call({ material: this });
          composited = this.transparent;
        });
      const material = new LineMaterialWithAlphaVertex({ transparent, opacity });
      const builder = { geometry: new THREE.BufferGeometry() } as unknown as THREE.NodeBuilder;

      material.setupDiffuseColor(builder);

      expect(opaque).toBe(false);
      expect(composited).toBe(false);
      expect(material.transparent).toBe(transparent);
      expect(material.blending).toBe(THREE.NormalBlending);
      expect(material.opacity).toBe(opacity);
      expect(material.alphaToCoverage).toBe(!transparent);
      spy.mockRestore();
    },
  );
});
