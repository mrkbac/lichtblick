// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Theme } from "@mui/material";
import { makeStyles } from "tss-react/mui";

import { parseColor, toHex6 } from "@lichtblick/suite-base/util/parseColor";

function calculateBorderColor(theme: Theme, color: string): string {
  const parsedColor = parseColor(color);
  return parsedColor.isValid()
    ? theme.palette.getContrastText(toHex6(parsedColor))
    : theme.palette.text.primary;
}

type ColorSwatchProps = {
  color: string;
  size?: "small" | "medium" | "large";
} & React.HTMLAttributes<HTMLDivElement>;

const useStyles = makeStyles()((theme) => ({
  root: {
    // Color on top of white/black diagonal gradient. Color must be specified as a gradient because a
    // background color can't be stacked on top of a background image.
    backgroundImage: `linear-gradient(to bottom right, white 50%, black 50%)`,
    borderRadius: theme.shape.borderRadius,
    display: "inline-flex",
    aspectRatio: "1/1",
    flexShrink: 0,
  },
  swatch: {
    aspectRatio: "1/1",
  },
  sizeSmall: {
    height: theme.spacing(2),
    width: theme.spacing(2),
  },
  sizeMedium: {
    height: theme.spacing(2),
    width: theme.spacing(2),
  },
  sizeLarge: {
    height: theme.spacing(3),
    width: theme.spacing(3),
  },
}));

export function ColorSwatch(props: ColorSwatchProps): React.JSX.Element {
  const { color, size = "medium", className, ...rest } = props;
  const { classes, cx, theme } = useStyles();

  return (
    <div
      className={cx(
        classes.root,
        {
          [classes.sizeSmall]: size === "small",
          [classes.sizeMedium]: size === "medium",
          [classes.sizeLarge]: size === "large",
        },
        className,
      )}
      {...rest}
    >
      <div
        title={color}
        className={classes.swatch}
        style={{
          backgroundColor: color,
          border: `1px solid ${calculateBorderColor(theme, color)}`,
        }}
      />
    </div>
  );
}
