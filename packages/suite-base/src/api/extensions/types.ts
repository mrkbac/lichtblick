// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { GenericApiEntity } from "@lichtblick/suite-base/api/types";
import { StoredExtension } from "@lichtblick/suite-base/services/IExtensionStorage";
import { Namespace } from "@lichtblick/suite-base/types";
import { ExtensionInfo } from "@lichtblick/suite-base/types/Extensions";

export type ExtensionInfoWorkspace = Pick<StoredExtension, "info" | "workspace">;

type RemoteExtension = Pick<
  ExtensionInfo,
  | "changelog"
  | "description"
  | "displayName"
  | "homepage"
  | "keywords"
  | "license"
  | "name"
  | "publisher"
  | "qualifiedName"
  | "readme"
  | "version"
>;

export interface IExtensionApiResponse extends GenericApiEntity, RemoteExtension {
  extensionId: string;
  fileId: string;
  scope: Namespace;
}

export type CreateOrUpdateResponse = {
  extension: IExtensionApiResponse;
};

export type CreateOrUpdateBody = RemoteExtension & {
  extensionId: string;
  scope: Namespace;
  replace?: boolean;
};
