// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import type { ICameraModel } from "@lichtblick/suite";

import type { DecodedDepth, DepthDistanceType } from "./imageRenderModeSettings";
import { computeDepthRays } from "./imageRenderModes";

/**
 * A depth image drawn as a point cloud. Each vertex holds its pixel's ray (computed once per
 * calibration and image size); the vertex shader reads the pixel's depth from a texture and moves
 * the point along the ray, so a new depth image only costs a texture upload.
 */
export class DepthCloud extends THREE.Points<THREE.BufferGeometry, DepthCloudMaterial> {
  #depthTexture: THREE.DataTexture | undefined;
  #depthColorTexture: THREE.DataTexture | undefined;
  #imageColorTexture: THREE.Texture | undefined;
  #useImageColors = false;
  #raysFor: { cameraModel: ICameraModel; width: number; height: number } | undefined;
  /** Color until a color texture exists */
  readonly #white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);

  public constructor(name: string) {
    super(new THREE.BufferGeometry(), new DepthCloudMaterial());
    this.name = name;
    // Points move in the vertex shader, so the bounding sphere of the rays means nothing
    this.frustumCulled = false;
    // ponytail: no picking; add a picking material like LaserScanMaterial if selecting points is needed
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
      texture.minFilter = THREE.LinearFilter;
      texture.colorSpace = THREE.LinearSRGBColorSpace;
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
    this.geometry.dispose();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(rays, 3));
  }

  public updateSettings(settings: {
    pointSize: number;
    distanceType: DepthDistanceType;
    transparent: boolean;
  }): void {
    const { uniforms } = this.material;
    uniforms.pointSize!.value = settings.pointSize;
    uniforms.euclidean!.value = settings.distanceType === "euclidean";
    if (this.material.transparent !== settings.transparent) {
      this.material.transparent = settings.transparent;
      this.material.depthWrite = !settings.transparent;
      this.material.needsUpdate = true;
    }
  }

  public setPixelRatio(pixelRatio: number): void {
    this.material.uniforms.pixelRatio!.value = pixelRatio;
  }

  public override dispose(): void {
    this.#depthTexture?.dispose();
    this.#depthColorTexture?.dispose();
    this.#disposeImageColorTexture();
    this.#white.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  #disposeImageColorTexture(): void {
    closeBitmap(this.#imageColorTexture?.image);
    this.#imageColorTexture?.dispose();
    this.#imageColorTexture = undefined;
  }

  #bindTextures(): void {
    const { uniforms } = this.material;
    const colorTexture = this.#useImageColors ? this.#imageColorTexture : this.#depthColorTexture;
    uniforms.depthMap!.value = this.#depthTexture ?? this.#white;
    uniforms.colorMap!.value = colorTexture ?? this.#white;
    // Camera images are sRGB bytes; depth colors are linear
    uniforms.colorIsSrgb!.value = this.#useImageColors;
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

export class DepthCloudMaterial extends THREE.RawShaderMaterial {
  public constructor() {
    super({
      glslVersion: THREE.GLSL3,
      vertexShader: /* glsl */ `
        precision highp float;
        precision highp int;
        uniform mat4 projectionMatrix, modelViewMatrix;
        uniform highp sampler2D depthMap;
        uniform sampler2D colorMap;
        uniform float pointSize;
        uniform float pixelRatio;
        uniform bool euclidean;
        // The pixel's ray scaled to z = 1; must be named position for three.js to draw anything
        in vec3 position;
        out mediump vec4 vColor;
        void main() {
          ivec2 size = textureSize(depthMap, 0);
          ivec2 pixel = ivec2(gl_VertexID % size.x, gl_VertexID / size.x);
          float depth = texelFetch(depthMap, pixel, 0).r;
          // Rejects 0, negative, NaN and infinite depths
          if (!(depth > 0.0) || isinf(depth)) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            return;
          }
          vec3 point = euclidean ? normalize(position) * depth : position * depth;
          vColor = texture(colorMap, (vec2(pixel) + 0.5) / vec2(size));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
          gl_PointSize = pixelRatio * pointSize;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform bool colorIsSrgb;
        in mediump vec4 vColor;
        out vec4 outColor;
        ${THREE.ShaderChunk.colorspace_pars_fragment /* for sRGBTransferOETF() */}
        void main() {
          outColor = colorIsSrgb ? vColor : sRGBTransferOETF(vColor);
        }
      `,
    });
    this.uniforms = {
      depthMap: { value: null },
      colorMap: { value: null },
      colorIsSrgb: { value: false },
      pointSize: { value: 2 },
      pixelRatio: { value: 1 },
      euclidean: { value: false },
    };
  }
}
