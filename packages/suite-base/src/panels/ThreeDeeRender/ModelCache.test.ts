// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { JSDOM } from "jsdom";
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

const TRIANGLE = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const triangleGltf = (uri: string) => ({
  asset: { version: "2.0" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  buffers: [{ uri, byteLength: TRIANGLE.byteLength }],
  bufferViews: [{ buffer: 0, byteLength: TRIANGLE.byteLength }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
  ],
});

function cacheWithAssets(assets: Record<string, string | Uint8Array>, canonicalUrl?: string) {
  const fetchAsset = vi.fn(async (uri: string) => {
    const data = assets[uri];
    if (data == undefined) {
      throw new Error(`Missing asset: ${uri}`);
    }
    return {
      uri: canonicalUrl && uri.startsWith("package:") ? canonicalUrl : uri,
      data: typeof data === "string" ? new TextEncoder().encode(data) : data,
    };
  });
  const cache = new ModelCache({
    edgeMaterial: new THREE.LineBasicMaterial(),
    ignoreColladaUpAxis: false,
    meshUpAxis: "z_up",
    fetchAsset,
  });
  return { cache, fetchAsset };
}

describe("model dependencies", () => {
  beforeEach(() => {
    vi.stubGlobal("ProgressEvent", new JSDOM().window.ProgressEvent);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([false, true])(
    "loads relative glTF buffers through the asset pipeline (binary: %s)",
    async (binary) => {
      // Given
      const json = JSON.stringify(triangleGltf("../data/triangle%20positions.bin"))!;
      const bytes = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, " "));
      const glb = new Uint8Array(20 + bytes.length);
      const view = new DataView(glb.buffer);
      view.setUint32(0, 0x676c5446);
      view.setUint32(4, 2, true);
      view.setUint32(8, glb.length, true);
      view.setUint32(12, bytes.length, true);
      view.setUint32(16, 0x4e4f534a, true);
      glb.set(bytes, 20);
      const { cache, fetchAsset } = cacheWithAssets(
        {
          "package://robot/meshes/triangle.gltf": binary ? glb : json,
          "local-asset://folder/data/triangle%20positions.bin": new Uint8Array(TRIANGLE.buffer),
        },
        "local-asset://folder/meshes/triangle.gltf",
      );
      const revoke = vi.spyOn(URL, "revokeObjectURL");
      const error = vi.fn();
      // When
      const model = await cache.load("package://robot/meshes/triangle.gltf", {}, error);
      // Then
      expect(error).not.toHaveBeenCalled();
      expect((model!.children[0] as THREE.Mesh).geometry.getAttribute("position").count).toBe(3);
      expect(fetchAsset).toHaveBeenCalledWith(
        "local-asset://folder/data/triangle%20positions.bin",
        { referenceUrl: "local-asset://folder/meshes/triangle.gltf" },
      );
      cache.dispose();
      expect(revoke).toHaveBeenCalledWith(expect.stringMatching(/^blob:/));
    },
  );

  it("reports missing dependencies and retries a failed model", async () => {
    // Given
    const assets: Record<string, string | Uint8Array> = {
      "local-asset://folder/model.gltf": JSON.stringify(triangleGltf("missing.bin"))!,
    };
    const { cache } = cacheWithAssets(assets);
    const error = vi.fn();
    // When
    const failed = await cache.load("local-asset://folder/model.gltf", {}, error);
    // Then
    expect(failed).toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      new Error("Missing asset: local-asset://folder/missing.bin"),
    );
    assets["local-asset://folder/missing.bin"] = new Uint8Array(TRIANGLE.buffer);
    expect(await cache.load("local-asset://folder/model.gltf", {}, vi.fn())).toBeDefined();
    cache.dispose();
  });

  it("loads OBJ materials and textures relative to the material library", async () => {
    // Given
    const textureUrls: string[] = [];
    let finishTexture!: () => void;
    vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(function (
      this: THREE.TextureLoader,
      url,
    ) {
      textureUrls.push(this.manager.resolveURL(url));
      this.manager.itemStart(url);
      finishTexture = () => {
        this.manager.itemEnd(url);
      };
      return new THREE.Texture();
    });
    const { cache, fetchAsset } = cacheWithAssets({
      "local-asset://folder/models/triangle.obj":
        "mtllib ../materials/robot.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl painted\nf 1 2 3\n",
      "local-asset://folder/materials/robot.mtl":
        "newmtl painted\nKd 1 0 0\nmap_Kd -s 2 2 1 ../textures/red paint.png\n",
      "local-asset://folder/textures/red%20paint.png": new Uint8Array([1]),
    });
    const error = vi.fn();
    // When
    const loading = cache.load("local-asset://folder/models/triangle.obj", {}, error);
    let settled = false;
    void loading.then(() => {
      settled = true;
    });
    await vi.waitFor(() => {
      expect(finishTexture).toBeDefined();
    });
    // Then
    expect(settled).toBe(false);
    finishTexture();
    const model = await loading;
    expect(error).not.toHaveBeenCalled();
    const material = (model!.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(material.name).toBe("painted");
    expect(material.map).toBeDefined();
    expect(textureUrls).toEqual([expect.stringMatching(/^blob:/)]);
    expect(fetchAsset).toHaveBeenCalledWith("local-asset://folder/textures/red%20paint.png", {
      referenceUrl: "local-asset://folder/materials/robot.mtl",
    });
    cache.dispose();
  });

  it.each([false, true])(
    "loads COLLADA without mistaking surface identifiers for images (missing texture: %s)",
    async (missing) => {
      // Given
      vi.stubGlobal("DOMParser", new JSDOM().window.DOMParser);
      const { cache, fetchAsset } = cacheWithAssets({
        "local-asset://folder/model.dae": `<COLLADA version="1.4.1"><asset><up_axis>Z_UP</up_axis></asset><library_images><image id="paint"><init_from>textures/paint.png</init_from></image></library_images><library_effects><effect id="paint-effect"><profile_COMMON><newparam sid="surface"><surface type="2D"><init_from>paint</init_from></surface></newparam></profile_COMMON></effect></library_effects><library_visual_scenes><visual_scene id="Scene"/></library_visual_scenes><scene><instance_visual_scene url="#Scene"/></scene></COLLADA>`,
        ...(missing ? {} : { "local-asset://folder/textures/paint.png": new Uint8Array([1]) }),
      });
      const error = vi.fn();
      // When
      const model = await cache.load("local-asset://folder/model.dae", {}, error);
      // Then
      expect(model).toBeDefined();
      expect(error.mock.calls.map(([value]) => (value as Error).message)).toEqual(
        missing ? ['Failed to load COLLADA asset "local-asset://folder/textures/paint.png"'] : [],
      );
      expect(console.error).toHaveBeenCalledTimes(missing ? 1 : 0);
      vi.mocked(console.error).mockClear();
      expect(fetchAsset).toHaveBeenCalledTimes(2);
      cache.dispose();
    },
  );

  it.each(["library", "texture"])(
    "keeps OBJ geometry when its optional %s is missing",
    async (missing) => {
      // Given
      const assets: Record<string, string> = {
        "local-asset://folder/model.obj":
          "mtllib paint.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl paint\nf 1 2 3\n",
      };
      if (missing === "texture") {
        assets["local-asset://folder/paint.mtl"] = "newmtl paint\nKd 1 0 0\nmap_Kd absent.png\n";
      }
      const { cache } = cacheWithAssets(assets);
      const error = vi.fn();
      // When
      const model = await cache.load("local-asset://folder/model.obj", {}, error);
      // Then
      expect(model).toBeDefined();
      expect((model!.children[0] as THREE.Mesh).geometry.getAttribute("position").count).toBe(3);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(missing === "texture" ? "absent.png" : "paint.mtl"),
        }),
      );
      expect(model!.hasEmbeddedMaterials).toBe(missing === "texture");
      expect(console.error).toHaveBeenCalled();
      vi.mocked(console.error).mockClear();
      cache.dispose();
    },
  );

  it("keeps glTF geometry when an image is missing", async () => {
    // Given
    vi.stubGlobal("self", globalThis);
    const json = {
      ...triangleGltf("positions.bin"),
      images: [{ uri: "absent.png" }],
      textures: [{ source: 0 }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    };
    const { cache } = cacheWithAssets({
      "local-asset://folder/model.gltf": JSON.stringify(json)!,
      "local-asset://folder/positions.bin": new Uint8Array(TRIANGLE.buffer),
    });
    const error = vi.fn();
    // When
    const model = await cache.load("local-asset://folder/model.gltf", {}, error);
    // Then
    expect(model).toBeDefined();
    expect((model!.children[0] as THREE.Mesh).geometry.getAttribute("position").count).toBe(3);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("absent.png") }),
    );
    expect(console.error).toHaveBeenCalled();
    vi.mocked(console.error).mockClear();
    cache.dispose();
  });

  it.each([false, true])("preserves platform TIFF fetching (desktop: %s)", async (desktop) => {
    // Given
    vi.stubGlobal("desktopBridge", desktop ? {} : undefined);
    const textureUrl = desktop
      ? "x-foxglove-converted-tiff://robot/textures/paint.tiff"
      : "package://robot/textures/paint.tiff";
    const { cache, fetchAsset } = cacheWithAssets({
      "package://robot/model.gltf": JSON.stringify({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [] }],
        images: [{ uri: "textures/paint.tiff" }],
      })!,
      [textureUrl]: new Uint8Array([1]),
    });
    const error = vi.fn();
    // When
    const model = await cache.load("package://robot/model.gltf", {}, error);
    // Then
    expect(model).toBeDefined();
    expect(error).not.toHaveBeenCalled();
    expect(fetchAsset).toHaveBeenCalledWith(textureUrl, {
      referenceUrl: "package://robot/model.gltf",
    });
    cache.dispose();
  });

  it("keeps reference URLs separate in the model cache", async () => {
    // Given
    const { cache, fetchAsset } = cacheWithAssets({ "package://robot/model.gltf": EMPTY_GLTF });
    // When
    await cache.load(
      "package://robot/model.gltf",
      { referenceUrl: "https://example.com/a/robot.urdf" },
      vi.fn(),
    );
    await cache.load(
      "package://robot/model.gltf",
      { referenceUrl: "https://example.com/b/robot.urdf" },
      vi.fn(),
    );
    // Then
    expect(fetchAsset).toHaveBeenCalledTimes(2);
    cache.dispose();
  });

  it("does not create object URLs after disposal during a fetch", async () => {
    // Given
    let finish!: (asset: { uri: string; data: Uint8Array }) => void;
    const create = vi.spyOn(URL, "createObjectURL");
    const cache = new ModelCache({
      edgeMaterial: new THREE.LineBasicMaterial(),
      ignoreColladaUpAxis: false,
      meshUpAxis: "z_up",
      fetchAsset: async (uri) =>
        uri.endsWith("gltf")
          ? { uri, data: new TextEncoder().encode(JSON.stringify(triangleGltf("triangle.bin"))) }
          : await new Promise((resolve) => {
              finish = resolve;
            }),
    });
    const error = vi.fn();
    // When
    const loading = cache.load("local-asset://folder/model.gltf", {}, error);
    await vi.waitFor(() => {
      expect(finish).toBeDefined();
    });
    cache.dispose();
    finish({ uri: "local-asset://folder/triangle.bin", data: new Uint8Array(TRIANGLE.buffer) });
    // Then
    expect(await loading).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
});
