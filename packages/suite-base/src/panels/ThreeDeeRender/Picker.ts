// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  float,
  floatBitsToUint,
  instanceIndex,
  positionView,
  uint,
  uniform,
  uvec4,
  vertexStage,
} from "three/tsl";
import * as THREE from "three/webgpu";

import type { Renderable } from "./Renderable";

export type PickedRenderable = {
  renderable: Renderable;
  instanceIndex?: number;
};

/** One pixel of the picking pass: what is under the cursor */
export type PickResult = {
  /** `Object3D.id` of the drawn object */
  objectId: number;
  /** Instance (or point) index within the object, if it draws instances */
  instanceIndex?: number;
  /** Distance in front of the camera along its view axis (positive) */
  viewDepth: number;
};

/** Written where nothing was drawn */
const NONE = 0xffffffff;

/**
 * Picking material output for an object, used by materials that compute their own pick values
 * (e.g. point rasterization). `instance` defaults to "no instance".
 */
export function pickOutput(
  objectId: THREE.Node<"uint">,
  instance?: THREE.Node<"uint">,
  viewDistance: THREE.Node = float(positionView.z).negate(),
): THREE.Node {
  // three's TSL types don't type bitcasts
  const distanceBits = floatBitsToUint(viewDistance) as unknown as THREE.Node<"uint">;
  return uvec4(objectId, instance ?? uint(NONE), distanceBits, uint(1));
}

/**
 * The cursor's pixel in the full-size canvas during a pick (the picking target itself is 1x1), for
 * materials that look up screen-space buffers
 */
export const pickPixel = uniform(new THREE.Vector2(), "vec2");

/** The object being drawn, as a per-object uniform shared by all picking materials */
export const pickObjectId = uniform(0, "uint").onObjectUpdate(({ object }) => object?.id ?? 0);

/**
 * GPU picking: draws the scene into a 1x1 uint target centered on the cursor, where every object's
 * material is swapped for a picking variant that writes (object id, instance index, view depth).
 * One pass answers object, instance and depth picking.
 *
 * Picking variants are derived from the object's own material (same vertex nodes, so custom
 * transforms, line widths and point sizes pick exactly as drawn); objects can provide their own with
 * `userData.pickingMaterial`, and opt out with `userData.picking = false`.
 */
