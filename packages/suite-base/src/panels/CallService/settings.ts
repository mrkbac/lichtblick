// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useCallback, useEffect } from "react";

import { Immutable, SettingsTreeAction, SettingsTreeNodes } from "@lichtblick/suite";
import {
  isEditedMessage,
  sampleMessageJson,
} from "@lichtblick/suite-base/components/MessageEditor/messageJson";
import { buttonSettingsFields } from "@lichtblick/suite-base/panels/shared/actionButton";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { Config } from "./types";

export const defaultConfig: Config = {
  requestPayload: "{}",
  layout: "vertical",
};

function serviceError(serviceName?: string) {
  if (!serviceName) {
    return "Service cannot be empty";
  }
  return undefined;
}

function buildSettingsTree(config: Config, services: readonly string[]): SettingsTreeNodes {
  return {
    general: {
      fields: {
        serviceName: {
          label: "Service name",
          input: "autocomplete",
          error: serviceError(config.serviceName),
          value: config.serviceName ?? "",
          items: [...services],
        },
        layout: {
          label: "Layout",
          input: "toggle",
          options: [
            { label: "Vertical", value: "vertical" },
            { label: "Horizontal", value: "horizontal" },
          ],
          value: config.layout ?? defaultConfig.layout,
        },
      },
    },
    button: {
      label: "Button",
      fields: buttonSettingsFields(config, `Call service ${config.serviceName ?? ""}`),
    },
  };
}

export function useCallServiceSettings(props: {
  config: Config;
  saveConfig: SaveConfig<Config>;
  services: readonly string[];
  datatypes: Immutable<RosDatatypes>;
  requestSchemaOf: (serviceName: string | undefined) => string | undefined;
  confirmReplace: (schemaName: string) => Promise<boolean>;
}): void {
  const { config, saveConfig, services, datatypes, requestSchemaOf, confirmReplace } = props;
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action !== "update") {
        return;
      }
      const { path, value } = action.payload;
      if (!_.isEqual(path, ["general", "serviceName"])) {
        saveConfig(
          produce<Config>((draft) => {
            _.set(draft, path.slice(1), value);
          }),
        );
        return;
      }

      const serviceName = typeof value === "string" ? value : undefined;
      const oldSchema = requestSchemaOf(config.serviceName);
      const newSchema = requestSchemaOf(serviceName);
      const template =
        newSchema !== oldSchema ? sampleMessageJson(datatypes, newSchema) : undefined;
      const update = ({ replaceRequest }: { replaceRequest: boolean }) => {
        saveConfig(
          replaceRequest && template != undefined
            ? { serviceName, requestPayload: template }
            : { serviceName },
        );
      };
      if (template == undefined || !isEditedMessage(config.requestPayload, datatypes, oldSchema)) {
        update({ replaceRequest: true });
        return;
      }
      // Don't silently throw away an edited request
      void confirmReplace(newSchema!).then((replaceRequest) => {
        update({ replaceRequest });
      });
    },
    [
      config.requestPayload,
      config.serviceName,
      confirmReplace,
      datatypes,
      requestSchemaOf,
      saveConfig,
    ],
  );

  useEffect(() => {
    updatePanelSettingsTree({ actionHandler, nodes: buildSettingsTree(config, services) });
  }, [actionHandler, config, services, updatePanelSettingsTree]);
}
