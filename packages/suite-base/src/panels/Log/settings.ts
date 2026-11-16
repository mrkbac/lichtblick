// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TFunction } from "i18next";

import type {
  DocumentedNode,
  DocumentedNodes,
} from "@lichtblick/suite-base/panels/shared/documentedSettings";

import { Config, LogLevel, VisibilityFilter } from "./types";

export const defaultConfig: Config = { searchTerms: [], minLogLevel: 1 };

// Create the log level options nodes once since they don't change per render.
const LOG_LEVEL_OPTIONS = [
  { label: ">= DEBUG", value: LogLevel.DEBUG },
  { label: ">= INFO", value: LogLevel.INFO },
  { label: ">= WARN", value: LogLevel.WARN },
  { label: ">= ERROR", value: LogLevel.ERROR },
  { label: ">= FATAL", value: LogLevel.FATAL },
];

/**
 * Whether a topic is shown. Explicit per-topic settings win; legacy configs with a single
 * `topicToRender` show only that topic; otherwise every log topic is shown.
 */
export function isTopicVisible(
  config: Pick<Config, "topics" | "topicToRender">,
  topic: string,
): boolean {
  const explicit = config.topics?.[topic]?.visible;
  if (explicit != undefined) {
    return explicit;
  }
  return config.topicToRender == undefined || config.topicToRender === topic;
}

function visibilityChildren(
  names: readonly string[],
  filter: VisibilityFilter | ((name: string) => boolean),
): Record<string, DocumentedNode> {
  return Object.fromEntries(
    names.map((name) => [
      name,
      {
        label: name,
        visible: typeof filter === "function" ? filter(name) : (filter[name]?.visible ?? true),
      },
    ]),
  );
}

export function buildSettingsTree(
  config: Config,
  availableTopics: readonly string[],
  availableNames: readonly string[],
  t: TFunction<"log">,
): DocumentedNodes {
  const showHideActions = [
    { id: "show-all", type: "action" as const, label: t("showAll") },
    { id: "hide-all", type: "action" as const, label: t("hideAll") },
  ];
  return {
    general: {
      fields: {
        minLogLevel: {
          input: "select",
          label: t("minLogLevel"),
          help: t("minLogLevelHelp"),
          value: config.minLogLevel,
          options: LOG_LEVEL_OPTIONS,
        },
      },
    },
    topics: {
      enableVisibilityFilter: true,
      label: t("topics"),
      help: t("topicsHelp"),
      error: availableTopics.length === 0 ? t("noLogTopics") : undefined,
      children: visibilityChildren(availableTopics, (topic) => isTopicVisible(config, topic)),
      actions: showHideActions,
    },
    nameFilter: {
      enableVisibilityFilter: true,
      children: visibilityChildren(availableNames, config.nameFilter ?? {}),
      label: t("nameFilter"),
      help: t("nameFilterHelp"),
      actions: showHideActions,
    },
  };
}