export class Picker {
  readonly #renderer: THREE.WebGPURenderer;
  readonly #scene: THREE.Scene;
  readonly #target = new THREE.RenderTarget(1, 1, {
    type: THREE.UnsignedIntType,
    format: THREE.RGBAIntegerFormat,
    depthBuffer: true,
  });
  /** Picking variants per source material and instancing, rebuilt when the source changes */
  #pickMaterials = new WeakMap<THREE.Material, Map<boolean, THREE.NodeMaterial>>();
  #projectionBeforePick = new THREE.Matrix4();
  #clearColor = new THREE.Color();

  public constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene) {
    this.#renderer = renderer;
    this.#scene = scene;
  }

  public dispose(): void {
    this.#target.dispose();
  }

  /**
   * What is under canvas pixel (x, y) in CSS pixels, drawn with `camera`. Objects in `hidden` are
   * skipped, so repeated picks can walk through stacked objects.
   */
  public async pick(
    x: number,
    y: number,
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    hidden: ReadonlySet<THREE.Object3D> = new Set(),
  ): Promise<PickResult | undefined> {
    const renderer = this.#renderer;
    const pixelRatio = renderer.getPixelRatio();
    const { width, height } = renderer.domElement;
    const px = Math.floor(x * pixelRatio);
    const py = Math.floor(y * pixelRatio);
    if (px < 0 || py < 0 || px >= width || py >= height) {
      return undefined;
    }

    // Crop the projection to the cursor's pixel. Works for any projection, including custom ones
    // (image mode, map cameras)
    this.#projectionBeforePick.copy(camera.projectionMatrix);
    const crop = new THREE.Matrix4().makeScale(width, height, 1);
    crop.elements[12] = width - 2 * px - 1;
    crop.elements[13] = 2 * py + 1 - height;
    camera.projectionMatrix.premultiply(crop);
    pickPixel.value.set(px, py);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    const previousTarget = renderer.getRenderTarget();
    const previousFunction = renderer.getRenderObjectFunction();
    const previousAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.#clearColor);
    try {
      renderer.setRenderTarget(this.#target);
      // Integer targets clear to these values as-is: all zero, so the 4th channel (1 where an
      // object was drawn) is 0 where nothing was
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.setRenderObjectFunction(
        (object, scene, cam, geometry, material, group, lightsNode, clippingContext) => {
          if (object.userData.picking === false || isHidden(object, hidden)) {
            return;
          }
          const pickMaterial =
            (object.userData.pickingMaterial as THREE.NodeMaterial | undefined) ??
            this.#pickMaterialFor(material, { instanced: isInstanced(object, geometry) });
          renderer.renderObject(
            object,
            scene,
            cam,
            geometry,
            pickMaterial,
            group,
            lightsNode,
            clippingContext,
            "pick",
          );
        },
      );
      renderer.render(this.#scene, camera);
    } finally {
      renderer.setRenderObjectFunction(previousFunction);
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(this.#clearColor, previousAlpha);
      camera.projectionMatrix.copy(this.#projectionBeforePick);
      camera.projectionMatrixInverse.copy(this.#projectionBeforePick).invert();
    }

    const pixel = (await renderer.readRenderTargetPixelsAsync(
      this.#target,
      0,
      0,
      1,
      1,
    )) as Uint32Array;
    return decodePick(pixel);
  }

  #pickMaterialFor(
    material: THREE.Material,
    { instanced }: { instanced: boolean },
  ): THREE.NodeMaterial {
    let variants = this.#pickMaterials.get(material);
    if (!variants) {
      variants = new Map();
      this.#pickMaterials.set(material, variants);
    }
    let pickMaterial = variants.get(instanced);
    if (pickMaterial?.userData.sourceVersion !== material.version) {
      pickMaterial?.dispose();
      pickMaterial = derivePickMaterial(material, { instanced });
      pickMaterial.userData.sourceVersion = material.version;
      variants.set(instanced, pickMaterial);
    }
    return pickMaterial;
  }
}

/** Decodes a picking pass pixel; exported for tests */
export function decodePick(pixel: ArrayLike<number>): PickResult | undefined {
  const objectId = pixel[0]!;
  if (objectId === NONE || pixel[3] !== 1) {
    return undefined;
  }
  const instance = pixel[1]!;
  const bits = new Uint32Array([pixel[2]!]);
  return {
    objectId,
    instanceIndex: instance === NONE ? undefined : instance,
    viewDepth: new Float32Array(bits.buffer)[0]!,
  };
}

function isInstanced(object: THREE.Object3D, geometry: THREE.BufferGeometry): boolean {
  return (
    (object as Partial<THREE.InstancedMesh>).isInstancedMesh === true ||
    (geometry as Partial<THREE.InstancedBufferGeometry>).isInstancedBufferGeometry === true ||
    (object as Partial<THREE.Points>).isPoints === true
  );
}

function isHidden(object: THREE.Object3D, hidden: ReadonlySet<THREE.Object3D>): boolean {
  if (hidden.size === 0) {
    return false;
  }
  for (let o: THREE.Object3D | null = object; o; o = o.parent) {
    if (hidden.has(o)) {
      return true;
    }
  }
  return false;
}

/**
 * A picking variant of `material`: same class and vertex nodes, opaque, writing the pick output.
 * Instanced objects report their instance index.
 */
function derivePickMaterial(
  material: THREE.Material,
  { instanced }: { instanced: boolean },
): THREE.NodeMaterial {
  const source = material as THREE.NodeMaterial;
  const pick = source.isNodeMaterial ? source.clone() : new THREE.MeshBasicNodeMaterial();
  pick.side = material.side;
  pick.depthTest = material.depthTest;
  pick.depthWrite = material.depthWrite;
  pick.transparent = false;
  pick.blending = THREE.NoBlending;
  pick.outputNode = pickOutput(pickObjectId, instanced ? vertexStage(instanceIndex) : undefined);
  return pick;
}
