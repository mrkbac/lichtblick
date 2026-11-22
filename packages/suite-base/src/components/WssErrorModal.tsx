// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import { Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { lazy, Suspense, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { Immutable } from "@lichtblick/suite";
import { PlayerAlert } from "@lichtblick/suite-base/players/types";

// Loaded on demand: it's only needed after the browser blocked a ws:// connection
const WsMixedContentHelp = lazy(async () => ({
  default: (await import("@lichtblick/suite-base/components/WsMixedContentHelp"))
    .WsMixedContentHelp,
}));

const useStyles = makeStyles()({
  dialogTitle: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
});

/** Explains, once per page, how to connect when the browser blocks ws:// from this https page. */
export default function WssErrorModal(
  props: Readonly<Immutable<{ playerAlerts?: PlayerAlert[] }>>,
): React.JSX.Element {
  const { playerAlerts } = props;
  const { classes } = useStyles();
  const [dismissed, setDismissed] = useState(false);

  const guide = playerAlerts?.find((alert) => alert.guide?.type === "wsMixedContent")?.guide;
  if (dismissed || guide == undefined) {
    return <></>;
  }

  const close = () => {
    setDismissed(true);
  };
  return (
    <Dialog open onClose={close} maxWidth="sm">
      <DialogTitle className={classes.dialogTitle}>
        Your browser blocked the connection
        <IconButton aria-label="Close" onClick={close} edge="end">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Suspense>
          <WsMixedContentHelp url={guide.url} />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
