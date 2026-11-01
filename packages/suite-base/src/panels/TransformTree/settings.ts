// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";
import { produce } from "immer";
import * as _ from "lodash-es";

import { SettingsTreeAction, SettingsTreeNodes } from "@lichtblick/suite";

import { defaultIsStatic } from "./transforms";
import { TransformTreeConfig } from "./types";

export type ResolvedTopic = {
  name: string;
  visible: boolean;
  isStatic: boolean;
  /** False when the topic is configured but not in the current data source. */
  available: boolean;
};

/**
 * Every transform topic in the data source, plus topics configured earlier that are missing now,
 * with their settings applied on top of the defaults (visible, static if named `*tf_static`).
 */
export function resolveTopics(
  config: TransformTreeConfig,
  availableTopics: readonly string[],
): ResolvedTopic[] {
  const available = new Set(availableTopics);
  const names = [...new Set([...availableTopics, ...Object.keys(config.topics ?? {})])].sort();
  return names.map((name) => {
    const topicConfig = config.topics?.[name];
    return {
      name,
      visible: topicConfig?.visible ?? true,
      isStatic: topicConfig?.static ?? defaultIsStatic(name),
      available: available.has(name),
    };
  });
}

export function buildSettingsTree(
  topics: readonly ResolvedTopic[],
  t: TFunction<"transformTree">,
): SettingsTreeNodes {
  return {
    topics: {
      label: t("settings.topics"),
      enableVisibilityFilter: true,
      children: Object.fromEntries(
        topics.map((topic) => [
          topic.name,
          {
            label: topic.name,
            visible: topic.visible,
            error: topic.available ? undefined : t("settings.topicUnavailable"),
            fields: {
              static: {
                input: "boolean",
                label: t("settings.static"),
                help: t("settings.staticHelp"),
                value: topic.isStatic,
              },
            },
          },
        ]),
      ),
    },
  };
}

/** Handles `["topics", <topic>, "visible" | "static"]` updates from the settings tree. */
export function settingsActionReducer(
  config: TransformTreeConfig,
  action: SettingsTreeAction,
): TransformTreeConfig {
  if (action.action !== "update") {
    return config;
  }
  const { path, value } = action.payload;
  if (path[0] !== "topics" || path.length !== 3) {
    return config;
  }
  return produce(config, (draft) => {
    // Topic names contain dots and slashes, so pass the path as an array rather than a string.
    _.set(draft, [...path], value);
  });
}
