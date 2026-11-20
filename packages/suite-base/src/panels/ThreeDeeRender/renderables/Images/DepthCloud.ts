// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  float,
  int,
  ivec2,
  normalize,
  select,
  storage,
  textureLoad,
  uint,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

import type { ICameraModel } from "@lichtblick/suite";

import type { DecodedDepth, DepthDistanceType } from "./imageRenderModeSettings";
import { computeDepthRays } from "./imageRenderModes";
import { RasterPoints } from "../pointClouds/RasterPoints";

/**
 * A depth image drawn as a point cloud by the point raster. Each pixel's ray is computed once per
 * calibration and image size; the raster reads the pixel's depth (and color) from textures and moves
 * the point along the ray, so a new depth image only costs a texture upload.
 */
export class DepthCloud extends RasterPoints {
  #depthTexture: THREE.DataTexture | undefined;
  #depthColorTexture: THREE.DataTexture | undefined;
  #imageColorTexture: THREE.Texture | undefined;
  #useImageColors = false;
  #raysFor: { cameraModel: ICameraModel; width: number; height: number } | undefined;
  #rays: THREE.StorageBufferAttribute | undefined;
  /** Color until a color texture exists */
  readonly #white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  /** Textures the source was built with; replacing a texture rebuilds it */
  #sourceTextures: [THREE.Texture, THREE.Texture] | undefined;
  readonly #width = uniform(1, "uint");
  readonly #colorScale = uniform(new THREE.Vector2(1, 1));
  readonly #euclidean = uniform(0, "uint");

  public constructor(name: string) {
    super(name);
    this.userData.picking = false;
    this.#white.needsUpdate = true;
    this.#bindTextures();
  }

