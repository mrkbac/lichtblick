// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Alert, Button, Dialog } from "@mui/material";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useMountedState } from "@lichtblick/hooks";
import { APP_BAR_HEIGHT } from "@lichtblick/suite-base/components/AppBar/constants";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useAnalytics } from "@lichtblick/suite-base/context/AnalyticsContext";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { SAMPLES_CATALOG_URL } from "@lichtblick/suite-base/dataSources/constants";
import { AppEvent } from "@lichtblick/suite-base/services/IAnalytics";
import { useSourcePick } from "@lichtblick/suite-base/util/sourcePick";

import { CatalogUrlView } from "./CatalogUrlView";
import Start, { type StartHandle } from "./Start";

export type DataSourceDialogItem = "start" | "file" | "demo" | "remote";

const useStyles = makeStyles()(() => ({
  fullScreenPaper: {
    // The theme caps dialog height; a full-screen page should fill the window.
    maxHeight: "none",
  },
  // Keep the app bar visible above a full-screen page: it holds the window controls and is the
  // drag region of an installed app's title bar.
  belowAppBar: {
    top: APP_BAR_HEIGHT,
  },
}));

const selectDataSourceDialog = (store: WorkspaceContextStore) => store.dialogs.dataSource;

export function DataSourceDialog({
  startRef,
}: {
  startRef?: React.Ref<StartHandle>;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { dialogActions } = useWorkspaceActions();
  const {
    activeDataSource,
    item: activeView,
    catalogUrl,
  } = useWorkspaceStore(selectDataSourceDialog);

  const isMounted = useMountedState();
  const { t } = useTranslation("compare");
  // Opened to pick a recording for something else (e.g. a comparison) rather than to open it
  const pickLabel = useSourcePick((state) => state.pick?.label);

  const analytics = useAnalytics();

  const onModalClose = useCallback(() => {
    analytics.logEvent(AppEvent.DIALOG_CLOSE, { activeDataSource });
    dialogActions.dataSource.close();
  }, [analytics, activeDataSource, dialogActions.dataSource]);

  const prevActiveViewRef = useRef<DataSourceDialogItem | undefined>(undefined);
  useLayoutEffect(() => {
    if (activeView === prevActiveViewRef.current) {
      // Only run actions below when the active view actually changed
      return;
    }
    prevActiveViewRef.current = activeView;
    if (activeView === "file") {
      dialogActions.openFile
        .open()
        .catch((err: unknown) => {
          console.error(err);
        })
        .finally(() => {
          // set the view back to start so the user can click to open file again
          if (isMounted()) {
            dialogActions.dataSource.open("start");
          }
        });
    }
  }, [activeView, dialogActions, isMounted]);

  return (
    <Dialog
      data-testid="DataSourceDialog"
      open
      onClose={onModalClose}
      fullWidth
      fullScreen
      className={classes.belowAppBar}
      maxWidth="lg"
      slotProps={{
        backdrop: {
          className: classes.belowAppBar,
        },
        paper: {
          square: false,
          elevation: 4,
          className: classes.fullScreenPaper,
        },
      }}
    >
      {/* The full-page start screen is left by opening something (or Escape), not a close button. */}
      <Stack flexGrow={1} fullHeight justifyContent="space-between" overflow="hidden">
        {pickLabel != undefined && (
          <Alert
            severity="info"
            square
            action={
              <Button color="inherit" size="small" onClick={onModalClose}>
                {t("pickCancel")}
              </Button>
            }
          >
            {t("pickBanner", { label: pickLabel })}
          </Alert>
        )}
        {activeView === "demo" ? (
          <CatalogUrlView
            url={catalogUrl ?? SAMPLES_CATALOG_URL}
            onBack={() => {
              dialogActions.dataSource.open("start");
            }}
            onOpened={onModalClose}
          />
        ) : (
          <Start ref={startRef} />
        )}
      </Stack>
    </Dialog>
  );
}
