// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MeshoptDecoder } from "meshoptimizer/decoder";
import * as THREE from "three";
import dracoDecoderWasmUrl from "three/examples/jsm/libs/draco/draco_decoder.wasm";
import dracoWasmWrapperJs from "three/examples/jsm/libs/draco/draco_wasm_wrapper.js?raw";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

import Logger from "@lichtblick/log";
import { BuiltinPanelExtensionContext } from "@lichtblick/suite-base/components/PanelExtensionAdapter";

const log = Logger.getLogger(__filename);

export type MeshUpAxis = "y_up" | "z_up";
export const DEFAULT_MESH_UP_AXIS: MeshUpAxis = "y_up";

export type ModelCacheOptions = {
  edgeMaterial: THREE.Material;
  ignoreColladaUpAxis: boolean;
  meshUpAxis: MeshUpAxis;
  fetchAsset: BuiltinPanelExtensionContext["unstable_fetchAsset"];
};

type LoadModelOptions = {
  overrideMediaType?: string;
  /** A URL to e.g. a URDf which may be used to resolve mesh package:// URLs */
  referenceUrl?: string;
};

export type LoadedModel = (THREE.Group | THREE.Scene) & { hasEmbeddedMaterials?: boolean };

type ErrorCallback = (err: Error) => void;

const DEFAULT_COLOR = new THREE.Color(0x248eff);

const GLTF_MIME_TYPES = ["model/gltf", "model/gltf-binary", "model/gltf+json"];
// Sourced from <https://github.com/Ultimaker/Cura/issues/4141>
const STL_MIME_TYPES = ["model/stl", "model/x.stl-ascii", "model/x.stl-binary", "application/sla"];
const DAE_MIME_TYPES = ["model/vnd.collada+xml"];
const OBJ_MIME_TYPES = ["model/obj", "text/prs.wavefront-obj"];

export class ModelCache {
  #textDecoder = new TextDecoder();
  #models = new Map<string, Promise<LoadedModel | undefined>>();
  #edgeMaterial: THREE.Material;
  #fetchAsset: BuiltinPanelExtensionContext["unstable_fetchAsset"];
  #objectUrls = new Map<string, string>();
  #disposed = false;
  #dracoLoader?: DRACOLoader;

  public constructor(public readonly options: ModelCacheOptions) {
    this.#edgeMaterial = options.edgeMaterial;
    this.#fetchAsset = options.fetchAsset;
  }

