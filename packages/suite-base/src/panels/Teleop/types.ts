// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { BuiltinPanelExtensionContext } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import type { STANDARD_BUTTONS } from "@lichtblick/suite-base/panels/Teleop/constants";

export type TeleopPanelProps = {
  context: BuiltinPanelExtensionContext;
};

/** Gamepad buttons by role, independent of the index a browser or ROS driver gives them */
export type ButtonName = (typeof STANDARD_BUTTONS)[number];

/** A gamepad button, or "none" to turn the action off */
export type ButtonSetting = ButtonName | "none";

/**
 * Analog inputs a velocity field can follow, in ROS sign convention: sticks are positive to the
 * left and forward, "triggers" is right trigger minus left trigger.
 */
export type AxisInput = "none" | "leftX" | "leftY" | "rightX" | "rightY" | "triggers";

export type TwistField =
  | "linear-x"
  | "linear-y"
  | "linear-z"
  | "angular-x"
  | "angular-y"
  | "angular-z";

/** Velocity field = max * input * speed; max is undefined while its settings field is cleared */
export type AxisMapping = { input: AxisInput; max: number | undefined };

export type OutputType = "Twist" | "TwistStamped" | "Joy";

export type OnScreenControl = "joystick" | "dual" | "dpad" | "none";

export type TeleopConfig = {
  topic: undefined | string;
  messageType: OutputType;
  frameId: string;
  /** undefined while the settings field is cleared: DEFAULT_PUBLISH_RATE */
  publishRate: number | undefined;
  stopOnRelease: boolean;
  mode: OnScreenControl;
  keyboard: boolean;
  gamepad: boolean;
  /** Gamepad.id to read, "" for the first connected one */
  gamepadId: string;
  /** undefined while the settings field is cleared: DEFAULT_GAMEPAD_DEADZONE */
  gamepadDeadzone: number | undefined;
  /** Fraction (0-1] of each field's max used while turbo is not held */
  speedScale: number;
  mapping: Record<TwistField, AxisMapping>;
  /** Twist only: gamepad must hold this button to drive (deadman) */
  enableButton: ButtonSetting;
  /** Twist only: drive at full max while held */
  turboButton: ButtonSetting;
  /** Twist only: stop and ignore input until every control is released */
  stopButton: ButtonSetting;
  speedUpButton: ButtonSetting;
  speedDownButton: ButtonSetting;
  /** Joy only: report this button as held while any control is active (teleop_twist_joy's enable) */
  joyEnableButton: ButtonSetting;
};

/** Stick deflection in screen terms: x right, y forward, both in [-1, 1] */
export type TeleopVector = { x: number; y: number };

/** Every input source (pointer, keyboard, gamepad) is read into this virtual gamepad */
export type PadState = {
  left: TeleopVector;
  right: TeleopVector;
  /** Analog triggers, 0 released to 1 fully pressed */
  lt: number;
  rt: number;
  buttons: ReadonlySet<ButtonName>;
};

export type Twist = {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
};

export type DirectionalPadProps = {
  /** Current command, used to highlight the matching buttons */
  vector?: TeleopVector;
  onAction?: (vector?: TeleopVector) => void;
};

export type JoystickProps = {
  vector: TeleopVector;
  onChange: (vector?: TeleopVector) => void;
  label?: string;
};
