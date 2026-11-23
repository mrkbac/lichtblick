// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import {
  ExtensionCatalog,
  ExtensionData,
} from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { SingleLoaderInstallResult } from "@lichtblick/suite-base/providers/ExtensionCatalogProvider/types";
import { buildContributionPoints } from "@lichtblick/suite-base/providers/helpers/buildContributionPoints";
import { IExtensionLoader } from "@lichtblick/suite-base/services/extension/IExtensionLoader";
import { Namespace } from "@lichtblick/suite-base/types";
import { ExtensionInfo } from "@lichtblick/suite-base/types/Extensions";
import { toError } from "@lichtblick/suite-base/util/toError";

// Unique key combining id and namespace to allow the same extension to exist
// in multiple scopes simultaneously.
export function extensionUniqueKey(ext: ExtensionInfo): string {
  return `${ext.id}-${ext.namespace}`;
}

export function removeExtensionData({
  id, // deleted extension id
  namespace, // deleted extension namespace
  state,
}: {
  id: string;
  namespace: Namespace;
  state: Pick<
    ExtensionCatalog,
    | "installedExtensions"
    | "installedPanels"
    | "installedMessageConverters"
    | "installedTopicAliasFunctions"
    | "installedTopicConverters"
    | "installedCameraModels"
  >;
}): Pick<
  ExtensionCatalog,
  | "installedExtensions"
  | "installedPanels"
  | "installedMessageConverters"
  | "installedTopicAliasFunctions"
  | "installedTopicConverters"
  | "installedCameraModels"
> {
  const {
    installedExtensions,
    installedPanels,
    installedMessageConverters,
    installedTopicAliasFunctions,
    installedTopicConverters,
    installedCameraModels,
  } = state;

  const remainingExtensions = installedExtensions?.filter(
    (ext) => !(ext.id === id && ext.namespace === namespace),
  );

  const stillInstalledElsewhere = remainingExtensions?.some((ext) => ext.id === id) ?? false;

  return {
    installedExtensions: remainingExtensions,
    installedPanels: stillInstalledElsewhere
      ? installedPanels
      : _.pickBy(installedPanels, ({ extensionId }) => extensionId !== id),
    installedMessageConverters: stillInstalledElsewhere
      ? installedMessageConverters
      : installedMessageConverters?.filter(({ extensionId }) => extensionId !== id),
    installedTopicAliasFunctions: stillInstalledElsewhere
      ? installedTopicAliasFunctions
      : installedTopicAliasFunctions?.filter(({ extensionId }) => extensionId !== id),
    installedTopicConverters: stillInstalledElsewhere
      ? installedTopicConverters
      : installedTopicConverters.filter(({ extensionId }) => extensionId !== id),
    installedCameraModels: stillInstalledElsewhere
      ? installedCameraModels
      : new Map([...installedCameraModels].filter(([, { extensionId }]) => extensionId !== id)),
  };
}
export async function tryInstallSingleLoader(
  loader: IExtensionLoader,
  extension: ExtensionData,
): Promise<SingleLoaderInstallResult> {
  try {
    const info = await loader.installExtension({
      foxeFileData: extension.buffer,
      file: extension.file,
    });
    const { raw } = await loader.loadExtension(info.id);
    const contributionPoints = await buildContributionPoints(info, raw);
    return { loaderType: loader.type, success: true, info, contributionPoints };
  } catch (error) {
    return {
      loaderType: loader.type,
      success: false,
      error: toError(error),
    };
  }
}