  public async load(
    url: string,
    opts: LoadModelOptions,
    reportError: ErrorCallback,
  ): Promise<LoadedModel | undefined> {
    const key = JSON.stringify([url, opts.referenceUrl, opts.overrideMediaType])!;
    let promise = this.#models.get(key);
    if (promise) {
      return await promise;
    }

    promise = this.#loadModel(url, opts, reportError)
      .then((model) => addEdges(model, this.#edgeMaterial))
      .catch(async (err: unknown) => {
        this.#models.delete(key);
        reportError(err as Error);
        return undefined;
      });

    this.#models.set(key, promise);
    return await promise;
  }

  async #loadModel(
    requestedUrl: string,
    options: LoadModelOptions,
    reportError: ErrorCallback,
  ): Promise<LoadedModel> {
    const GLB_MAGIC = 0x676c5446; // "glTF"

    const asset = await this.#fetchAsset(requestedUrl, { referenceUrl: options.referenceUrl });

    const url = asset.uri;
    const extension = new URL(url).pathname.toLowerCase();
    const buffer = asset.data;
    if (buffer.byteLength < 4) {
      throw new Error(`${buffer.byteLength} bytes received`);
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const contentType = options.overrideMediaType ?? asset.mediaType ?? "";

    // Check if this is a glTF .glb or .gltf file
    if (
      GLB_MAGIC === view.getUint32(0, false) ||
      GLTF_MIME_TYPES.includes(contentType) ||
      extension.endsWith(".glb") ||
      extension.endsWith(".gltf")
    ) {
      // Create a copy of the array buffer to respect the `byteOffset` and `byteLength` value as
      // the underlying three.js STLLoader only accepts an ArrayBuffer instance.
      return await this.#loadGltf(
        url,
        (buffer.buffer as ArrayBuffer).slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ),
        this.options.meshUpAxis,
        reportError,
      );
    }

    // Check if this is a STL file based on content-type or file extension
    if (STL_MIME_TYPES.includes(contentType) || extension.endsWith(".stl")) {
      // Create a copy of the array buffer to respect the `byteOffset` and `byteLength` value as
      // the underlying three.js STLLoader only accepts an ArrayBuffer instance.
      return this.#loadSTL(
        url,
        (buffer.buffer as ArrayBuffer).slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ),
        this.options.meshUpAxis,
      );
    }

    // Check if this is a COLLADA file based on content-type or file extension
    if (DAE_MIME_TYPES.includes(contentType) || extension.endsWith(".dae")) {
      const text = this.#textDecoder.decode(buffer);
      return await this.#loadCollada(url, text, this.options.ignoreColladaUpAxis, reportError);
    }

    // Check if this is an OBJ file based on content-type or file extension
    if (OBJ_MIME_TYPES.includes(contentType) || extension.endsWith(".obj")) {
      const text = this.#textDecoder.decode(buffer);
      return await this.#loadOBJ(url, text, this.options.meshUpAxis, reportError);
    }

    throw new Error(`Unknown ${buffer.byteLength} byte mesh (content-type: "${contentType}")`);
  }

  async #loadGltf(
    url: string,
    buffer: ArrayBuffer,
    meshUpAxis: MeshUpAxis,
    reportError: ErrorCallback,
  ): Promise<LoadedModel> {
    const onError = (assetUrl: string) => {
      const originalUrl = this.#objectUrls.get(assetUrl) ?? unrewriteUrl(assetUrl);
      log.error(`Failed to load GLTF asset "${originalUrl}" for "${url}"`);
      reportError(new Error(`Failed to load GLTF asset "${originalUrl}"`));
    };

    const manager = new THREE.LoadingManager(undefined, undefined, onError);
    const view = new DataView(buffer);
    const jsonText =
      view.getUint32(0, false) === 0x676c5446
        ? this.#textDecoder.decode(new Uint8Array(buffer, 20, view.getUint32(12, true)))
        : this.#textDecoder.decode(buffer);
    const json = JSON.parse(jsonText) as {
      buffers?: { uri?: string }[];
      images?: { uri?: string }[];
    };
    await this.#prepareResources(
      url,
      [...(json.buffers ?? []), ...(json.images ?? [])].flatMap(({ uri }) => (uri ? [uri] : [])),
      manager,
    );
    const gltfLoader = new GLTFLoader(manager);
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    gltfLoader.setDRACOLoader(this.#getDracoLoader(manager));

    manager.itemStart(url);
    const gltf = await gltfLoader.parseAsync(buffer, "");
    manager.itemEnd(url);

    // glTF is Y-up by spec, while we follow the ROS
    // [REP-0103](https://www.ros.org/reps/rep-0103.html) convention of Z-up. Many robot meshes are
    // exported Z-up anyway, so honor the mesh up axis setting like STL and OBJ do.
    if (meshUpAxis === "y_up") {
      gltf.scene.rotateX(Math.PI / 2);
    }

    return gltf.scene;
  }

  #loadSTL(url: string, buffer: ArrayBuffer, meshUpAxis: MeshUpAxis): LoadedModel {
    // STL files do not reference any external assets, no LoadingManager needed
    const stlLoader = new STLLoader();
    const bufferGeometry = stlLoader.parse(buffer);
    log.debug(`Finished loading STL from ${url}`);
    const material = new THREE.MeshStandardMaterial({
      name: url.slice(-32), // truncate to 32 characters
      color: DEFAULT_COLOR,
      metalness: 0,
      roughness: 1,
      dithering: true,
    });
    const mesh = new THREE.Mesh(bufferGeometry, material);
    const group = new THREE.Group();
    group.add(mesh);

    // THREE.js uses Y-up, while Studio follows the ROS
    // [REP-0103](https://www.ros.org/reps/rep-0103.html) convention of Z-up
    if (meshUpAxis === "y_up") {
      group.rotateX(Math.PI / 2);
    }

    return group;
  }

  async #loadCollada(
    url: string,
    text: string,
    // eslint-disable-next-line @lichtblick/no-boolean-parameters
    ignoreUpAxis: boolean,
    reportError: ErrorCallback,
  ): Promise<LoadedModel> {
    const onError = (assetUrl: string) => {
      const originalUrl = this.#objectUrls.get(assetUrl) ?? unrewriteUrl(assetUrl);
      log.error(`Failed to load COLLADA asset "${originalUrl}" for "${url}"`);
      reportError(new Error(`Failed to load COLLADA asset "${originalUrl}"`));
    };

    // The three.js ColladaLoader handles <up_axis> by detecting Z_UP and simply
    // applying a scene rotation. Since Studio is already Z_UP, we do our own
    // <up_axis> handling and skip rotation entirely for the Z_UP case
    const xml = new DOMParser().parseFromString(text, "application/xml");
    const upAxis = ignoreUpAxis
      ? "Z_UP"
      : (xml.querySelector("up_axis")?.textContent ?? "Y_UP").trim().toUpperCase();
    xml.querySelectorAll("up_axis").forEach((node) => {
      node.remove();
    });
    const xmlText = xml.documentElement.outerHTML;

    let texturesLoaded!: () => void;
    const texturesReady = new Promise<void>((resolve) => {
      texturesLoaded = resolve;
    });
    const manager = new THREE.LoadingManager(texturesLoaded, undefined, onError);
    await this.#prepareResources(
      url,
      [...xml.querySelectorAll("library_images image init_from")].flatMap((node) => {
        const uri = (node.querySelector("ref")?.textContent ?? node.textContent).trim();
        return uri ? [uri] : [];
      }),
      manager,
    );
    const daeLoader = new ColladaLoader(manager);

    manager.itemStart(url);
    const dae = daeLoader.parse(xmlText, "");
    manager.itemEnd(url);
    await texturesReady;
    if (dae == undefined) {
      throw new Error(`Failed to parse COLLADA model "${url}"`);
    }

    // If the <up_axis> is Y_UP, rotate to the Studio convention of Z-up following
    // ROS [REP-0103](https://www.ros.org/reps/rep-0103.html)
    if (upAxis === "Y_UP") {
      dae.scene.rotateX(Math.PI / 2);
    }

    return fixDaeMaterials(dae.scene);
  }

  async #loadOBJ(
    url: string,
    text: string,
    meshUpAxis: MeshUpAxis,
    reportError: ErrorCallback,
  ): Promise<LoadedModel> {
    const onError = (assetUrl: string) => {
      const originalUrl = this.#objectUrls.get(assetUrl) ?? unrewriteUrl(assetUrl);
      log.error(`Failed to load OBJ asset "${originalUrl}" for "${url}"`);
      reportError(new Error(`Failed to load OBJ asset "${originalUrl}"`));
    };

    const manager = new THREE.LoadingManager(undefined, undefined, onError);
    const objLoader = new OBJLoader(manager);
    const libraries = [...text.matchAll(/^\s*mtllib\s+(.+)$/gm)].map((match) => match[1]!.trim());
    const materials = new MTLLoader().parse("", "");
    for (const library of libraries) {
      const materialUrl = new URL(library, url).toString();
      const asset = await this.#fetchAsset(materialUrl, { referenceUrl: url });
      const creator = new MTLLoader(manager).parse(this.#textDecoder.decode(asset.data), "");
      const textures = Object.values(creator.materialsInfo).flatMap((info) =>
        [
          info.map_kd,
          info.map_ks,
          info.map_ke,
          info.norm,
          info.map_bump,
          info.bump,
          info.disp,
          info.map_d,
        ].flatMap((value) => (value ? [creator.getTextureParams(value, {}).url] : [])),
      );
      // Each MTL has its own base directory and URL map.
      let texturesLoaded!: () => void;
      const texturesReady = new Promise<void>((resolve) => {
        texturesLoaded = resolve;
      });
      const materialManager = new THREE.LoadingManager(texturesLoaded, undefined, onError);
      await this.#prepareResources(asset.uri, textures, materialManager);
      creator.setManager(materialManager);
      materialManager.itemStart(asset.uri);
      creator.preload();
      materialManager.itemEnd(asset.uri);
      await texturesReady;
      Object.assign(materials.materials, creator.materials);
    }
    if (libraries.length > 0) {
      objLoader.setMaterials(materials);
    }

    manager.itemStart(url);
    const group: LoadedModel = objLoader.parse(text);
    group.hasEmbeddedMaterials = libraries.length > 0;
    manager.itemEnd(url);

    // THREE.js uses Y-up, while Studio follows the ROS
    // [REP-0103](https://www.ros.org/reps/rep-0103.html) convention of Z-up
    if (meshUpAxis === "y_up") {
      group.rotateX(Math.PI / 2);
    }

    return fixObjMaterials(group);
  }

  // singleton dracoloader
  #getDracoLoader(manager: THREE.LoadingManager): DRACOLoader {
    let dracoLoader = this.#dracoLoader;
    if (!dracoLoader) {
      dracoLoader = createBundledDracoLoader(manager);
      this.#dracoLoader = dracoLoader;
    }

    dracoLoader.manager = manager;
    return dracoLoader;
  }

  async #prepareResources(
    url: string,
    resources: string[],
    manager: THREE.LoadingManager,
  ): Promise<void> {
    // LoadingManager requires a synchronous URL modifier, so fetch dependencies before parsing.
    const assets = await Promise.all(
      [...new Set(resources)]
        .filter((resource) => !/^(data|blob):/i.test(resource))
        .map(async (resource) => {
          const resolved = new URL(resource, url).toString();
          return [resolved, await this.#fetchAsset(resolved, { referenceUrl: url })] as const;
        }),
    );
    if (this.#disposed) {
      throw new Error("Model cache was disposed while loading assets");
    }
    const urls = new Map<string, string>();
    for (const [resolved, asset] of assets) {
      const objectUrl = URL.createObjectURL(
        new Blob([new Uint8Array(asset.data)], { type: asset.mediaType }),
      );
      this.#objectUrls.set(objectUrl, resolved);
      urls.set(resolved, objectUrl);
    }
    manager.setURLModifier(
      (resource) => urls.get(new URL(resource, url).toString()) ?? rewriteUrl(resource),
    );
  }

  public dispose(): void {
    this.#disposed = true;
    for (const objectUrl of this.#objectUrls.keys()) {
      URL.revokeObjectURL(objectUrl);
    }
    this.#objectUrls.clear();
    this.#models.clear();
    // DRACOLoader is only loader that needs to be disposed because it uses a webworker
    this.#dracoLoader?.dispose();
    this.#dracoLoader = undefined;
  }
}

