// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { LineMaterialWithAlphaVertex } from "../../LineMaterialWithAlphaVertex";
import { pickObjectId, pickOutput } from "../../Picker";
import { ColorRGBA, Marker, MarkerType } from "../../ros";

export type LineOptions = {
  worldUnits?: boolean;
};

export function markerHasTransparency(marker: Marker): boolean {
  switch (marker.type) {
    case MarkerType.ARROW:
    case MarkerType.CUBE:
    case MarkerType.SPHERE:
    case MarkerType.CYLINDER:
    case MarkerType.TEXT_VIEW_FACING:
    case MarkerType.MESH_RESOURCE:
      return marker.color.a < 1.0;
    case MarkerType.LINE_STRIP:
    case MarkerType.LINE_LIST:
    case MarkerType.CUBE_LIST:
    case MarkerType.SPHERE_LIST:
    case MarkerType.POINTS:
    case MarkerType.TRIANGLE_LIST:
    default:
      for (const color of marker.colors) {
        if (color.a < 1.0) {
          return true;
        }
      }
      return marker.colors.length >= marker.points.length ? false : marker.color.a < 1.0;
  }
}

export function makeStandardMaterial(color: ColorRGBA): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color.r, color.g, color.b).convertSRGBToLinear(),
    metalness: 0,
    roughness: 1,
    dithering: true,
    opacity: color.a,
    transparent: color.a < 1,
    depthWrite: color.a === 1,
  });
}

export function makeStandardVertexColorMaterial(marker: Marker): THREE.MeshStandardMaterial {
  const transparent = markerHasTransparency(marker);
  return new THREE.MeshStandardMaterial({
    metalness: 0,
    roughness: 1,
    dithering: true,
    vertexColors: true,
    side: THREE.DoubleSide,
    opacity: 1,
    transparent,
    depthWrite: !transparent,
  });
}

export function makeStandardInstancedMaterial(marker: Marker): THREE.MeshStandardMaterial {
  const transparent = markerHasTransparency(marker);
  return new THREE.MeshStandardMaterial({
    metalness: 0,
    roughness: 1,
    dithering: true,
    opacity: 1,
    transparent,
    depthWrite: !transparent,
  });
}

// Transparent lines draw in two passes so overlapping segments don't blend twice: a depth and
// stencil prepass, then a color pass that only draws where the stencil is set and clears it.
// <https://github.com/mrdoob/three.js/issues/23680#issuecomment-1063294691>

export function makeLinePrepassMaterial(
  marker: Marker,
  options: LineOptions,
): LineMaterialWithAlphaVertex {
  const transparent = markerHasTransparency(marker);
  return new LineMaterialWithAlphaVertex({
    worldUnits: options.worldUnits ?? true,
    colorWrite: false,
    transparent,
    depthWrite: !transparent,
    linewidth: marker.scale.x,

    stencilWrite: true,
    stencilRef: 1,
    stencilZPass: THREE.ReplaceStencilOp,
  });
}

export function makeLineMaterial(
  marker: Marker,
  options: LineOptions,
): LineMaterialWithAlphaVertex {
  const transparent = markerHasTransparency(marker);
  return new LineMaterialWithAlphaVertex({
    worldUnits: options.worldUnits ?? true,
    vertexColors: true,
    linewidth: marker.scale.x,
    transparent,
    depthWrite: !transparent,

    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
  });
}

/** Picking material for lines drawn wider than they look, so thin lines are easy to hit */
export function makeLinePickingMaterial(
  lineWidth: number,
  options: LineOptions,
): LineMaterialWithAlphaVertex {
  const material = new LineMaterialWithAlphaVertex({
    worldUnits: options.worldUnits ?? true,
    linewidth: lineWidth,
  });
  material.outputNode = pickOutput(pickObjectId);
  return material;
}
