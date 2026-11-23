// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import { TopicAliasFunction, Immutable as Im } from "@lichtblick/suite";
import { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";
import { PlayerAlert, Topic } from "@lichtblick/suite-base/players/types";

import { AliasingStateProcessor, TopicAliasMap } from "./AliasingStateProcessor";

export type TopicAliasFunctions = Array<{ extensionId: string; aliasFunction: TopicAliasFunction }>;

export type StateFactoryInput = {
  aliasFunctions: TopicAliasFunctions;
  topics: undefined | Topic[];
  variables: GlobalVariables;
};

/**
 * StateProcessorFactory builds an AliasingStateProcessor from a set of inputs, or none when
 * nothing is aliased.
 *
 * Its purpose is to manage idempotency and memoization of the input and output to only build a new
 * processor when a set of alias function outputs results in a semantically different output.
 */
export class StateProcessorFactory {
  #aliases: TopicAliasMap = new Map();
  #stateProcessor: AliasingStateProcessor | undefined;

  /**
   * Build a state processor instance from the inputs.
   *
   * Returns a StateProcessor instance from the inputs and alias functions. This builder keeps
   * track of inputs and alias function outputs and will only create a new state processor if the
   * output values change. If the output values are unchanged, the existing state processor
   * instance is returned.
   */
  public buildStateProcessor(input: Im<StateFactoryInput>): AliasingStateProcessor | undefined {
    const mappings = input.aliasFunctions.map((mapper) => ({
      extensionId: mapper.extensionId,
      aliases: mapper.aliasFunction({
        topics: input.topics ?? [],
        globalVariables: input.variables,
      }),
    }));

    const anyMappings = mappings.some((map) => [...map.aliases].length > 0);
    if (!anyMappings) {
      this.#aliases = new Map();
      return (this.#stateProcessor = undefined);
    }

    const { aliasMap, alerts } = mergeAliases(mappings, input);

    // When the output of aliasing is the same list of topics, then we can keep our existing state
    // processor. This keep the state processor instance unchanged and preserves memoizations.
    if (_.isEqual(aliasMap, this.#aliases)) {
      return this.#stateProcessor;
    }

    this.#aliases = aliasMap;
    return (this.#stateProcessor = new AliasingStateProcessor(aliasMap, alerts));
  }
}

// Merges multiple aliases into a single unified alias map. Note that a single topic name
// can alias to more than one renamed topic if multiple extensions provide an alias for it.
// Also returns any alerts caused by disallowed aliases.
function mergeAliases(
  maps: Im<{ extensionId: string; aliases: ReturnType<TopicAliasFunction> }[]>,
  inputs: Im<StateFactoryInput>,
): {
  aliasMap: TopicAliasMap;
  alerts: undefined | PlayerAlert[];
} {
  const inverseMapping = new Map<string, string>();
  const alerts: PlayerAlert[] = [];
  const merged: TopicAliasMap = new Map();
  const topics = inputs.topics ?? [];
  for (const { extensionId, aliases } of maps) {
    for (const { name, sourceTopicName } of aliases) {
      const existingMapping = inverseMapping.get(name);
      if (topics.some((topic) => topic.name === name)) {
        alerts.push({
          severity: "error",
          message: `Disallowed topic alias`,
          tip: `Extension ${extensionId} aliased topic ${name} is already present in the data source.`,
        });
      } else if (existingMapping != undefined && existingMapping !== sourceTopicName) {
        alerts.push({
          severity: "error",
          message: `Disallowed topic alias`,
          tip: `Extension ${extensionId} requested duplicate alias from topic ${sourceTopicName} to topic ${name}.`,
        });
      } else {
        inverseMapping.set(name, sourceTopicName);
        const mergedValues = [...new Set(merged.get(sourceTopicName) ?? [])].concat(name);
        merged.set(sourceTopicName, mergedValues);
      }
    }
  }
  return { aliasMap: merged, alerts: alerts.length > 0 ? alerts : undefined };
}
