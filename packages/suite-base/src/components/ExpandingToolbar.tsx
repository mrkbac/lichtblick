// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import { Divider, Paper, IconButton, Tooltip, Typography } from "@mui/material";
import React, { ReactNode } from "react";
import { makeStyles } from "tss-react/mui";

import OverlayToolbar from "@lichtblick/suite-base/components/OverlayToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";

const PANE_HEIGHT = 240;

const useStyles = makeStyles()((theme) => ({
  root: {
    pointerEvents: "auto",
    backgroundColor: theme.palette.background.default,
    width: 280,
  },
  content: {
    position: "relative",
  },
  // Looks like the selected MUI Tab this header used to be.
  title: {
    lineHeight: 1.25,
    position: "relative",
    padding: theme.spacing(0.875, 1.5, 1),
    color: theme.palette.text.primary,

    "&::after": {
      content: '""',
      position: "absolute",
      left: "12.5%",
      right: "12.5%",
      bottom: 0,
      height: 2,
      backgroundColor: theme.palette.primary.main,
    },
  },
  minimizeButton: {
    borderRadius: 0,
    borderTopRightRadius: theme.shape.borderRadius,
  },
}));

export function ToolGroupFixedSizePane({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Stack padding={1} overflowX="hidden" overflowY="auto" style={{ maxHeight: PANE_HEIGHT }}>
      {children}
    </Stack>
  );
}

type Props<T extends string> = {
  checked?: boolean;
  children: ReactNode;
  icon: ReactNode;
  /** Header of the expanded pane; also the value passed to onSelectTab when opening. */
  title: T;
  onSelectTab: (name: T | undefined) => void;
  selectedTab?: T; // collapse the toolbar if selectedTab is undefined
  tooltip: string;
  dataTest?: string;
  /** The panel's other floating controls, joined below the toggle into one toolbar. */
  toolbarItems?: ReactNode;
};

/** Expands a floating control into a pane while leaving the surrounding canvas interactive. */
export default function ExpandingToolbar<T extends string>({
  children,
  checked,
  icon,
  onSelectTab,
  selectedTab,
  title,
  tooltip,
  dataTest,
  toolbarItems,
}: Props<T>): React.JSX.Element {
  const { classes } = useStyles();
  const expanded = selectedTab != undefined;

  const toolbar = (
    <OverlayToolbar>
      <Tooltip placement="left" title={tooltip}>
        <IconButton
          size="small"
          aria-pressed={expanded || checked === true}
          aria-label={tooltip}
          data-testid={`ExpandingToolbar-${tooltip}`}
          onClick={() => {
            onSelectTab(expanded ? undefined : title);
          }}
        >
          {icon}
        </IconButton>
      </Tooltip>
      {toolbarItems != undefined && (
        <>
          <Divider />
          {toolbarItems}
        </>
      )}
    </OverlayToolbar>
  );

  if (!expanded) {
    return toolbar;
  }
  return (
    <>
      <Paper className={classes.root} data-testid={dataTest} square={false} elevation={4}>
        <Paper>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="button" component="div" className={classes.title}>
              {title}
            </Typography>
            <IconButton
              size="small"
              className={classes.minimizeButton}
              onClick={() => {
                onSelectTab(undefined);
              }}
            >
              <CloseFullscreenIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Paper>
        <div className={classes.content}>{children}</div>
      </Paper>
      {toolbar}
    </>
  );
}
