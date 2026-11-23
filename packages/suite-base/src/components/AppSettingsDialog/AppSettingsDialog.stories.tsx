// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { StoryObj } from "storybook-react-rsbuild";

import ExtensionMarketplaceContext, {
  ExtensionMarketplace,
} from "@lichtblick/suite-base/context/ExtensionMarketplaceContext";
import { ExtensionInfo, IExtensionLoader } from "@lichtblick/suite-base/index";
import ExtensionCatalogProvider from "@lichtblick/suite-base/providers/ExtensionCatalogProvider/ExtensionCatalogProvider";
import WorkspaceContextProvider from "@lichtblick/suite-base/providers/WorkspaceContextProvider";

import { AppSettingsDialog } from "./AppSettingsDialog";

const installedExtensions: ExtensionInfo[] = Array.from({ length: 9 }, (_, i) => i + 1).map(
  (index) => ({
    id: "publisher.storyextension",
    name: "privatestoryextension",
    qualifiedName: "storyextension",
    displayName: `Private Extension Name ${index + 1}`,
    description: "Private extension sample description",
    publisher: "Private Publisher",
    homepage: "https://github.com/lichtblick-suite",
    license: "MIT",
    version: `1.${index}`,
    keywords: ["storybook", "testing"],
    namespace: index % 2 === 0 ? "local" : "org",
    readme: "Readme for extension",
    changelog: "Changes effectuated on extension",
  }),
);

const marketplaceExtensions: ExtensionInfo[] = [
  {
    id: "publisher.storyextension",
    name: "storyextension",
    qualifiedName: "storyextension",
    displayName: "Extension Name",
    description: "Extension sample description",
    publisher: "Publisher",
    homepage: "https://github.com/lichtblick-suite",
    license: "MIT",
    version: "1.2.10",
    keywords: ["storybook", "testing"],
    readme: "Information about extension",
    changelog: "Some changes on extension",
  },
];

const MockExtensionLoader: IExtensionLoader = {
  type: "browser",
  namespace: "local",
  getExtension: async () => installedExtensions[0],
  getExtensions: async () => installedExtensions,
  loadExtension: async (_id: string) => ({ raw: "" }),
  installExtension: async ({ foxeFileData: _foxeFileData }) => {
    throw new Error("MockExtensionLoader cannot install extensions");
  },
  uninstallExtension: async (_id: string) => undefined,
};

const MockExtensionMarketplace: ExtensionMarketplace = {
  getAvailableExtensions: async () => marketplaceExtensions,
  getMarkdown: async (url: string) => `# Markdown
Mock markdown rendering for URL [${url}](${url}).`,
};

function Wrapper(StoryComponent: React.ComponentType): React.JSX.Element {
  return (
    <WorkspaceContextProvider>
      <ExtensionCatalogProvider loaders={[MockExtensionLoader]}>
        <ExtensionMarketplaceContext.Provider value={MockExtensionMarketplace}>
          <StoryComponent />
        </ExtensionMarketplaceContext.Provider>
      </ExtensionCatalogProvider>
    </WorkspaceContextProvider>
  );
}

export default {
  title: "components/AppSettingsDialog",
  component: AppSettingsDialog,
  parameters: { colorScheme: "light" },
  decorators: [Wrapper],
};

export const Default: StoryObj = {
  render: () => {
    return <AppSettingsDialog open />;
  },
};

export const General: StoryObj = {
  render: () => {
    return <AppSettingsDialog open activeTab="general" />;
  },
};

export const Privacy: StoryObj = {
  render: () => {
    return <AppSettingsDialog open activeTab="privacy" />;
  },
};

export const Extensions: StoryObj = {
  render: () => {
    return <AppSettingsDialog open activeTab="extensions" />;
  },
};

export const Advanced: StoryObj = {
  render: () => {
    return <AppSettingsDialog open activeTab="advanced" />;
  },
};

export const About: StoryObj = {
  render: () => {
    return <AppSettingsDialog open activeTab="about" />;
  },
};
