// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useMemo } from "react";

import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import { ALLOWED_DATATYPES } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import { addTopicsDrop } from "@lichtblick/suite-base/panels/shared/pathDrop";

export type DiagnosticTopicsConfig = { topics?: string[]; topicToRender?: string };

/**
 * Explicit topic selection, migrating the old single `topicToRender`; undefined = all topics.
 * Saved layouts are untrusted: a `topics` that isn't a string array is ignored.
 */
export function getConfiguredTopics(config: DiagnosticTopicsConfig): string[] | undefined {
  const { topics, topicToRender } = config as { topics?: unknown; topicToRender?: unknown };
  if (Array.isArray(topics)) {
    return topics.filter((topic): topic is string => typeof topic === "string");
  }
  return typeof topicToRender === "string" ? [topicToRender] : undefined;
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
    const available = [...new Set(availableKey === "" ? [] : availableKey.split("\n"))];
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
    value === true ? [...new Set([...selected, topic])] : selected.filter((t) => t !== topic);
  return { topics, topicToRender: undefined };
}

/** Drop diagnostics topics from the topic list to show the ones that are turned off */
export function useDiagnosticTopicsDrop(
  { selected }: DiagnosticTopics,
  saveConfig: (patch: { topics: string[]; topicToRender: undefined }) => void,
): void {
  const { setMessagePathDropConfig } = usePanelContext();
  useEffect(() => {
    setMessagePathDropConfig(
      addTopicsDrop(
        (item) =>
          item.rootSchemaName != undefined &&
          ALLOWED_DATATYPES.includes(item.rootSchemaName) &&
          !selected.includes(item.topicName),
        (dropped) => {
          saveConfig({ topics: [...new Set([...selected, ...dropped])], topicToRender: undefined });
        },
      ),
    );
  }, [saveConfig, selected, setMessagePathDropConfig]);
}
