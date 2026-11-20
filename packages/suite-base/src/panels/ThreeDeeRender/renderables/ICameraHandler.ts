// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import * as THREE from "three";

import { SceneExtension } from "@lichtblick/suite-base/panels/ThreeDeeRender/SceneExtension";

import { CameraState } from "../camera";

export interface ICameraHandler extends SceneExtension {
  /**
   * Gets the active camera to use for rendering the scene
   * */
  getActiveCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera;
  /**
   * Sets the camera state
   * @param state - The new camera state
   */
  setCameraState(state: CameraState | undefined): void;
  /**
   * Gets the state of the camera if interface mode supports it, otherwise undefined
   */
  getCameraState(): CameraState | undefined;
  /**
   * Distance from the camera to its orbit target, without allocating a full camera state.
   * Undefined if the interface mode has no orbit camera.
   */
  getCameraDistance(): number | undefined;
  /**
   * Used to update the aspect ratio of the camera when necessary
   * @param width - The width of the render canvas in CSS pixels
   * @param height - The height of the render canvas in CSS pixels
   * @param pixelRatio - The device pixel ratio (device pixels per CSS pixel)
   */
  handleResize(width: number, height: number, pixelRatio: number): void;
}
