// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { buttonSettingsFields } from "@lichtblick/suite-base/panels/shared/actionButton";
import type { DocumentedNodes } from "@lichtblick/suite-base/panels/shared/documentedSettings";
import type { Topic } from "@lichtblick/suite-base/players/types";

import type { PublishConfig } from "./types";

export const defaultConfig: PublishConfig = {
  buttonText: "Publish",
  buttonTooltip: "",
  advancedView: true,
  value: "{}",
  publishRate: 1,
};

function datatypeError(schemaNames: readonly string[], datatype?: string) {
  if (!datatype) {
    return "Message schema cannot be empty";
  }
  if (!schemaNames.includes(datatype)) {
    return "Schema name not found";
  }
  return undefined;
}

function topicError(topicName?: string) {
  if (!topicName) {
    return "Topic cannot be empty";
  }
  return undefined;
}

export const buildSettingsTree = (
  config: PublishConfig,
  schemaNames: readonly string[],
  topics: readonly Pick<Topic, "name">[],
): DocumentedNodes => ({
  general: {
    fields: {
      topicName: {
        label: "Topic",
        help: "Topic to publish on; picking an existing topic also sets its schema.",
        input: "autocomplete",
        error: topicError(config.topicName),
        value: config.topicName ?? "",
        items: topics.map((t) => t.name),
      },
      datatype: {
        label: "Message schema",
        help: "Type of the message; changing it fills in an empty template.",
        input: "autocomplete",
        error: datatypeError(schemaNames, config.datatype),
        items: [...schemaNames],
        value: config.datatype ?? "",
      },
      advancedView: {
        label: "Editing mode",
        help: "Shows the message editor; off leaves only the publish button.",
        input: "boolean",
        value: config.advancedView,
      },
      publishRate: {
        label: "Repeat rate (Hz)",
        help: "Rate at which the repeat button publishes.",
        input: "number",
        min: 0.1,
        max: 1000,
        step: 1,
        value: config.publishRate ?? defaultConfig.publishRate,
      },
    },
  },
  button: {
    label: "Button",
    fields: buttonSettingsFields(config),
  },
});
