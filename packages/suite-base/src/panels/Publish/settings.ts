// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo } from "react";

import { Immutable, SettingsTreeAction, SettingsTreeNodes } from "@lichtblick/suite";
import {
  isEditedMessage,
  sampleMessageJson,
} from "@lichtblick/suite-base/components/MessageEditor/messageJson";
import { buttonSettingsFields } from "@lichtblick/suite-base/panels/shared/actionButton";
import { Topic } from "@lichtblick/suite-base/players/types";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { PublishConfig } from "./types";

export const defaultConfig: PublishConfig = {
  buttonText: "Publish",
  buttonTooltip: "",
  advancedView: true,
  value: "{}",
  publishRate: 1,
};

/** Asks the user whether an edited message may be replaced by a new template. */
type ConfirmReplace = (schemaName: string) => Promise<boolean>;

function datatypeError(schemaNames: string[], datatype?: string) {
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

const buildSettingsTree = (
  config: PublishConfig,
  schemaNames: string[],
  topics: readonly Topic[],
): SettingsTreeNodes => ({
  general: {
    fields: {
      topicName: {
        label: "Topic",
        input: "autocomplete",
        error: topicError(config.topicName),
        value: config.topicName ?? "",
        items: topics.map((t) => t.name),
      },
      datatype: {
        label: "Message schema",
        input: "autocomplete",
        error: datatypeError(schemaNames, config.datatype),
        items: schemaNames,
        value: config.datatype ?? "",
      },
      advancedView: {
        label: "Editing mode",
        input: "boolean",
        value: config.advancedView,
      },
      publishRate: {
        label: "Repeat rate (Hz)",
        help: "Rate used by the repeat button",
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

export function usePublishPanelSettings(
  config: PublishConfig,
  saveConfig: SaveConfig<PublishConfig>,
  topics: readonly Topic[],
  datatypes: Immutable<RosDatatypes>,
  confirmReplace: ConfirmReplace,
): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const schemaNames = useMemo(() => Array.from(datatypes.keys()).sort(), [datatypes]);

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action !== "update") {
        return;
      }
      const { path, value, input } = action.payload;
      const isTopic = input === "autocomplete" && _.isEqual(path, ["general", "topicName"]);
      const isSchema = input === "autocomplete" && _.isEqual(path, ["general", "datatype"]);
      if (!isTopic && !isSchema) {
        saveConfig(
          produce<PublishConfig>((draft) => {
            _.set(draft, path.slice(1), value);
          }),
        );
        return;
      }

      const newValue = typeof value === "string" ? value : undefined;
      const schemaName = isTopic
        ? (topics.find((t) => t.name === newValue)?.schemaName ?? config.datatype)
        : newValue;
      const template =
        schemaName !== config.datatype ? sampleMessageJson(datatypes, schemaName) : undefined;
      const update = ({ replaceMessage }: { replaceMessage: boolean }) => {
        saveConfig(
          produce<PublishConfig>((draft) => {
            if (isTopic) {
              draft.topicName = newValue;
            }
            draft.datatype = schemaName;
            if (replaceMessage && template != undefined) {
              draft.value = template;
            }
          }),
        );
      };

      if (template == undefined || !isEditedMessage(config.value, datatypes, config.datatype)) {
        update({ replaceMessage: true });
        return;
      }
      // Don't silently throw away an edited message
      void confirmReplace(schemaName!).then((replaceMessage) => {
        update({ replaceMessage });
      });
    },
    [config.datatype, config.value, confirmReplace, datatypes, saveConfig, topics],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildSettingsTree(config, schemaNames, topics),
    });
  }, [actionHandler, config, schemaNames, topics, updatePanelSettingsTree]);
}
