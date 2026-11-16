// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { buttonSettingsFields } from "@lichtblick/suite-base/panels/shared/actionButton";
import type { DocumentedNodes } from "@lichtblick/suite-base/panels/shared/documentedSettings";

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

export function buildSettingsTree(config: Config, services: readonly string[]): DocumentedNodes {
  return {
    general: {
      fields: {
        serviceName: {
          label: "Service name",
          help: "Service to call. Picking one with another request type loads its empty template, asking first if you edited the request.",
          input: "autocomplete",
          error: serviceError(config.serviceName),
          value: config.serviceName ?? "",
          items: [...services],
        },
        layout: {
          label: "Layout",
          help: "Stacks the request and response (vertical) or places them side by side (horizontal).",
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
