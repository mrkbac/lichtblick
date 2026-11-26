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
import { toError } from "@lichtblick/suite-base/util/toError";

/** Matches what one installed extension contributed: the same id can be installed in several
 * namespaces, and each namespace's copy owns its own contributions. */
export function contributedBy(id: string, namespace: Namespace | undefined) {
  return (entry: { extensionId?: string; extensionNamespace?: string }): boolean =>
    entry.extensionId === id && entry.extensionNamespace === namespace;
}

type ContributionState = Pick<
  ExtensionCatalog,
  | "installedExtensions"
  | "installedPanels"
  | "installedMessageConverters"
  | "installedTopicAliasFunctions"
  | "installedTopicConverters"
  | "installedCameraModels"
  | "installedDataLoaders"
>;

export function removeExtensionData({
  id, // deleted extension id
  namespace, // deleted extension namespace
  state,
}: {
  id: string;
  namespace: Namespace | undefined;
  state: ContributionState;
}): ContributionState {
  const keep = _.negate(contributedBy(id, namespace));
  return {
    installedExtensions: state.installedExtensions?.filter(
      (ext) => !(ext.id === id && ext.namespace === namespace),
    ),
    installedPanels: _.pickBy(state.installedPanels, keep),
    installedMessageConverters: state.installedMessageConverters?.filter(keep),
    installedTopicAliasFunctions: state.installedTopicAliasFunctions?.filter(keep),
    installedTopicConverters: state.installedTopicConverters.filter(keep),
    installedCameraModels: new Map(
      [...state.installedCameraModels].filter(([, model]) => keep(model)),
    ),
    installedDataLoaders: state.installedDataLoaders.filter(keep),
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
