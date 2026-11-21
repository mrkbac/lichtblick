// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  Discard,
  Fn,
  If,
  Loop,
  Return,
  all,
  atomicLoad,
  atomicMax,
  atomicStore,
  cameraFar,
  cameraNear,
  dot,
  float,
  floatBitsToUint,
  instanceIndex,
  instancedArray,
  int,
  ivec2,
  positionGeometry,
  screenCoordinate,
  max,
  min,
  select,
  sRGBTransferEOTF,
  storage,
  uint,
  uintBitsToFloat,
  uniform,
  uvec4,
  vec3,
  vec4,
  viewZToLogarithmicDepth,
  viewZToOrthographicDepth,
  viewZToPerspectiveDepth,
} from "three/tsl";
import * as THREE from "three/webgpu";

import type { PointSource, RasterPoints } from "./RasterPoints";
import { pickOutput, pickPixel } from "../../Picker";

/** Point sets drawn at once; a set's index lives in the top bits of each pixel's point id */
export const MAX_POINT_SETS = 64;
const SET_SHIFT = 26;
/** Points per set addressable by a pixel's point id */
export const MAX_SET_POINTS = 1 << SET_SHIFT;
/** Largest point footprint radius in device pixels the resolve pass searches */
const MAX_RADIUS = 8;

/** No point here */
const EMPTY = 0;

type SetPasses = {
  version: number;
  screenVersion: number;
  depth: THREE.ComputeNode;
  color: THREE.ComputeNode;
  modelView: THREE.UniformNode<"mat4", THREE.Matrix4>;
  count: THREE.UniformNode<"uint", number>;
  setBits: THREE.UniformNode<"uint", number>;
};

type ScreenBuffers = {
  pixels: number;
  /** Nearest point's key per pixel (atomic) */
  keys: THREE.StorageBufferNode<"uint">;
  /** Nearest point's RGBA8 color per pixel */
  colors: THREE.StorageBufferNode<"uint">;
  /** Nearest point's (set << SET_SHIFT | index) per pixel */
  ids: THREE.StorageBufferNode<"uint">;
  clear: THREE.ComputeNode;
};

type Uint = THREE.Node<"uint">;

/**
 * Draws every {@link RasterPoints} in a scene with compute shaders instead of the rasterizer: a
 * depth pass keeps the nearest point per pixel (atomic max of an inverted view distance), a color
 * pass stores that point's color and id, and a full-screen quad in the scene resolves each pixel to
 * the nearest point whose footprint covers it, writing that point's real depth. So meshes and
 * points occlude each other through the normal depth test, transparent objects blend over points,
 * and picking reads the same buffers. Cost per point is a few loads and one atomic, independent of
 * point size; this is what makes tens of millions of points per frame possible.
 */
export class PointRaster {
  readonly #renderer: THREE.WebGPURenderer;
  readonly #scene: THREE.Scene;
  readonly #logDepth: boolean;
  readonly #quad: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>;
  /** Per set: radius² in device pixels (float bits), color encoding, owning object id */
  readonly #setInfo = new THREE.StorageBufferAttribute(new Uint32Array(MAX_POINT_SETS * 4), 4);
  readonly #projection = uniform(new THREE.Matrix4());
  readonly #width = uniform(1, "uint");
  readonly #height = uniform(1, "uint");
  readonly #radius = uniform(0, "int");
  readonly #isOrthographic = uniform(0, "uint");
  #screen: ScreenBuffers;
  #screenVersion = 0;
  #drawnSets = 0;
  // Per-frame scratch, reused (prepare runs every frame, twice with a selection)
  readonly #size = new THREE.Vector2();
  readonly #infoFloats = new Float32Array(this.#setInfo.array.buffer);
  readonly #drawn: RasterPoints[] = [];
  readonly #passes: SetPasses[] = [];
  /** Camera layers the screen buffers were last rasterized for */
  public preparedLayers = -1;

