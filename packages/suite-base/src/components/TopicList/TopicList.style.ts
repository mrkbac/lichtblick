// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()((theme) => ({
  root: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    containerType: "inline-size",
  },
  filterBar: {
    top: 0,
    zIndex: theme.zIndex.appBar,
    padding: theme.spacing(0.5),
    position: "sticky",
    backgroundColor: theme.palette.background.paper,
  },
  searchRow: {
    display: "flex",
    alignItems: "center",
    paddingRight: theme.spacing(0.5),
    "& > :first-of-type": { flex: "1 1 auto", minWidth: 0 },
  },
  namespaceLabel: {
    flex: "auto",
  },
  treeToggle: {
    padding: theme.spacing(0.5),
  },
  skeletonText: {
    marginTop: theme.spacing(0.5),
    marginBottom: theme.spacing(0.5),
  },
}));
