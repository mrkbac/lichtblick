// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type * as Foxglove from "@foxglove/extension";
import * as _ from "lodash-es";
import React from "react";
import ReactDOM from "react-dom";

import { CameraModelsMap } from "@lichtblick/den/image/types";
import Logger from "@lichtblick/log";
import {
  RegisterMessageConverterArgs,
  ExtensionContext,
  TopicAliasFunction,
  ExtensionPanelRegistration,
  RegisterCameraModelArgs,
} from "@lichtblick/suite";
import { ExtensionSettings } from "@lichtblick/suite-base/components/PanelSettings/types";
import {
  ContributionPoints,
  RegisteredPanel,
} from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { InstalledTopicConverter } from "@lichtblick/suite-base/players/UserScriptPlayer/topicConverters";
import { ExtensionInfo, InstalledDataLoader } from "@lichtblick/suite-base/types/Extensions";
import { InstalledMessageConverter } from "@lichtblick/suite-base/types/messageConverters";
import sendNotification from "@lichtblick/suite-base/util/sendNotification";
import { toError } from "@lichtblick/suite-base/util/toError";

const log = Logger.getLogger(__filename);

export async function buildContributionPoints(
  extension: ExtensionInfo,
  unwrappedExtensionSource: string,
): Promise<ContributionPoints> {
  // registered panels stored by their fully qualified id
  // the fully qualified id is the extension name + panel name
  const panels: Record<string, RegisteredPanel> = {};
  const messageConverters: InstalledMessageConverter[] = [];
  const panelSettings: ExtensionSettings = {};
  const topicAliasFunctions: ContributionPoints["topicAliasFunctions"] = [];
  const topicConverters: InstalledTopicConverter[] = [];
  const cameraModels: CameraModelsMap = new Map();
  const dataLoaders: InstalledDataLoader[] = [];
  const extensionName = extension.displayName || extension.qualifiedName;

  log.debug(`Mounting extension ${extension.qualifiedName}`);

  const module = { exports: {} };
  const require = (name: string) => {
    // The API packages are type-only, but bundlers may still emit a require for them
    // (Foxglove's build marks `@foxglove/extension` as external).
    return {
      react: React,
      "react-dom": ReactDOM,
      "@foxglove/extension": {},
      "@lichtblick/suite": {},
    }[name];
  };

  const extensionMode =
    process.env.NODE_ENV === "production"
      ? "production"
      : process.env.NODE_ENV === "test"
        ? "test"
        : "development";

  // Typed as both APIs so tsc checks that Foxglove-built extensions can call every method,
  // including the experimental data loader registration.
  const ctx: ExtensionContext &
    Foxglove.ExtensionContext &
    Pick<Foxglove.Experimental.ExtensionContext, "registerDataLoader"> = {
    mode: extensionMode,

    registerPanel: (
      registration: ExtensionPanelRegistration | Foxglove.ExtensionPanelRegistration,
    ) => {
      log.debug(`Extension ${extension.qualifiedName} registering panel: ${registration.name}`);

      const panelId = `${extension.qualifiedName}.${registration.name}`;
      if (panels[panelId]) {
        log.warn(`Panel ${panelId} is already registered`);
        return;
      }

      panels[panelId] = {
        extensionId: extension.id,
        extensionName: extension.qualifiedName,
        extensionNamespace: extension.namespace,
        // PanelExtensionAdapter's context also provides the Foxglove-only members.
        registration: registration as ExtensionPanelRegistration,
      };
    },

    registerMessageConverter: (
      args:
        | RegisterMessageConverterArgs<never>
        // Old Foxglove extensions still call the deprecated overload.
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        | Foxglove.LegacyRegisterMessageConverterArgs<never>
        | Foxglove.RegisterMessageConverterArgsSchema<never>
        | Foxglove.RegisterMessageConverterArgsTopic,
    ) => {
      // Foxglove extensions may also register topic converters (`type: "topic"`), which turn
      // input topics into a new output topic. UserScriptPlayer runs them.
      if ("type" in args && args.type === "topic") {
        const converter = args;
        log.debug(
          `Extension ${extension.qualifiedName} registering topic converter to: ${converter.outputTopic}`,
        );
        topicConverters.push({
          extensionId: extension.id,
          extensionNamespace: extension.namespace,
          converter,
        });
        return;
      }
      // Foxglove's schema converters are Lichtblick converters plus `type: "schema"`.
      const messageConverter: RegisterMessageConverterArgs<never> = args;
      // Extensions are untyped JS: without schema names the converter can never match a topic
      for (const key of ["fromSchemaName", "toSchemaName"] as const) {
        const value: unknown = messageConverter[key];
        if (typeof value !== "string" || value === "") {
          throw new Error(`registerMessageConverter: ${key} must be a non-empty string`);
        }
      }

      log.debug(
        `Extension ${extension.qualifiedName} registering message converter from: ${messageConverter.fromSchemaName} to: ${messageConverter.toSchemaName}`,
      );

      messageConverters.push({
        ...messageConverter,
        extensionNamespace: extension.namespace,
        extensionId: extension.id,
      } as InstalledMessageConverter);

      const converterSettings = _.mapValues(messageConverter.panelSettings, (settings) => ({
        [messageConverter.fromSchemaName]: settings,
      }));

      _.merge(panelSettings, converterSettings);
    },

    registerTopicAliases: (aliasFunction: TopicAliasFunction) => {
      topicAliasFunctions.push({
        aliasFunction,
        extensionId: extension.id,
        extensionNamespace: extension.namespace,
      });
    },

    registerCameraModel({ name, modelBuilder }: RegisterCameraModelArgs) {
      log.debug(`Extension ${extension.qualifiedName} registering camera model: ${name}`);

      cameraModels.set(name, {
        extensionId: extension.id,
        extensionNamespace: extension.namespace,
        modelBuilder,
      });
    },

    // Foxglove exposes this on its Experimental.ExtensionContext; same args and WASM interface.
    registerDataLoader(args: Foxglove.Experimental.RegisterDataLoaderArgs) {
      // Untrusted input: Foxglove may add loader types this host does not know
      if ((args.type as string) !== "file") {
        log.warn(`Extension ${extension.qualifiedName}: unsupported data loader type ${args.type}`);
        return;
      }
      log.debug(
        `Extension ${extension.qualifiedName} registering data loader: ${args.supportedFileType}`,
      );
      dataLoaders.push({
        extensionId: extension.id,
        extensionName,
        extensionNamespace: extension.namespace,
        args,
      });
    },
  };

  try {
    // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
    const fn = new Function("module", "exports", "require", unwrappedExtensionSource);

    // load the extension module exports
    fn(module, module.exports, require);

    // Extensions export `activate` directly or as `export default { activate }`, and may return a
    // promise (async initialization) that must settle before the extension counts as loaded.
    type Activate = (extensionContext: ExtensionContext) => unknown;
    const exports = module.exports as {
      activate?: Activate;
      default?: { activate?: Activate };
    };
    const activate = exports.activate ?? exports.default?.activate;
    if (!activate) {
      throw new Error(`Extension ${extension.qualifiedName} does not export an activate function`);
    }
    await activate(ctx);
  } catch (err: unknown) {
    // Registrations made before the error stay installed; the user still needs to know.
    log.error(err);
    sendNotification(
      `Extension "${extensionName}" failed to activate`,
      toError(err),
      "user",
      "error",
    );
  }

  return {
    panels,
    messageConverters,
    topicAliasFunctions,
    topicConverters,
    panelSettings,
    cameraModels,
    dataLoaders,
  };
}
