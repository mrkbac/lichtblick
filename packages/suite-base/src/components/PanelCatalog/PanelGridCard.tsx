// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Card, CardActionArea, CardContent, CardMedia, Typography } from "@mui/material";
import { useCallback } from "react";
import { makeStyles } from "tss-react/mui";

import { fuzzyPositions, HighlightChars } from "@lichtblick/suite-base/components/HighlightChars";
import Stack from "@lichtblick/suite-base/components/Stack";
import { PanelInfo } from "@lichtblick/suite-base/context/PanelCatalogContext";

const useStyles = makeStyles()((theme) => {
  return {
    fullHeight: {
      height: "100%",
    },
    imagePlaceholder: {
      paddingBottom: `${(200 / 280) * 100}%`,
      backgroundColor: theme.palette.background.default,
    },
    cardContent: {
      flex: "auto",
    },
    highlight: {
      backgroundColor: "transparent",
      color: theme.palette.primary.main,
      fontWeight: "bold",
    },
  };
});

type Props = {
  panel: PanelInfo;
  searchQuery: string;
  onClick: () => void;
};

export function PanelGridCard(props: Props): React.JSX.Element {
  const { searchQuery, panel, onClick } = props;
  const { classes } = useStyles();

  const targetString = panel.extensionNamespace
    ? `${panel.title} [${panel.extensionNamespace}]`
    : panel.title;

  const onClickWithStopPropagation = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onClick();
    },
    [onClick],
  );

  return (
    <Card className={classes.fullHeight}>
      <CardActionArea onClick={onClickWithStopPropagation} className={classes.fullHeight}>
        <Stack fullHeight>
          {panel.thumbnail != undefined ? (
            <CardMedia component="img" image={panel.thumbnail} alt={panel.title} />
          ) : (
            <div className={classes.imagePlaceholder} />
          )}
          <CardContent className={classes.cardContent}>
            <Typography variant="subtitle2" gutterBottom>
              <span data-testid={`panel-grid-card ${panel.title}`}>
                <HighlightChars
                  str={targetString}
                  indices={fuzzyPositions(targetString, searchQuery)}
                  highlightClassName={classes.highlight}
                />
              </span>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <HighlightChars
                str={panel.description ?? ""}
                indices={fuzzyPositions(panel.description ?? "", searchQuery)}
                highlightClassName={classes.highlight}
              />
            </Typography>
          </CardContent>
        </Stack>
      </CardActionArea>
    </Card>
  );
}
