// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";
import * as _ from "lodash-es";
import { useMemo } from "react";

import { SettingsTreeNode } from "@lichtblick/suite";
import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import { ALLOWED_DATATYPES } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";

export type DiagnosticTopicsConfig = { topics?: string[]; topicToRender?: string };

/** Explicit topic selection, migrating the old single `topicToRender`; undefined = all topics. */
export function getConfiguredTopics(config: DiagnosticTopicsConfig): string[] | undefined {
  return config.topics ?? (config.topicToRender != undefined ? [config.topicToRender] : undefined);
}

export type DiagnosticTopics = {
  /** All DiagnosticArray topics in the data source. */
  available: string[];
  /** Topics the user wants (may include ones missing from the data source). */
  selected: string[];
  /** Topics to subscribe to: selected and available. Stable identity while unchanged. */
  subscribed: readonly string[];
};

export function useDiagnosticTopics(config: DiagnosticTopicsConfig): DiagnosticTopics {
  const { topics } = useDataSourceInfo();
  const configured = getConfiguredTopics(config);

  const availableKey = topics
    .filter(({ schemaName }) => schemaName != undefined && ALLOWED_DATATYPES.includes(schemaName))
    .map(({ name }) => name)
    .join("\n");
  const configuredKey = configured?.join("\n");

  return useMemo(() => {
    const available = _.uniq(availableKey === "" ? [] : availableKey.split("\n"));
    const selected =
      configuredKey == undefined
        ? available
        : configuredKey === ""
          ? []
          : configuredKey.split("\n");
    return {
      available,
      selected,
      subscribed: selected.filter((topic) => available.includes(topic)),
    };
  }, [availableKey, configuredKey]);
}

/** Settings node listing every diagnostics topic with a visibility toggle. */
export function buildTopicsSettingsNode(
  { available, selected }: DiagnosticTopics,
  t: TFunction<"diagnostics">,
): SettingsTreeNode {
  const children: Record<string, SettingsTreeNode> = {};
  for (const topic of _.uniq([...available, ...selected])) {
    children[topic] = {
      label: topic,
      visible: selected.includes(topic),
      error: available.includes(topic) ? undefined : t("topicNotAvailable"),
    };
  }
  return {
    label: t("topics"),
    error: available.length === 0 ? t("noTopics") : undefined,
    children,
  };
}

/**
 * Handles a toggle from {@link buildTopicsSettingsNode}; returns the config patch, or undefined if
 * `path` isn't a topic toggle.
 */
export function handleTopicToggle(
  path: readonly string[],
  value: unknown,
  { selected }: DiagnosticTopics,
): { topics: string[]; topicToRender: undefined } | undefined {
  if (path[0] !== "topics" || path[2] !== "visible" || path[1] == undefined) {
    return undefined;
  }
  const topic = path[1];
  const topics =
    value === true ? _.uniq([...selected, topic]) : selected.filter((t) => t !== topic);
  return { topics, topicToRender: undefined };
}
