// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ClickAwayListener, Grow, Paper, Popper } from "@mui/material";
import { useCallback, useContext } from "react";
import { makeStyles } from "tss-react/mui";

import { PanelCatalog, PanelSelection } from "@lichtblick/suite-base/components/PanelCatalog";
import PanelContext from "@lichtblick/suite-base/components/PanelContext";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";

const useStyles = makeStyles()((theme) => ({
  paper: {
    backgroundColor: theme.palette.background.menu,
    maxHeight: `calc(100vh - ${theme.spacing(12)})`,
    overflow: "auto",

    // Add iOS momentum scrolling for iOS < 13.0
    WebkitOverflowScrolling: "touch",
  },
}));

/**
 * Panel catalog submenu. By default it swaps the current panel for the selected type; with
 * `onPanelSelect` it hands the selection to the caller instead (e.g. to add a new tab).
 */
export default function ChangePanelMenu({
  id = "change-panel-menu",
  anchorEl,
  onClose,
  onPanelSelect,
}: {
  id?: string;
  anchorEl?: HTMLElement;
  onClose: () => void;
  onPanelSelect?: (selection: PanelSelection) => void;
}): React.JSX.Element {
  const { classes } = useStyles();
  const panelContext = useContext(PanelContext);
  const { swapPanel } = useCurrentLayoutActions();
  const open = Boolean(anchorEl);

  const handleSwap = useCallback(
    (originalId?: string) =>
      ({ type, config }: PanelSelection) => {
        // Reselecting current panel type is a no-op.
        if (type === panelContext?.type) {
          onClose();
          return;
        }

        swapPanel({ originalId: originalId ?? "", type, config: config ?? {} });
      },
    [onClose, panelContext?.type, swapPanel],
  );

  // https://github.com/mui/material-ui/issues/35287#issuecomment-1332327752
  const fixMui35287 = {} as { onResize: undefined; onResizeCapture: undefined };

  return (
    <Popper
      {...fixMui35287}
      id={id}
      open={open}
      role={undefined}
      anchorEl={anchorEl}
      transition
      placement="right-start"
      style={{ zIndex: 10000 }}
      popperOptions={{
        modifiers: [
          {
            name: "flip",
            options: { fallbackPlacements: ["right-start", "left-start"] },
          },
        ],
      }}
    >
      {({ TransitionProps, placement }) => (
        <Grow
          {...TransitionProps}
          style={{
            transformOrigin: placement === "right-start" ? "top left" : "top right",
          }}
        >
          <Paper elevation={8} className={classes.paper}>
            <ClickAwayListener onClickAway={onClose}>
              <PanelCatalog
                mode="list"
                isMenu
                selectedPanelType={onPanelSelect ? undefined : panelContext?.type}
                onPanelSelect={onPanelSelect ?? handleSwap(panelContext?.id)}
              />
            </ClickAwayListener>
          </Paper>
        </Grow>
      )}
    </Popper>
  );
}
