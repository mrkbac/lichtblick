// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Shared bits of the button panels (Publish, Call Service).

import { makeStyles } from "tss-react/mui";

import { SettingsTreeFields } from "@lichtblick/suite";

export const useActionButtonStyles = makeStyles<{ buttonColor?: string }>()(
  (theme, { buttonColor }) => {
    const augmented = buttonColor
      ? theme.palette.augmentColor({ color: { main: buttonColor } })
      : undefined;
    // Classes are used by the importing panels.
    /* eslint-disable tss-unused-classes/unused-classes */
    return {
      wrapper: { display: "contents" },
      button: {
        backgroundColor: augmented?.main,
        color: augmented?.contrastText,
        "&:hover": { backgroundColor: augmented?.dark },
      },
    };
  },
);

export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour12: false });
}

export function buttonSettingsFields(
  config: { buttonText?: string; buttonTooltip?: string; buttonColor?: string },
  textPlaceholder?: string,
): SettingsTreeFields {
  return {
    buttonText: {
      label: "Title",
      input: "string",
      value: config.buttonText,
      placeholder: textPlaceholder,
    },
    buttonTooltip: { label: "Tooltip", input: "string", value: config.buttonTooltip },
    buttonColor: { label: "Color", input: "rgb", value: config.buttonColor },
  };
}
