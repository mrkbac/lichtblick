// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Fzf } from "fzf";
import { makeStyles } from "tss-react/mui";

const useStyles = makeStyles()((theme) => ({
  highlight: {
    color: theme.palette.primary.main,
    fontWeight: "bold",
  },
}));

type Props = {
  targetStr: string;
  searchText?: string;
};

export default function TextHighlight({ targetStr, searchText = "" }: Props): React.JSX.Element {
  const { classes } = useStyles();

  const positions =
    searchText.length > 0 ? new Fzf([targetStr]).find(searchText)[0]?.positions : undefined;
  if (positions == undefined || positions.size === 0) {
    return <>{targetStr}</>;
  }

  // Group consecutive characters so each matched run is one element
  const runs: { text: string; matched: boolean }[] = [];
  // fzf positions index code points, so iterate code points rather than UTF-16 units
  for (const [index, char] of Array.from(targetStr).entries()) {
    const matched = positions.has(index);
    const last = runs.at(-1);
    if (last?.matched === matched) {
      last.text += char;
    } else {
      runs.push({ text: char, matched });
    }
  }
  return (
    <span>
      {runs.map((run, i) =>
        run.matched ? (
          <span key={i} className={classes.highlight}>
            {run.text}
          </span>
        ) : (
          run.text
        ),
      )}
    </span>
  );
}
