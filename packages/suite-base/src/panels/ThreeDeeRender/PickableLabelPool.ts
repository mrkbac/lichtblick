// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { type Label, type LabelNodeMaterial, LabelPool } from "@foxglove/three-text/webgpu";

import { pickObjectId, pickOutput } from "./Picker";

/**
 * LabelPool whose labels work with WebGPURenderer and the Picker:
 * - Labels keep their own picking material (it has the label's vertex transform), but write the
 *   Picker's output with the object only, not the character instance.
 * - A label's mesh is an InstancedMesh with a 1-matrix `instanceMatrix` but one instance per
 *   character. WebGPURenderer binds `instanceMatrix` for every InstancedMesh, so a text longer than
 *   one character fails validation. Its geometry is an InstancedBufferGeometry that already carries
 *   the instance count, so the mesh draws correctly as a plain mesh.
 */
export class PickableLabelPool extends LabelPool {
  protected override createLabel(): Label {
    const label = super.createLabel();
    // ponytail: works around the library's InstancedMesh; drop once three-text draws a plain Mesh
    Object.assign(label.mesh, { isInstancedMesh: false });
    const picking = label.pickingMaterial as LabelNodeMaterial;
    picking.fragmentNode = null;
    picking.outputNode = pickOutput(pickObjectId);
    return label;
  }
}