  public constructor(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    { logDepth }: { logDepth: boolean },
  ) {
    this.#renderer = renderer;
    this.#scene = scene;
    this.#logDepth = logDepth;
    this.#screen = this.#allocateScreen(1);
    this.#quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicNodeMaterial());
    this.#quad.name = "PointRaster:resolve";
    this.#quad.frustumCulled = false;
    this.#quad.layers.enableAll();
    this.#quad.visible = false;
    this.#buildMaterials();
    scene.add(this.#quad);
  }

  public dispose(): void {
    this.#quad.removeFromParent();
    this.#quad.geometry.dispose();
    this.#quad.material.dispose();
    (this.#quad.userData.pickingMaterial as THREE.Material | undefined)?.dispose();
  }

  /** Number of point sets drawn by the last prepare(), for tests and stats */
  public drawnSets(): number {
    return this.#drawnSets;
  }

  /**
   * Rasterizes the visible point sets for `camera` into the screen buffers. Call right before
   * drawing the scene with the same camera.
   */
  public prepare(camera: THREE.Camera): void {
    this.#rasterize(camera, undefined);
    this.preparedLayers = camera.layers.mask;
  }

  /**
   * Rasterizes only the point sets a pick can hit with `camera`: pickable ones (not
   * `userData.picking = false`) outside `hidden`. The depth pass keeps one point per pixel, so
   * sets a pick must see through can't take part at all. Call right before picking; the next
   * prepare() rasterizes for display again.
   */
  public preparePick(camera: THREE.Camera, hidden: ReadonlySet<THREE.Object3D>): void {
    this.#rasterize(camera, hidden);
    this.preparedLayers = -1;
  }

  /** `pickHidden`: rasterize for a pick that skips these objects (see preparePick) */
  #rasterize(camera: THREE.Camera, pickHidden: ReadonlySet<THREE.Object3D> | undefined): void {
    const renderer = this.#renderer;
    const size = renderer.getDrawingBufferSize(this.#size);
    const width = Math.max(1, size.x);
    const height = Math.max(1, size.y);
    if (width * height > this.#screen.pixels) {
      this.#replaceScreen(width * height);
    }
    // WebGPU rejects a binding above the device limit, which would invalidate the whole frame
    const maxBinding =
      (renderer.backend as { device?: GPUDevice | null }).device?.limits
        .maxStorageBufferBindingSize ?? Infinity;
    this.#width.value = width;
    this.#height.value = height;
    this.#projection.value.copy(camera.projectionMatrix);
    this.#isOrthographic.value =
      (camera as Partial<THREE.OrthographicCamera>).isOrthographicCamera === true ? 1 : 0;

    const pixelRatio = renderer.getPixelRatio();
    const info = this.#setInfo.array as Uint32Array;
    const infoFloats = this.#infoFloats;
    const drawn = this.#drawn;
    drawn.length = 0;
    let radius = 0;
    // Every visible point set in the scene; no registration, so nothing can leak
    this.#scene.traverseVisible((object) => {
      if ((object as Partial<RasterPoints>).isRasterPoints !== true) {
        return;
      }
      const points = object as RasterPoints;
      if (
        points.shape() !== "point" ||
        points.drawCount === 0 ||
        (points.capacity() === 0 && !points.source()) ||
        !points.layers.test(camera.layers) ||
        drawn.length >= MAX_POINT_SETS ||
        points.positionAttribute().array.byteLength > maxBinding ||
        (pickHidden != undefined &&
          (points.userData.picking === false || isInside(points, pickHidden)))
      ) {
        return;
      }
      const index = drawn.length;
      const r = Math.max(0.5, (points.pointSize * pixelRatio) / 2);
      radius = Math.max(radius, Math.min(MAX_RADIUS, Math.ceil(r - 0.5)));
      infoFloats[index * 4] = r * r;
      info[index * 4 + 1] = points.encoding === "srgb" ? 1 : 0;
      info[index * 4 + 2] = points.id;
      info[index * 4 + 3] = points.square ? 1 : 0;
      drawn.push(points);
    });
    this.#setInfo.needsUpdate = true;
    this.#radius.value = radius;
    this.#drawnSets = drawn.length;
    this.#quad.visible = drawn.length > 0;
    if (drawn.length === 0) {
      return;
    }

    void renderer.compute(this.#screen.clear, width * height);
    const passes = this.#passes;
    passes.length = 0;
    for (const [index, points] of drawn.entries()) {
      const set = this.#passesFor(points);
      set.setBits.value = index << SET_SHIFT;
      set.count.value = points.drawCount;
      set.modelView.value.multiplyMatrices(camera.matrixWorldInverse, points.matrixWorld);
      passes.push(set);
    }
    for (const [index, set] of passes.entries()) {
      void renderer.compute(set.depth, drawn[index]!.drawCount);
    }
    for (const [index, set] of passes.entries()) {
      void renderer.compute(set.color, drawn[index]!.drawCount);
    }
  }

  /** Grows the screen buffers, freeing the old ones and every set's passes that bind them */
  #replaceScreen(pixels: number): void {
    const old = this.#screen;
    this.#screen = this.#allocateScreen(pixels);
    this.#buildMaterials();
    // All sets, not just visible ones: a hidden set's passes would keep the old buffers alive
    this.#scene.traverse((object) => {
      if ((object as Partial<RasterPoints>).isRasterPoints === true) {
        releaseRasterData(object as RasterPoints);
      }
    });
    old.clear.dispose();
    for (const buffer of [old.keys, old.colors, old.ids]) {
      buffer.value.dispose();
    }
  }

  #allocateScreen(pixels: number): ScreenBuffers {
    this.#screenVersion++;
    const keys = instancedArray(pixels, "uint").toAtomic();
    const active = this.#width.mul(this.#height);
    const clear = Fn(() => {
      // The dispatch is rounded up to whole workgroups
      If(instanceIndex.lessThan(active), () => {
        atomicStore(keys.element(instanceIndex), uint(EMPTY));
      });
    })().computeKernel();
    return {
      pixels,
      keys,
      colors: instancedArray(pixels, "uint"),
      ids: instancedArray(pixels, "uint"),
      clear,
    };
  }

  /** (Re)builds the resolve and picking materials for the current screen buffers */
  #buildMaterials(): void {
    const old = this.#quad.userData.pickingMaterial as THREE.Material | undefined;
    old?.dispose();
    this.#quad.material.dispose();

    const vertexNode = vec4(positionGeometry.xy, 0, 1);
    // Like three's own depth: orthographic views are never logarithmic
    const depthOf = (viewDistance: THREE.Node<"float">) => {
      const viewZ = viewDistance.negate();
      return select(
        this.#isOrthographic.equal(1),
        viewZToOrthographicDepth(viewZ, cameraNear, cameraFar),
        this.#logDepth
          ? viewZToLogarithmicDepth(viewZ, cameraNear, cameraFar)
          : viewZToPerspectiveDepth(viewZ, cameraNear, cameraFar),
      );
    };
    const resolved = this.#resolve(ivec2(screenCoordinate.xy));

    const material = new THREE.MeshBasicNodeMaterial();
    material.vertexNode = vertexNode;
    material.colorNode = resolved.color;
    material.depthNode = depthOf(resolved.viewDistance);
    this.#quad.material = material;

    // Reports the point set and point under the cursor, not the quad. The pick target is 1x1, so
    // its screen coordinate is not the cursor's pixel
    const picked = this.#resolve(ivec2(pickPixel));
    const pick = new THREE.MeshBasicNodeMaterial();
    pick.vertexNode = vertexNode;
    pick.depthNode = depthOf(picked.viewDistance);
    pick.outputNode = pickOutput(picked.objectId, picked.index, picked.viewDistance);
    this.#quad.userData.pickingMaterial = pick;
  }

  #passesFor(points: RasterPoints): SetPasses {
    let passes = points.rasterData as SetPasses | undefined;
    if (passes?.version === points.version() && passes.screenVersion === this.#screenVersion) {
      return passes;
    }
    releaseRasterData(points);
    const modelView = passes?.modelView ?? uniform(new THREE.Matrix4());
    const count = passes?.count ?? uniform(0, "uint");
    const setBits = passes?.setBits ?? uniform(0, "uint");
    const capacity = points.capacity();
    const positions = storage(points.positionAttribute(), "float", capacity * 3).toReadOnly();
    const colors = storage(points.colorAttribute(), "uint", capacity).toReadOnly();
    /** Point `i` in the set's space and its packed RGBA8 color */
    const fetch: PointSource =
      points.source() ??
      ((i: Uint) => {
        const b = i.mul(3);
        return {
          position: vec3(
            float(positions.element(b)),
            float(positions.element(b.add(1))),
            float(positions.element(b.add(2))),
          ),
          color: uint(colors.element(i)),
        };
      });
    const slotAttribute = points.slotAttribute();
    const poseAttribute = points.poseAttribute();
    const slots = slotAttribute
      ? storage(slotAttribute, "uint", slotAttribute.count).toReadOnly()
      : undefined;
    const poses = poseAttribute
      ? storage(poseAttribute, "vec4", poseAttribute.count).toReadOnly()
      : undefined;
    const { keys, colors: pixelColors, ids } = this.#screen;
    const projection = this.#projection;
    const width = this.#width;
    const height = this.#height;

    /** Projects point `i`; calls `body` with its pixel and depth key when it is on screen */
    const project = (body: (pixel: Uint, key: Uint, i: Uint, color: Uint) => void) =>
      Fn(() => {
        const i = instanceIndex;
        If(i.greaterThanEqual(count), () => {
          Return();
        });
        const point = fetch(i);
        const color = point.color.toVar();
        // Screen-door transparency: a stable per-point threshold from a hash of its index
        const alpha = color.shiftRight(24).toVar();
        If(alpha.lessThan(255).and(alpha.lessThanEqual(hash8(i))), () => {
          Return();
        });
        // Skip invalid points (e.g. NaN ranges) explicitly: with fast math, NaN comparisons below
        // can't be relied on to fail. Non-finite floats have all exponent bits set.
        const position = point.position.toVar();
        const exponents = uint(0x7f800000);
        const finite = bitsOf(position.x)
          .bitAnd(exponents)
          .notEqual(exponents)
          .and(bitsOf(position.y).bitAnd(exponents).notEqual(exponents))
          .and(bitsOf(position.z).bitAnd(exponents).notEqual(exponents));
        const valid = point.valid ? finite.and(point.valid) : finite;
        If(valid.not(), () => {
          Return();
        });
        const local = vec4(position, 1).toVar();
        if (slots && poses) {
          const slot = uint(slots.element(i.shiftRight(1)))
            .shiftRight(i.bitAnd(1).mul(16))
            .bitAnd(0xffff)
            .toVar();
          const row0 = vec4(poses.element(slot.mul(3))).toVar();
          If(all(row0.equal(vec4(0))), () => {
            Return();
          });
          local.assign(
            vec4(
              dot(row0, local),
              dot(vec4(poses.element(slot.mul(3).add(1))), local),
              dot(vec4(poses.element(slot.mul(3).add(2))), local),
              1,
            ),
          );
        }
        const view = modelView.mul(local).toVar();
        const distance = view.z.negate().toVar();
        const clip = projection.mul(view).toVar();
        const ndc = clip.xyz.div(clip.w).toVar();
        const inside = distance
          .greaterThan(0)
          .and(ndc.x.abs().lessThanEqual(1))
          .and(ndc.y.abs().lessThanEqual(1))
          .and(ndc.z.greaterThanEqual(0))
          .and(ndc.z.lessThanEqual(1));
        If(inside.not(), () => {
          Return();
        });
        const x = uint(min(ndc.x.mul(0.5).add(0.5).mul(float(width)), float(width).sub(1)));
        const y = uint(min(ndc.y.mul(-0.5).add(0.5).mul(float(height)), float(height).sub(1)));
        const pixel = uint(y.mul(width).add(x)).toVar();
        // Larger key = nearer; float bits of positive distances sort like the distances
        const key = uint(0xffffffff).sub(bitsOf(distance)).toVar();
        body(pixel, key, i, color);
      })();

    const depth = project((pixel, key) => {
      atomicMax(keys.element(pixel), key);
    }).computeKernel();
    const color = project((pixel, key, i, pointColor) => {
      If(uint(atomicLoad(keys.element(pixel))).equal(key), () => {
        pixelColors.element(pixel).assign(pointColor);
        ids.element(pixel).assign(setBits.bitOr(i));
      });
    }).computeKernel();

    passes = {
      version: points.version(),
      screenVersion: this.#screenVersion,
      depth,
      color,
      modelView,
      count,
      setBits,
    };
    points.rasterData = passes;
    return passes;
  }

  /**
   * The nearest point covering `pixel`: searches the largest footprint radius and accepts a
   * candidate only within its own set's radius. Discards when there is none.
   */
  #resolve(pixel: THREE.Node<"ivec2">): {
    color: THREE.Node<"vec4">;
    viewDistance: THREE.Node<"float">;
    objectId: Uint;
    index: Uint;
  } {
    const { keys, ids, colors: pixelColors } = this.#screen;
    const info = storage(this.#setInfo, "uvec4", MAX_POINT_SETS).toReadOnly();
    const width = int(this.#width);
    const height = int(this.#height);
    const radius = this.#radius;
    const result = Fn(() => {
      const best = uint(EMPTY).toVar();
      const bestPixel = uint(0).toVar();
      const center = ivec2(pixel).toVar();
      // One shader for all radii: loop over the largest footprint square
      const range = { start: radius.negate(), end: radius, condition: "<=" };
      Loop(range, range, ({ i: oy, j: ox }) => {
        const x = center.x.add(ox);
        const y = center.y.add(oy);
        If(
          x
            .greaterThanEqual(0)
            .and(x.lessThan(width))
            .and(y.greaterThanEqual(0))
            .and(y.lessThan(height)),
          () => {
            const p = uint(y.mul(width).add(x)).toVar();
            const key = uint(atomicLoad(keys.element(p))).toVar();
            If(key.greaterThan(best), () => {
              const setInfo = uvec4(info.element(uint(ids.element(p)).shiftRight(SET_SHIFT)));
              const r2 = floatOf(setInfo.x);
              // Squares cover their whole footprint, circles the disk inside it
              const reach = max(float(ox).abs(), float(oy).abs());
              const d2 = select(
                setInfo.w.equal(1),
                reach.mul(reach),
                float(ox.mul(ox).add(oy.mul(oy))),
              );
              If(d2.lessThanEqual(r2), () => {
                best.assign(key);
                bestPixel.assign(p);
              });
            });
          },
        );
      });
      Discard(best.equal(EMPTY));
      return uvec4(best, bestPixel, 0, 0);
    })().toVar();
    const id = uint(ids.element(result.y)).toVar();
    const setInfo = uvec4(info.element(id.shiftRight(SET_SHIFT))).toVar();
    const c = uint(pixelColors.element(result.y)).toVar();
    const rgb = vec3(
      float(c.bitAnd(255)),
      float(c.shiftRight(8).bitAnd(255)),
      float(c.shiftRight(16).bitAnd(255)),
    ).div(255);
    return {
      color: vec4(select(setInfo.y.equal(1), sRGBTransferEOTF(rgb), rgb) as THREE.Node<"vec3">, 1),
      viewDistance: floatOf(uint(0xffffffff).sub(result.x)),
      objectId: setInfo.z,
      index: id.bitAnd(MAX_SET_POINTS - 1),
    };
  }
}

/** Frees the raster's passes for `points` (they bind its buffers); they are rebuilt on use */
export function releaseRasterData(points: RasterPoints): void {
  const passes = points.rasterData as SetPasses | undefined;
  passes?.depth.dispose();
  passes?.color.dispose();
  points.rasterData = undefined;
}

function isInside(object: THREE.Object3D, ancestors: ReadonlySet<THREE.Object3D>): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) {
    if (ancestors.has(o)) {
      return true;
    }
  }
  return false;
}

// three's TSL types don't type bitcasts
const bitsOf = (value: THREE.Node<"float">): Uint => floatBitsToUint(value) as unknown as Uint;
const floatOf = (value: Uint): THREE.Node<"float"> =>
  uintBitsToFloat(value) as unknown as THREE.Node<"float">;

/** An 8-bit hash of a point index, for screen-door transparency */
function hash8(i: Uint): Uint {
  const h = i.mul(0x9e3779b1).toVar();
  return h.bitXor(h.shiftRight(15)).mul(0x2c1b3c6d).shiftRight(24);
}
