// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { produce } from "immer";

import {
  SettingsTreeAction,
  SettingsTreeFields,
  SettingsTreeNodes,
  Topic,
} from "@lichtblick/suite";
import {
  AXIS_LABELS,
  BUTTON_LABELS,
  DEFAULT_TOPICS,
  JOY_BUTTONS,
  STANDARD_BUTTONS,
  TWIST_FIELDS,
} from "@lichtblick/suite-base/panels/Teleop/constants";
import {
  AxisInput,
  ButtonName,
  OutputType,
  TeleopConfig,
  TwistField,
} from "@lichtblick/suite-base/panels/Teleop/types";

const SCHEMA_PATTERN: Record<OutputType, RegExp> = {
  Twist: /(^|\/)Twist(Stamped)?$/,
  TwistStamped: /(^|\/)Twist(Stamped)?$/,
  Joy: /(^|\/)Joy$/,
};

function buttonOptions(buttons: readonly ButtonName[]) {
  return [
    { label: "None", value: "none" },
    ...buttons.map((button) => ({ label: BUTTON_LABELS[button], value: button })),
  ];
}

function buttonField(label: string, value: string, help: string) {
  return {
    label,
    input: "select" as const,
    value,
    options: buttonOptions(STANDARD_BUTTONS),
    help,
  };
}

export function buildSettingsTreeTeleop(
  config: TeleopConfig,
  topics: readonly Topic[],
  gamepadIds: readonly string[] = [],
): SettingsTreeNodes {
  const isJoy = config.messageType === "Joy";
  // topics that already carry this kind of command first
  const matches = (t: Topic) => SCHEMA_PATTERN[config.messageType].test(t.schemaName);
  const topicItems = [...topics.filter(matches), ...topics.filter((t) => !matches(t))].map(
    (t) => t.name,
  );

  const deviceOptions = [
    { label: "First connected", value: "" },
    ...gamepadIds.map((id) => ({ label: id, value: id })),
    // keep a saved device selectable while it is unplugged
    ...(config.gamepadId && !gamepadIds.includes(config.gamepadId)
      ? [{ label: `${config.gamepadId} (not connected)`, value: config.gamepadId }]
      : []),
  ];

  const mappingFields: SettingsTreeFields = {};
  for (const field of TWIST_FIELDS) {
    const { input, max } = config.mapping[field];
    const name = field.replace("-", ".");
    mappingFields[field] = {
      label: name,
      input: "select",
      value: input,
      options: Object.entries(AXIS_LABELS).map(([value, label]) => ({ label, value })),
    };
    if (input !== "none") {
      mappingFields[`${field}-max`] = {
        label: `${name} max`,
        input: "number",
        value: max,
        step: 0.1,
        precision: 2,
        help: `Full deflection publishes this value (${field.startsWith("linear") ? "m/s" : "rad/s"}). Positive is forward, left or counter-clockwise; use a negative value to invert.`,
      };
    }
  }

  return {
    general: {
      label: "General",
      fields: {
        topic: {
          label: "Topic",
          input: "autocomplete",
          value: config.topic,
          items: topicItems,
        },
        messageType: {
          label: "Message type",
          input: "select",
          value: config.messageType,
          options: [
            { label: "Twist", value: "Twist" },
            { label: "TwistStamped", value: "TwistStamped" },
            { label: "Joy (raw gamepad)", value: "Joy" },
          ],
          help: "Joy sends the raw sticks and buttons in the layout of the ROS 2 joy driver, for robots that run teleop_twist_joy or their own mapping",
        },
        ...(config.messageType !== "Twist" && {
          frameId: { label: "Frame ID", input: "string", value: config.frameId },
        }),
        publishRate: {
          label: "Publish rate (Hz)",
          input: "number",
          value: config.publishRate,
          min: 0,
          help: "How often the command is repeated while a control is held",
        },
        stopOnRelease: {
          label: "Stop on release",
          input: "boolean",
          value: config.stopOnRelease,
          help: "Publish a zero command when every control is released",
        },
        ...(isJoy && {
          joyEnableButton: {
            label: "Hold button",
            input: "select",
            value: config.joyEnableButton,
            options: buttonOptions(JOY_BUTTONS),
            help: "Report this button as pressed while any control is active, e.g. the enable button teleop_twist_joy requires",
          },
        }),
      },
    },
    controls: {
      label: "Controls",
      fields: {
        mode: {
          label: "On-screen",
          input: "select",
          value: config.mode,
          options: [
            { label: "Joystick", value: "joystick" },
            { label: "Two joysticks", value: "dual" },
            { label: "D-pad", value: "dpad" },
            { label: "Hidden", value: "none" },
          ],
        },
        keyboard: {
          label: "Keyboard",
          input: "boolean",
          value: config.keyboard,
          help: "While the panel is focused: WASD or arrows move the left stick, Q/E the right stick, Shift is turbo, Space or Esc stops",
        },
      },
    },
    gamepad: {
      label: "Gamepad",
      fields: {
        gamepad: {
          label: "Enabled",
          input: "boolean",
          value: config.gamepad,
          help: "Browsers only report a gamepad after one of its buttons is pressed",
        },
        ...(config.gamepad && {
          gamepadId: {
            label: "Device",
            input: "select",
            value: config.gamepadId,
            options: deviceOptions,
          },
          gamepadDeadzone: {
            label: "Deadzone",
            input: "number",
            value: config.gamepadDeadzone,
            min: 0,
            max: 0.9,
            step: 0.05,
            precision: 2,
          },
          ...(!isJoy && {
            enableButton: buttonField(
              "Enable button",
              config.enableButton,
              "Gamepad sticks only drive while this button is held (deadman switch)",
            ),
            turboButton: buttonField(
              "Turbo button",
              config.turboButton,
              "Drive at full max speed while held",
            ),
            stopButton: buttonField(
              "Stop button",
              config.stopButton,
              "Stop and ignore input until every control is released",
            ),
            speedUpButton: buttonField("Speed up", config.speedUpButton, "Raise speed by 10%"),
            speedDownButton: buttonField(
              "Speed down",
              config.speedDownButton,
              "Lower speed by 10%",
            ),
          }),
        }),
      },
    },
    ...(!isJoy && {
      mapping: { label: "Velocity", fields: mappingFields },
    }),
  };
}

export function applySettingsAction(
  config: TeleopConfig,
  action: SettingsTreeAction,
): TeleopConfig {
  if (action.action !== "update") {
    return config;
  }
  const { path, value } = action.payload;
  const [node, key] = path;
  if (key == undefined) {
    return config;
  }
  return produce(config, (draft) => {
    if (node === "mapping") {
      const field = key.replace(/-max$/, "") as TwistField;
      if (key.endsWith("-max")) {
        draft.mapping[field].max = value as number;
      } else {
        draft.mapping[field].input = value as AxisInput;
      }
      return;
    }
    if (key === "topic") {
      // "" (not undefined) so a cleared topic survives the layout's JSON round trip
      draft.topic = (value as string | undefined) ?? "";
      return;
    }
    if (key === "messageType") {
      const next = value as OutputType;
      // follow the type with the default topic unless the user picked their own
      if (draft.topic === DEFAULT_TOPICS[draft.messageType] || !draft.topic) {
        draft.topic = DEFAULT_TOPICS[next];
      }
      draft.messageType = next;
      return;
    }
    (draft as Record<string, unknown>)[key] = value;
  });
}
