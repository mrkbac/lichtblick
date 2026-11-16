// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import memoizeWeak from "memoize-weak";

import { SettingsTreeAction } from "@lichtblick/suite";
import type {
  DocumentedNode,
  DocumentedNodes,
} from "@lichtblick/suite-base/panels/shared/documentedSettings";
import { moveItem, moveUpDownActions } from "@lichtblick/suite-base/panels/utils";

import { NotificationPermissionState, describeNotificationPermission, hasAlert } from "./alerts";
import { IndicatorConfig, IndicatorRule } from "./types";

function ruleToString(rule: IndicatorRule): string {
  const operator = {
    "=": "=",
    "<": "<",
    "<=": "≤",
    ">": ">",
    ">=": "≥",
  }[rule.operator];
  return `data ${operator} ${rule.rawValue}`;
}

export function settingsActionReducer(
  prevConfig: IndicatorConfig,
  action: SettingsTreeAction,
): IndicatorConfig {
  return produce(prevConfig, (draft) => {
    switch (action.action) {
      case "perform-node-action":
        if (action.payload.path[0] === "rules") {
          if (action.payload.id === "delete-rule") {
            const ruleIndex = +action.payload.path[1]!;
            draft.rules.splice(ruleIndex, 1);
          } else if (
            action.payload.id === "add-rule" ||
            action.payload.id === "add-rule-above" ||
            action.payload.id === "add-rule-below"
          ) {
            let insertIndex = draft.rules.length;
            if (action.payload.id === "add-rule-above" && action.payload.path[1] !== "default") {
              insertIndex = +action.payload.path[1]!;
            } else if (action.payload.id === "add-rule-below") {
              insertIndex = +action.payload.path[1]! + 1;
            }
            draft.rules.splice(insertIndex, 0, {
              operator: "=",
              rawValue: "true",
              color: `#${Math.floor(Math.random() * 0x1000000).toString(16)}`,
              label: "Label",
            });
          } else if (action.payload.id === "move-up" || action.payload.id === "move-down") {
            const ruleIndex = +action.payload.path[1]!;
            moveItem(
              draft.rules,
              ruleIndex,
              action.payload.id === "move-up" ? ruleIndex - 1 : ruleIndex + 1,
            );
          }
        }
        break;
      case "update":
        switch (action.payload.path[0]) {
          case "general":
            _.set(draft, [action.payload.path[1]!], action.payload.value);
            break;
          case "rules":
            if (action.payload.path[1] === "default") {
              _.set(draft, [action.payload.path[2]!], action.payload.value);
            } else {
              const ruleIndex = +action.payload.path[1]!;
              _.set(draft.rules[ruleIndex]!, [action.payload.path[2]!], action.payload.value);
            }
            break;
          default:
            throw new Error(`Unexpected payload.path[0]: ${action.payload.path[0]}`);
        }
        break;
    }
  });
}

const memoizedCreateRuleNode = memoizeWeak(
  (rule: IndicatorRule, i: number, rules: readonly IndicatorRule[]): DocumentedNode => {
    return {
      label: ruleToString(rule),
      actions: [
        ...(hasAlert(rule)
          ? [
              {
                type: "action" as const,
                id: "test-alert",
                label: "Send test alert",
                tooltip: "Plays this rule's alert now.",
              },
            ]
          : []),
        { type: "action", id: "delete-rule", label: "Delete rule", icon: "Delete" },
        ...moveUpDownActions(i, rules.length),
        { type: "action", id: "add-rule-above", label: "Add rule above", icon: "Add" },
        { type: "action", id: "add-rule-below", label: "Add rule below", icon: "Add" },
      ],
      fields: {
        operator: {
          label: "Comparison",
          help: "How the value is compared with Compare with.",
          input: "select",
          value: rule.operator,
          options: [
            { label: "Equal to", value: "=" },
            { label: "Less than", value: "<" },
            { label: "Less than or equal to", value: "<=" },
            { label: "Greater than", value: ">" },
            { label: "Greater than or equal to", value: ">=" },
          ],
        },
        rawValue: {
          label: "Compare with",
          help: "Value to compare against: true/false or a number for boolean and numeric data, text for strings.",
          input: "string",
          value: rule.rawValue,
        },
        color: {
          label: "Color",
          help: "Bulb or background color while this rule matches.",
          input: "rgb",
          value: rule.color,
        },
        label: {
          label: "Label",
          help: "Text shown while this rule matches.",
          input: "string",
          value: rule.label,
        },
        alertSound: {
          label: "Alert sound",
          input: "select",
          value: rule.alertSound ?? "none",
          options: [
            { label: "None", value: "none" },
            { label: "Beep", value: "beep" },
            { label: "Chime", value: "chime" },
            { label: "Alarm", value: "alarm" },
          ],
          help: "Played when this rule starts matching during live data or playback",
        },
        alertNotify: {
          label: "Notify",
          input: "boolean",
          value: rule.alertNotify ?? false,
          help: "Show a browser notification when this rule starts matching",
        },
      },
    };
  },
);

/** Notification permission status and actions, shown while a rule uses notifications. */
export function notificationSettings(
  rules: readonly IndicatorRule[],
  permission: NotificationPermissionState,
): Pick<DocumentedNode, "fields" | "actions"> {
  if (!rules.some((rule) => rule.alertNotify === true)) {
    return {};
  }
  const { label, help, canRequest } = describeNotificationPermission(permission);
  return {
    fields: {
      notificationPermission: {
        label: "Browser notifications",
        input: "string",
        readonly: true,
        value: label,
        help,
        error: permission === "denied" ? help : undefined,
      },
    },
    actions: canRequest
      ? [{ type: "action", id: "request-notification-permission", label: "Request permission" }]
      : [],
  };
}

export function buildSettingsTree(
  config: IndicatorConfig,
  pathParseError: string | undefined,
  error: string | undefined,
  notificationPermission: NotificationPermissionState,
): DocumentedNodes {
  const { path, style, rules, fallbackColor, fallbackLabel } = config;
  const notifications = notificationSettings(rules, notificationPermission);
  return {
    general: {
      error,
      fields: {
        path: {
          label: "Message path",
          help: "The value the rules check: a boolean, number or string, or a message with a data field.",
          input: "messagepath",
          supportsMathModifiers: true,
          value: path,
          error: pathParseError,
        },
        style: {
          label: "Style",
          help: "Bulb draws a colored light; Background colors the whole panel.",
          input: "select",
          value: style,
          options: [
            { label: "Bulb", value: "bulb" },
            { label: "Background", value: "background" },
          ],
        },
      },
    },
    rules: {
      label: "Rules (first matching rule wins)",
      help: "Checked top to bottom; the first rule that matches sets the color and label.",
      ...notifications,
      actions: [
        { type: "action", id: "add-rule", label: "Add rule", icon: "Add" },
        ...(notifications.actions ?? []),
      ],
      children: {
        ...Object.fromEntries(
          rules.map((rule, i) => [i.toString(), memoizedCreateRuleNode(rule, i, rules)]),
        ),
        default: {
          label: "Otherwise",
          fields: {
            fallbackColor: {
              label: "Color",
              input: "rgb",
              value: fallbackColor,
              help: "Color to use when no other rules match",
            },
            fallbackLabel: {
              label: "Label",
              input: "string",
              value: fallbackLabel,
              help: "Label to use when no other rules match",
            },
          },
          actions: [{ type: "action", id: "add-rule-above", label: "Add rule above", icon: "Add" }],
        },
      },
    },
  };
}
