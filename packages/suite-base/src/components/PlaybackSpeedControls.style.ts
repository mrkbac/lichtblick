// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()((theme) => ({
  speedText: {
    fontSize: "0.8rem",
    fontWeight: 400,
    marginRight: 2,
  },
  paper: {
    width: 300,
    padding: theme.spacing(1.5, 2, 2),
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(1),
    borderRadius: Number(theme.shape.borderRadius) * 2,
  },
  title: {
    lineHeight: 1,
    letterSpacing: "0.08em",
  },
  value: {
    fontWeight: 600,
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
  },
  stepButton: {
    border: `1px solid ${theme.palette.divider}`,
    marginBottom: theme.spacing(2.5), // align with the track, above the mark labels
  },
  slider: {
    "& .MuiSlider-thumb": {
      width: 14,
      height: 14,
    },
    "& .MuiSlider-markLabel": {
      fontSize: "0.65rem",
      color: theme.palette.text.secondary,
      top: 26,
    },
    "& .MuiSlider-mark": {
      height: 6,
      width: 1,
      backgroundColor: theme.palette.text.disabled,
    },
  },
  preset: {
    padding: theme.spacing(0.25, 0),
    fontSize: "0.75rem",
    fontVariantNumeric: "tabular-nums",
    textTransform: "none",
  },
}));
