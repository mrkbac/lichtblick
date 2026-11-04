// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Chip } from "@mui/material";
import * as _ from "lodash-es";
import * as React from "react";
import tc from "tinycolor2";
import { makeStyles } from "tss-react/mui";

import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import type { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";

import { HUDItem } from "./HUDItemManager";
import { useRendererProperty } from "./RendererContext";

const useStyles = makeStyles()((theme) => ({
  root: {
    position: "absolute",
    top: 0,
    left: "50%",
    transform: "translateX(-50%)",
    pointerEvents: "none",
    display: "flex",
    flexDirection: "column",
    margin: theme.spacing(1),
    overflow: "hidden",
    maxHeight: "100%",
    gap: theme.spacing(1),
  },
  chip: {
    backgroundColor: tc(theme.palette.background.paper).setAlpha(0.8).toString(),
  },
  attribution: {
    position: "absolute",
    right: 0,
    bottom: 0,
    maxWidth: "60%",
    padding: theme.spacing(0, 0.5),
    pointerEvents: "none",
    fontSize: theme.typography.caption.fontSize,
    color: theme.palette.text.secondary,
    backgroundColor: tc(theme.palette.background.paper).setAlpha(0.6).toString(),
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  empty: {
    backgroundColor: theme.palette.background.default,
    position: "absolute",
    inset: 0,
  },
}));

type HUDProps = {
  renderer?: Renderer;
};

export function HUD(props: HUDProps): React.ReactElement {
  const { classes } = useStyles();
  const hudItems: HUDItem[] = useRendererProperty(
    "hudItems",
    "hudItemsChanged",
    () => [],
    props.renderer,
  );

  const [emptyStates, notices, attributions] = React.useMemo(() => {
    const groups = _.groupBy(hudItems, (i) => i.displayType);
    return [groups.empty ?? [], groups.notice ?? [], groups.attribution ?? []];
  }, [hudItems]);

  if (hudItems.length === 0) {
    return <></>;
  }

  if (emptyStates.length > 0) {
    const highPriorityEmptyState = emptyStates[emptyStates.length - 1]!;
    return <EmptyState className={classes.empty}>{highPriorityEmptyState.getMessage()}</EmptyState>;
  }

  const attribution = attributions.map((item) => item.getMessage()).join(" · ");
  return (
    <>
      {notices.length > 0 && (
        <div className={classes.root}>
          {notices.map((item, index) => (
            <Chip className={classes.chip} size="small" key={index} label={item.getMessage()} />
          ))}
        </div>
      )}
      {attribution !== "" && <div className={classes.attribution}>{attribution}</div>}
    </>
  );
}
