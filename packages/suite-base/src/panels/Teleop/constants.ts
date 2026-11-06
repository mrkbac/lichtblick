// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  AxisInput,
  ButtonName,
  OutputType,
  TeleopConfig,
  TwistField,
} from "@lichtblick/suite-base/panels/Teleop/types";

export const svgPathsEnabled = {
  up: "M162.707,78.945c-20.74,-14.771 -48.795,-14.771 -69.535,-0l-42.723,-42.723c44.594,-37.791 110.372,-37.794 154.981,-0l-42.723,42.723Z",
  down: "M93.172,176.764c20.74,14.771 48.795,14.771 69.535,0l42.723,42.723c-44.594,37.791 -110.372,37.794 -154.981,0l42.723,-42.723Z",
  left: "M36.307,205.345c-37.793,-44.609 -37.791,-110.387 -0,-154.981l42.723,42.723c-14.771,20.74 -14.771,48.795 -0,69.535l-42.723,42.723Z",
  right:
    "M219.572,50.364c37.794,44.609 37.791,110.387 0.001,154.981l-42.724,-42.723c14.771,-20.74 14.771,-48.795 0,-69.535l42.723,-42.723Z",
};

export const svgPathsDisabled = {
  up: "M128,30.364l20,20l-40,-0l20,-20Z",
  down: "M128,225.345l-20,-20l40,0l-20,20Z",
  left: "M30.449,127.854l20,-20l0,40l-20,-20Z",
  right: "M225.43,127.854l-20,20l0,-40l20,20Z",
};

export const TWIST_FIELDS: readonly TwistField[] = [
  "linear-x",
  "linear-y",
  "linear-z",
  "angular-x",
  "angular-y",
  "angular-z",
];

export const BUTTON_LABELS: Record<ButtonName, string> = {
  a: "A / Cross",
  b: "B / Circle",
  x: "X / Square",
  y: "Y / Triangle",
  lb: "LB / L1",
  rb: "RB / R1",
  lt: "LT / L2",
  rt: "RT / R2",
  back: "Back / Select",
  start: "Start",
  ls: "Left stick click",
  rs: "Right stick click",
  up: "D-pad up",
  down: "D-pad down",
  left: "D-pad left",
  right: "D-pad right",
  guide: "Home / Guide",
};

/** Button order of the W3C "standard" gamepad mapping (`Gamepad.buttons`) */
export const STANDARD_BUTTONS: readonly ButtonName[] = [
  "a",
  "b",
  "x",
  "y",
  "lb",
  "rb",
  "lt",
  "rt",
  "back",
  "start",
  "ls",
  "rs",
  "up",
  "down",
  "left",
  "right",
  "guide",
];

/**
 * `Joy.buttons` order of the ROS 2 `joy` package (game_controller_node, SDL game controller
 * order), so configs written for a real gamepad (e.g. teleop_twist_joy) work unchanged. Triggers
 * are axes there, not buttons.
 */
export const JOY_BUTTONS: readonly ButtonName[] = [
  "a",
  "b",
  "x",
  "y",
  "back",
  "guide",
  "start",
  "ls",
  "rs",
  "lb",
  "rb",
  "up",
  "down",
  "left",
  "right",
];
/** SDL_CONTROLLER_BUTTON_MAX: the driver also reports misc, paddle and touchpad buttons */
export const JOY_BUTTON_COUNT = 21;

export const AXIS_LABELS: Record<AxisInput, string> = {
  none: "Off",
  leftY: "Left stick ↕",
  leftX: "Left stick ↔",
  rightY: "Right stick ↕",
  rightX: "Right stick ↔",
  triggers: "Triggers (RT − LT)",
};

export const DEFAULT_TOPICS: Record<OutputType, string> = {
  Twist: "/cmd_vel",
  TwistStamped: "/cmd_vel",
  Joy: "/joy",
};

export const DEFAULT_CONFIG: TeleopConfig = {
  topic: DEFAULT_TOPICS.Twist,
  messageType: "Twist",
  frameId: "",
  publishRate: 20,
  stopOnRelease: true,
  mode: "joystick",
  keyboard: true,
  gamepad: true,
  gamepadId: "",
  gamepadDeadzone: 0.1,
  speedScale: 0.5,
  mapping: {
    "linear-x": { input: "leftY", max: 1 },
    "linear-y": { input: "none", max: 1 },
    "linear-z": { input: "none", max: 1 },
    "angular-x": { input: "none", max: 1 },
    "angular-y": { input: "none", max: 1 },
    "angular-z": { input: "leftX", max: 1.5 },
  },
  enableButton: "none",
  turboButton: "rb",
  stopButton: "b",
  speedUpButton: "up",
  speedDownButton: "down",
  joyEnableButton: "none",
};
