// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { IconButton } from "@mui/material";

import { PanelButton, usePanelButtonTitle } from "@lichtblick/suite-base/components/PanelButton";
import { useStylesMetadata } from "@lichtblick/suite-base/panels/RawMessagesCommon/index.style";
import { MessageStepping } from "@lichtblick/suite-base/panels/RawMessagesCommon/types";
import { RAW_MESSAGES_SHORTCUTS } from "@lichtblick/suite-base/panels/RawMessagesVirtual/shortcuts";
import { shortcutLabel } from "@lichtblick/suite-base/util/keyboardShortcuts";

import { RAW_MESSAGES_BUTTONS } from "./buttons";

function StepButton(props: {
  button: PanelButton;
  shortcut: "rawMessages.previousMessage" | "rawMessages.nextMessage";
  disabled: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const { classes } = useStylesMetadata();
  const title = usePanelButtonTitle(props.button);
  const key = shortcutLabel(RAW_MESSAGES_SHORTCUTS, props.shortcut);
  const Icon = props.button.icon;
  return (
    <IconButton
      size="small"
      className={classes.button}
      title={key != undefined ? `${title} (${key})` : title}
      aria-label={title}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon />
    </IconButton>
  );
}

export function StepButtons({ stepping }: { stepping: MessageStepping }): React.JSX.Element {
  return (
    <>
      <StepButton
        button={RAW_MESSAGES_BUTTONS.previousMessage}
        shortcut="rawMessages.previousMessage"
        disabled={!stepping.canStepPrevious}
        onClick={stepping.onStepPrevious}
      />
      <StepButton
        button={RAW_MESSAGES_BUTTONS.nextMessage}
        shortcut="rawMessages.nextMessage"
        disabled={!stepping.canStepNext}
        onClick={stepping.onStepNext}
      />
    </>
  );
}
