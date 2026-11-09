// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useState } from "react";

import { useExtensionCatalog } from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { useSharedRootContext } from "@lichtblick/suite-base/context/SharedRootContext";
import { IExtensionLoader } from "@lichtblick/suite-base/services/extension/IExtensionLoader";

export function useDirectoryExtensions(): {
  directoryLoader: IExtensionLoader | undefined;
  directoryError: string | undefined;
  directoryBusy: boolean;
  updateDirectories: (action: "select" | "reload") => Promise<void>;
} {
  const { extensionLoaders } = useSharedRootContext();
  const directoryLoader = extensionLoaders.find((loader) => loader.loadExtensionFromDirectory);
  const refreshAllExtensions = useExtensionCatalog((state) => state.refreshAllExtensions);
  const [directoryError, setDirectoryError] = useState<string | undefined>(() =>
    directoryLoader?.directoryErrors?.join("\n"),
  );
  const [directoryBusy, setDirectoryBusy] = useState(false);
  const updateDirectories = async (action: "select" | "reload") => {
    setDirectoryBusy(true);
    setDirectoryError(undefined);
    try {
      if (action === "select") {
        await directoryLoader?.loadExtensionFromDirectory?.();
      }
      await refreshAllExtensions();
      const errors = directoryLoader?.directoryErrors;
      if (errors != undefined && errors.length > 0) {
        setDirectoryError(errors.join("\n"));
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setDirectoryError(
          error instanceof Error || error instanceof DOMException ? error.message : String(error),
        );
      }
    } finally {
      setDirectoryBusy(false);
    }
  };
  return { directoryLoader, directoryError, directoryBusy, updateDirectories };
}
