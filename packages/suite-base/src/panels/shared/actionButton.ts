// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Shared bits of the button panels (Publish, Call Service).

import { makeStyles } from "tss-react/mui";

import type { DocumentedFields } from "@lichtblick/suite-base/panels/shared/documentedSettings";

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
): DocumentedFields {
  return {
    buttonText: {
      label: "Title",
      help: "Label of the button.",
      input: "string",
      value: config.buttonText,
      placeholder: textPlaceholder,
    },
    buttonTooltip: {
      label: "Tooltip",
      help: "Tooltip of the button; when empty, it shows the keyboard shortcut.",
      input: "string",
      value: config.buttonTooltip,
    },
    buttonColor: {
      label: "Color",
      help: "Background color of the button.",
      input: "rgb",
      value: config.buttonColor,
    },
  };
}
