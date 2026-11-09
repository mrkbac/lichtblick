// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Alert, AlertTitle, Button, Typography } from "@mui/material";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ExtensionDetails } from "@lichtblick/suite-base/components/ExtensionDetails";
import useExtensionSettings from "@lichtblick/suite-base/components/ExtensionsSettings/hooks/useExtensionSettings";
import { FocusedExtension } from "@lichtblick/suite-base/components/ExtensionsSettings/types";
import SearchBar from "@lichtblick/suite-base/components/SearchBar/SearchBar";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useExtensionCatalog } from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { useSharedRootContext } from "@lichtblick/suite-base/context/SharedRootContext";

import ExtensionList from "./components/ExtensionList/ExtensionList";
import { useStyles } from "./index.style";

export default function ExtensionsSettings(): React.ReactElement {
  const { t } = useTranslation("extensionsSettings");
  const { classes } = useStyles();
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
        setDirectoryError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setDirectoryBusy(false);
    }
  };

  const [focusedExtension, setFocusedExtension] = useState<FocusedExtension | undefined>();

  const {
    setUndebouncedFilterText,
    marketplaceEntries,
    refreshMarketplaceEntries,
    undebouncedFilterText,
    namespacedData,
    groupedMarketplaceData,
    debouncedFilterText,
  } = useExtensionSettings();

  const onClear = () => {
    setUndebouncedFilterText("");
  };

  const selectFocusedExtension = useCallback(
    (newFocusedExtension: FocusedExtension) => {
      setFocusedExtension(newFocusedExtension);
    },
    [setFocusedExtension],
  );

  if (focusedExtension != undefined) {
    return (
      <ExtensionDetails
        installed={focusedExtension.installed}
        extension={focusedExtension.entry}
        onClose={() => {
          setFocusedExtension(undefined);
        }}
      />
    );
  }

  return (
    <Stack gap={1}>
      {directoryLoader && (
        <Stack gap={1} paddingX={2}>
          <Stack direction="row" gap={1}>
            <Button
              disabled={directoryBusy}
              onClick={async () => {
                await updateDirectories("select");
              }}
            >
              {t("loadExtensionFolder")}
            </Button>
            <Button
              disabled={directoryBusy}
              onClick={async () => {
                await updateDirectories("reload");
              }}
            >
              {t("reloadDiskExtensions")}
            </Button>
          </Stack>
          <Typography variant="body2" color="textSecondary">
            {t("extensionFolderHelp")}
          </Typography>
          {directoryError && <Alert severity="error">{directoryError}</Alert>}
        </Stack>
      )}
      {marketplaceEntries.error && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={async () => await refreshMarketplaceEntries()}>
              Retry
            </Button>
          }
        >
          <AlertTitle>{t("failedToRetrieveMarketplaceExtensions")}</AlertTitle>
          {t("checkInternetConnection")}
        </Alert>
      )}
      <div className={classes.searchBarDiv}>
        <SearchBar
          data-testid="SearchBarComponent"
          className={classes.searchBarPadding}
          id="extension-filter"
          placeholder={t("searchExtensions")}
          variant="outlined"
          onChange={(event) => {
            setUndebouncedFilterText(event.target.value);
          }}
          value={undebouncedFilterText}
          showClearIcon={!!debouncedFilterText}
          onClear={onClear}
        />
      </div>
      {namespacedData.map(({ namespace, entries }) => (
        <ExtensionList
          key={namespace}
          filterText={debouncedFilterText}
          entries={entries}
          namespace={namespace}
          selectExtension={selectFocusedExtension}
        />
      ))}
      {groupedMarketplaceData.map(({ namespace, entries }) => (
        <ExtensionList
          key={namespace}
          filterText={debouncedFilterText}
          entries={entries}
          namespace={namespace}
          selectExtension={selectFocusedExtension}
        />
      ))}
    </Stack>
  );
}
