// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

export type CameraState = {
  distance: number;
  perspective: boolean;
  phi: number;
  target: readonly [number, number, number];
  targetOffset: readonly [number, number, number];
  targetOrientation: readonly [number, number, number, number];
  thetaOffset: number;
  fovy: number;
  near: number;
  far: number;
};

export { DEFAULT_CAMERA_STATE } from "./defaults";

export type OrbitControlsConfig = {
  screenSpacePanning: boolean;
  mouseButtons: {
    LEFT: number;
    RIGHT: number;
  };
  touches: {
    ONE: number;
    TWO: number;
  };
  keys: {
    LEFT: string;
    RIGHT: string;
    UP: string;
    BOTTOM: string;
  };
};

export const DEFAULT_ORBIT_CONTROLS_CONFIG: OrbitControlsConfig = {
  screenSpacePanning: false,
  mouseButtons: {
    LEFT: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  },
  touches: {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  },
  keys: { LEFT: "KeyA", RIGHT: "KeyD", UP: "KeyW", BOTTOM: "KeyS" },
};

/**
 * True for two-finger trackpad scrolling; false for a mouse wheel and for pinching, which browsers
 * report as Ctrl+wheel. Chrome and Safari report `wheelDeltaY` as exactly -3 × `deltaY` only for
 * trackpads, and a mouse wheel scrolls sideways only with Shift (or a tilt wheel).
 * ponytail: heuristic; smooth-scrolling mice (e.g. Magic Mouse) count as trackpads and pan, and
 * Firefox's vertical-only trackpad scrolls still zoom. Add a setting if that bites.
 */
export function isTrackpadScroll(
  event: Pick<WheelEvent, "ctrlKey" | "shiftKey" | "deltaMode" | "deltaX" | "deltaY">,
): boolean {
  if (event.ctrlKey || event.deltaMode !== 0 /* DOM_DELTA_PIXEL */) {
    return false;
  }
  if (event.deltaX !== 0 && !event.shiftKey) {
    return true;
  }
  const { wheelDeltaY } = event as typeof event & { wheelDeltaY?: number };
  return wheelDeltaY != undefined && event.deltaY !== 0 && wheelDeltaY === -3 * event.deltaY;
}
