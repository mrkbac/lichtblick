// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { PanelExtensionContext } from "@lichtblick/suite";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

export type TeleopPanelProps = {
  context: PanelExtensionContext;
};

export type TeleopButtonConfig = { field: string; value: number };

export type TeleopConfig = {
  topic: undefined | string;
  messageType: "Twist" | "TwistStamped";
  frameId: string;
  publishRate: number;
  stopOnRelease: boolean;
  mode: "joystick" | "dpad";
  keyboard: boolean;
  gamepad: boolean;
  gamepadDeadzone: number;
  /** Fraction (0-1] applied to every button value */
  speedScale: number;
  upButton: TeleopButtonConfig;
  downButton: TeleopButtonConfig;
  leftButton: TeleopButtonConfig;
  rightButton: TeleopButtonConfig;
};

/** Normalized drive command: x right, y forward, both in [-1, 1] */
export type TeleopVector = { x: number; y: number };

export type Twist = {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
};

export enum DirectionalPadAction {
  UP,
  DOWN,
  LEFT,
  RIGHT,
}

export type DirectionalPadProps = {
  disabled?: boolean;
  /** Current command, used to highlight the matching buttons */
  vector?: TeleopVector;
  onAction?: (action?: DirectionalPadAction) => void;
};

export type JoystickProps = {
  vector: TeleopVector;
  onChange: (vector?: TeleopVector) => void;
};

export type TeleopPanelAdapterProps = {
  config: unknown;
  saveConfig: SaveConfig<unknown>;
};