export const EDGE_LINE_SEGMENTS_NAME = "edges";
function addEdges(model: LoadedModel, edgeMaterial: THREE.Material): LoadedModel {
  const edgesToAdd: [edges: THREE.LineSegments, parent: THREE.Object3D][] = [];

  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    // Enable shadows for all meshes
    child.castShadow = true;
    child.receiveShadow = true;

    // Draw edges for all meshes
    const edgesGeometry = new THREE.EdgesGeometry(child.geometry, 40);
    const line = new THREE.LineSegments(edgesGeometry, edgeMaterial);
    line.name = EDGE_LINE_SEGMENTS_NAME;
    edgesToAdd.push([line, child]);
  });

  for (const [line, parent] of edgesToAdd) {
    parent.add(line);
  }
  return model;
}

function fixDaeMaterials(model: LoadedModel): LoadedModel {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.material instanceof THREE.MeshLambertMaterial) {
      const material = toStandard(child.material);
      child.material.dispose();
      child.material = material;
    } else if (child.material instanceof THREE.MeshStandardMaterial) {
      child.material.dithering = true;
    }
  });
  return model;
}

function fixObjMaterials(model: LoadedModel): LoadedModel {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.material instanceof THREE.MeshPhongMaterial) {
      const material = toStandard(child.material);
      child.material.dispose();
      child.material = material;
    } else if (child.material instanceof THREE.MeshStandardMaterial) {
      child.material.metalness = 0;
      child.material.roughness = 1;
      child.material.dithering = true;
    }
  });
  return model;
}

