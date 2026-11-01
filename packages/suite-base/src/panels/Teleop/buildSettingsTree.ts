// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { SettingsTreeNode, SettingsTreeNodes, Topic } from "@lichtblick/suite";
import { geometryMsgOptions } from "@lichtblick/suite-base/panels/Teleop/constants";
import { TeleopConfig } from "@lichtblick/suite-base/panels/Teleop/types";

export function buildSettingsTreeTeleop(
  config: TeleopConfig,
  topics: readonly Topic[],
): SettingsTreeNodes {
  // topics that already carry velocity commands first
  const isTwist = (t: Topic) => /(^|\/)Twist(Stamped)?$/.test(t.schemaName);
  const topicItems = [...topics.filter(isTwist), ...topics.filter((t) => !isTwist(t))].map(
    (t) => t.name,
  );

  const general: SettingsTreeNode = {
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
        ],
      },
      ...(config.messageType === "TwistStamped" && {
        frameId: { label: "Frame ID", input: "string", value: config.frameId },
      }),
      publishRate: {
        label: "Publish rate (Hz)",
        input: "number",
        value: config.publishRate,
        min: 0,
        help: "How often the command is repeated while held",
      },
      stopOnRelease: {
        label: "Stop on release",
        input: "boolean",
        value: config.stopOnRelease,
        help: "Publish a zero command when the control is released",
      },
      mode: {
        label: "Control",
        input: "toggle",
        value: config.mode,
        options: [
          { label: "Joystick", value: "joystick" },
          { label: "D-pad", value: "dpad" },
        ],
      },
      keyboard: {
        label: "Keyboard",
        input: "boolean",
        value: config.keyboard,
        help: "WASD / arrow keys while the panel is focused, Space or Esc to stop",
      },
      gamepad: {
        label: "Gamepad",
        input: "boolean",
        value: config.gamepad,
        help: "Drive with the left stick of a connected gamepad",
      },
      ...(config.gamepad && {
        gamepadDeadzone: {
          label: "Gamepad deadzone",
          input: "number",
          value: config.gamepadDeadzone,
          min: 0,
          max: 0.9,
          step: 0.05,
          precision: 2,
        },
      }),
    },
    children: {
      upButton: {
        label: "Up / forward",
        fields: {
          field: {
            label: "Field",
            input: "select",
            value: config.upButton.field,
            options: geometryMsgOptions,
          },
          value: { label: "Max value", input: "number", value: config.upButton.value },
        },
      },
      downButton: {
        label: "Down / backward",
        fields: {
          field: {
            label: "Field",
            input: "select",
            value: config.downButton.field,
            options: geometryMsgOptions,
          },
          value: { label: "Max value", input: "number", value: config.downButton.value },
        },
      },
      leftButton: {
        label: "Left",
        fields: {
          field: {
            label: "Field",
            input: "select",
            value: config.leftButton.field,
            options: geometryMsgOptions,
          },
          value: { label: "Max value", input: "number", value: config.leftButton.value },
        },
      },
      rightButton: {
        label: "Right",
        fields: {
          field: {
            label: "Field",
            input: "select",
            value: config.rightButton.field,
            options: geometryMsgOptions,
          },
          value: { label: "Max value", input: "number", value: config.rightButton.value },
        },
      },
    },
  };

  return { general };
}
