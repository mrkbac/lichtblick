// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { MeshUpAxis, ModelCache } from "./ModelCache";

vi.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => ({ default: "" }));

// Smallest valid glTF: one empty scene
const EMPTY_GLTF = new TextEncoder().encode(
  JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }] }),
);

async function loadGltf(meshUpAxis: MeshUpAxis) {
  const modelCache = new ModelCache({
    edgeMaterial: new THREE.LineBasicMaterial(),
    ignoreColladaUpAxis: false,
    meshUpAxis,
    fetchAsset: async (uri) => ({ uri, data: EMPTY_GLTF, mediaType: "model/gltf+json" }),
  });
  const reportError = vi.fn();
  const model = await modelCache.load("file:///example.gltf", {}, reportError);
  expect(reportError).not.toHaveBeenCalled();
  return model!;
}

describe("ModelCache", () => {
  it("rotates Y-up glTF meshes to Z-up", async () => {
    expect((await loadGltf("y_up")).rotation.x).toBeCloseTo(Math.PI / 2);
  });

  it("leaves glTF meshes alone when the mesh up axis is Z-up", async () => {
    expect((await loadGltf("z_up")).rotation.x).toBe(0);
  });
});