function toStandard(
  material: THREE.MeshPhongMaterial | THREE.MeshLambertMaterial,
): THREE.MeshStandardMaterial {
  const standard = new THREE.MeshStandardMaterial({ name: material.name });
  const shininess = (material as Partial<THREE.MeshPhongMaterial>).shininess ?? 0; // [0-100]

  // MeshStandardMaterial.copy() assumes the normalScale property exists, which
  // is true for other MeshStandardMaterials or MeshPhongMaterial but not
  // MeshLambertMaterial. Default initialize this property if needed so the
  // `standard.copy(material)` below succeeds
  const maybePhong = material as Partial<THREE.MeshPhongMaterial>;
  maybePhong.normalScale ??= new THREE.Vector2(1, 1);

  standard.copy(material);
  standard.metalness = 0;
  standard.roughness = 1 - shininess / 100;
  standard.dithering = true;
  return standard;
}

// The THREE.TextureLoader does not support loading .tiff files into textures. To work around
// this we rewrite any `package://` url pointing at a .tiff file into a url which returns a png.
// The x-foxglove-converted-tiff protocol is used because the electron protocol handler for
// package:// uses registerFileProtocol and for converted tiff we need registerBufferProtocol
function rewriteUrl(url: string): string {
  if (url.startsWith("package://") && /\.tiff?$/i.test(url)) {
    return url.replace("package://", "x-foxglove-converted-tiff://");
  }
  return url;
}

function unrewriteUrl(url: string): string {
  if (url.startsWith("x-foxglove-converted-tiff://")) {
    return url.replace("x-foxglove-converted-tiff://", "package://");
  }
  return url;
}

/** A DRACOLoader that loads its decoder from the webpack bundle instead of a CDN. */
export function createBundledDracoLoader(manager?: THREE.LoadingManager): DRACOLoader {
  const dracoLoader = new DRACOLoader(manager);
  // Hack in a replacement function to load assets from the webpack bundle
  (dracoLoader as { _loadLibrary?: (url: string, responseType: string) => unknown })[
    "_loadLibrary"
  ] = async function (url: string, responseType: string) {
    if (url === "draco_wasm_wrapper.js" && responseType === "text") {
      return dracoWasmWrapperJs;
    } else if (url === "draco_decoder.wasm" && responseType === "arraybuffer") {
      return await (await fetch(dracoDecoderWasmUrl)).arrayBuffer();
    } else {
      throw new Error(`DRACOLoader attempt to load non-bundled asset: ${url} as ${responseType}`);
    }
  };
  return dracoLoader;
}
