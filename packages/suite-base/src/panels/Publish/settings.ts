// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo } from "react";

import { Immutable, SettingsTreeAction } from "@lichtblick/suite";
import {
  isEditedMessage,
  sampleMessageJson,
} from "@lichtblick/suite-base/components/MessageEditor/messageJson";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import { replaceDrop } from "@lichtblick/suite-base/panels/shared/pathDrop";
import { Topic } from "@lichtblick/suite-base/players/types";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { buildSettingsTree } from "./settingsTree";
import { PublishConfig } from "./types";

/** Asks the user whether an edited message may be replaced by a new template. */
type ConfirmReplace = (schemaName: string) => Promise<boolean>;

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

  // Drop a topic from the topic list to publish on it, like picking it in the settings
  const { setMessagePathDropConfig } = usePanelContext();
  useEffect(() => {
    setMessagePathDropConfig(
      replaceDrop(
        (item) => item.isTopic,
        (item) => {
          actionHandler({
            action: "update",
            payload: {
              path: ["general", "topicName"],
              input: "autocomplete",
              value: item.topicName,
            },
          });
        },
      ),
    );
  }, [actionHandler, setMessagePathDropConfig]);
}
