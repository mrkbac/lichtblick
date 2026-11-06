// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Dialog } from "@mui/material";
import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useMountedState } from "react-use";
import { makeStyles } from "tss-react/mui";

import { APP_BAR_HEIGHT } from "@lichtblick/suite-base/components/AppBar/constants";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useAnalytics } from "@lichtblick/suite-base/context/AnalyticsContext";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { AppEvent } from "@lichtblick/suite-base/services/IAnalytics";

import Start from "./Start";

// Lazy so three.js stays out of the startup bundle.
const Snow = lazy(
  async () => await import("@lichtblick/suite-base/components/DataSourceDialog/Snow"),
);

export type DataSourceDialogItem = "start" | "file" | "demo" | "remote";

type DataSourceDialogProps = {
  backdropAnimation?: boolean;
};

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

export function DataSourceDialog(props: DataSourceDialogProps): React.JSX.Element {
  const { backdropAnimation } = props;
  const { classes } = useStyles();
  const { availableSources, selectSource } = usePlayerSelection();
  const { dialogActions } = useWorkspaceActions();
  const { activeDataSource, item: activeView } = useWorkspaceStore(selectDataSourceDialog);

  const isMounted = useMountedState();

  const firstSampleSource = useMemo(() => {
    return availableSources.find((source) => source.type === "sample");
  }, [availableSources]);

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
    } else if (activeView === "demo" && firstSampleSource) {
      selectSource(firstSampleSource.id);
    }
  }, [activeView, dialogActions, firstSampleSource, isMounted, selectSource]);

  const backdrop = useMemo(() => {
    const now = new Date();
    if (backdropAnimation === false) {
      return;
    } else if (now >= new Date(now.getFullYear(), 11, 25)) {
      return (
        <Suspense>
          <Snow effect="snow" />
        </Suspense>
      );
    } else if (now < new Date(now.getFullYear(), 0, 2)) {
      return (
        <Suspense>
          <Snow effect="confetti" />
        </Suspense>
      );
    }
    return;
  }, [backdropAnimation]);

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
          children: backdrop,
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
        {activeView !== "demo" && <Start />}
      </Stack>
    </Dialog>
  );
}
