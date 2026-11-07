// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Typography } from "@mui/material";
import { getPanelData } from "dockview-react";
import { useCallback, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { LayoutTabContext } from "@lichtblick/suite-base/components/LayoutTabContext";
import { PanelCatalog, PanelSelection } from "@lichtblick/suite-base/components/PanelCatalog";
import {
  getPanelDragData,
  isPanelDrag,
} from "@lichtblick/suite-base/components/PanelCatalog/panelDrag";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { getPanelIdForType } from "@lichtblick/suite-base/util/layout";

const useStyles = makeStyles()((theme) => ({
  hint: { padding: theme.spacing(2, 2, 0) },
  root: {
    backgroundColor: theme.palette.background.paper,
    width: "100%",
    height: "100%",
    overflowY: "auto",
  },
  dropTarget: {
    width: "100%",
    height: "100%",
    minHeight: 0,
  },
  isOver: {
    "&:after": {
      content: "''",
      borderColor: `1px solid ${theme.palette.action.selected}`,
      backgroundColor: theme.palette.action.focus,
      position: "absolute",
      top: 0,
      right: 0,
      left: 0,
      bottom: 0,
      zIndex: theme.zIndex.appBar,
    },
  },
}));

export const EmptyPanelLayout = (): React.JSX.Element => {
  const { classes, cx } = useStyles();
  const { addPanel } = useCurrentLayoutActions();
  const { t } = useTranslation("addPanel");
  const [isOver, setIsOver] = useState(false);
  // In an empty tab of a Tab panel, panels go into that tab.
  const tabPath = useContext(LayoutTabContext);
  const tabId = tabPath.at(-1);

  const onPanelSelect = useCallback(
    ({ type, config }: PanelSelection) => {
      addPanel({ id: getPanelIdForType(type), config, tabId });
    },
    [addPanel, tabId],
  );

  // A panel moved here from elsewhere in the layout; a Tab panel can't go into its own tab.
  const movedPanelId = () => {
    const panelId = getPanelData()?.panelId ?? undefined;
    return panelId != undefined && !tabPath.includes(panelId) ? panelId : undefined;
  };

  const onDragOver = (event: React.DragEvent) => {
    if (isPanelDrag(event.dataTransfer) || movedPanelId() != undefined) {
      event.preventDefault();
      setIsOver(true);
    }
  };

  const onDrop = (event: React.DragEvent) => {
    setIsOver(false);
    const selection = getPanelDragData(event.dataTransfer);
    const movedId = movedPanelId();
    if (selection) {
      event.preventDefault();
      onPanelSelect(selection);
    } else if (movedId != undefined) {
      event.preventDefault();
      addPanel({ id: movedId, tabId });
    }
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => {
        setIsOver(false);
      }}
      onDrop={onDrop}
      data-testid="empty-drop-target"
      className={cx(classes.dropTarget, { [classes.isOver]: isOver })}
    >
      <div className={classes.root}>
        <Stack paddingBottom={2}>
          <Typography variant="body2" className={classes.hint}>
            {t("selectPanelToAddToLayout")}{" "}
          </Typography>
          <PanelCatalog mode="grid" onPanelSelect={onPanelSelect} />
        </Stack>
      </div>
    </div>
  );
};