  public setDepth({ width, height, depth, colors }: DecodedDepth): void {
    this.#depthTexture = updateDataTexture(
      this.#depthTexture,
      depth,
      width,
      height,
      THREE.RedFormat,
      THREE.FloatType,
    );
    if (colors) {
      this.#depthColorTexture = updateDataTexture(
        this.#depthColorTexture,
        colors,
        width,
        height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      );
    }
    this.#bindTextures();
  }

  /** Colors the points from another image instead of their depth; `undefined` switches back. */
  public setColorImage(image: ImageBitmap | ImageData | undefined): void {
    this.#useImageColors = image != undefined;
    if (image == undefined) {
      this.#bindTextures();
      return;
    }
    const previous = this.#imageColorTexture;
    const sameSize =
      previous != undefined &&
      (previous.image as ImageBitmap | ImageData).width === image.width &&
      (previous.image as ImageBitmap | ImageData).height === image.height &&
      image instanceof ImageBitmap === previous instanceof THREE.CanvasTexture;
    if (sameSize) {
      closeBitmap(previous.image);
      previous.image = image;
      previous.needsUpdate = true;
    } else {
      this.#disposeImageColorTexture();
      const texture =
        image instanceof ImageBitmap
          ? new THREE.CanvasTexture(image)
          : new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat);
      texture.flipY = false;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.NoColorSpace;
      texture.needsUpdate = true;
      this.#imageColorTexture = texture;
    }
    this.#bindTextures();
  }

  /** Recomputes the per-pixel rays when the calibration or the depth image size changes. */
  public updateRays(cameraModel: ICameraModel): void {
    const width = this.#depthTexture?.image.width ?? 0;
    const height = this.#depthTexture?.image.height ?? 0;
    const prev = this.#raysFor;
    if (
      width === 0 ||
      (prev?.cameraModel === cameraModel && prev.width === width && prev.height === height)
    ) {
      return;
    }
    this.#raysFor = { cameraModel, width, height };
    const rays = new Float32Array(width * height * 3);
    computeDepthRays(cameraModel, width, height, rays);
    this.#rays = new THREE.StorageBufferAttribute(rays, 1);
    this.#width.value = width;
    this.drawCount = width * height;
    this.#buildSource();
  }

  public updateSettings(settings: {
    pointSize: number;
    distanceType: DepthDistanceType;
    transparent: boolean;
  }): void {
    this.pointSize = settings.pointSize;
    this.#euclidean.value = settings.distanceType === "euclidean" ? 1 : 0;
  }

  /** Point sizes are scaled by the raster */
  public setPixelRatio(_pixelRatio: number): void {}

  public override dispose(): void {
    this.#depthTexture?.dispose();
    this.#depthColorTexture?.dispose();
    this.#disposeImageColorTexture();
    this.#white.dispose();
    super.dispose();
  }

  /** Point i = pixel (i % width, i / width): its ray times its depth, colored by the color map */
  #buildSource(): void {
    const rays = this.#rays;
    if (!rays) {
      return;
    }
    const depthTexture = this.#depthTexture ?? this.#white;
    const colorTexture =
      (this.#useImageColors ? this.#imageColorTexture : this.#depthColorTexture) ?? this.#white;
    this.#sourceTextures = [depthTexture, colorTexture];
    const rayNode = storage(rays, "float", rays.count).toReadOnly();
    const width = this.#width;
    const colorScale = this.#colorScale;
    const euclidean = this.#euclidean;
    this.setSource((i) => {
      const pixel = ivec2(int(i.mod(width)), int(i.div(width)));
      const b = i.mul(3);
      const ray = vec3(
        float(rayNode.element(b)),
        float(rayNode.element(b.add(1))),
        float(rayNode.element(b.add(2))),
      );
      const depth = float(textureLoad(depthTexture, pixel).x);
      // Invalid depths (0, negative, NaN, infinite) become NaN, which the raster skips
      const valid = depth.greaterThan(0).and(depth.lessThan(float(3.4e38)));
      const direction = select(euclidean.equal(1), normalize(ray), ray);
      const position = select(valid, direction.mul(depth), vec3(float(NaN)));
      // The color image may have another size than the depth image
      const colorPixel = ivec2(vec2(pixel).mul(colorScale));
      const c = textureLoad(colorTexture, colorPixel).mul(255);
      const color = uint(c.x)
        .bitOr(uint(c.y).shiftLeft(8))
        .bitOr(uint(c.z).shiftLeft(16))
        .bitOr(uint(c.w).shiftLeft(24));
      return { position, color };
    });
  }

  #disposeImageColorTexture(): void {
    closeBitmap(this.#imageColorTexture?.image);
    this.#imageColorTexture?.dispose();
    this.#imageColorTexture = undefined;
  }

  #bindTextures(): void {
    const colorTexture = this.#useImageColors ? this.#imageColorTexture : this.#depthColorTexture;
    const depth = this.#depthTexture ?? this.#white;
    const color = colorTexture ?? this.#white;
    if (this.#sourceTextures?.[0] !== depth || this.#sourceTextures[1] !== color) {
      this.#buildSource();
    }
    const depthImage = depth.image as { width: number; height: number };
    const colorImage = color.image as { width: number; height: number };
    this.#colorScale.value.set(
      colorImage.width / depthImage.width,
      colorImage.height / depthImage.height,
    );
    // Image colors are sRGB bytes; depth colors are linear
    this.encoding = this.#useImageColors ? "srgb" : "linear";
    this.visible = this.#depthTexture != undefined;
  }
}

function closeBitmap(image: unknown): void {
  if (image instanceof ImageBitmap) {
    image.close();
  }
}

function updateDataTexture(
  texture: THREE.DataTexture | undefined,
  data: Float32Array | Uint8Array,
  width: number,
  height: number,
  format: THREE.PixelFormat,
  type: THREE.TextureDataType,
): THREE.DataTexture {
  if (texture?.image.width === width && texture.image.height === height) {
    texture.image.data = data;
    texture.needsUpdate = true;
    return texture;
  }
  texture?.dispose();
  const next = new THREE.DataTexture(data, width, height, format, type);
  // Depth is sampled per pixel with texelFetch, colors bilinearly so a differently sized color
  // image lines up
  next.minFilter = next.magFilter =
    type === THREE.FloatType ? THREE.NearestFilter : THREE.LinearFilter;
  next.generateMipmaps = false;
  next.colorSpace = THREE.LinearSRGBColorSpace;
  next.needsUpdate = true;
  return next;
}
