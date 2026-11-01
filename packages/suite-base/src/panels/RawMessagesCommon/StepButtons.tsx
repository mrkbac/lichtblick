// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ChevronLeft16Regular, ChevronRight16Regular } from "@fluentui/react-icons";
import { IconButton } from "@mui/material";

import { useStylesMetadata } from "@lichtblick/suite-base/panels/RawMessagesCommon/index.style";
import { MessageStepping } from "@lichtblick/suite-base/panels/RawMessagesCommon/types";

export function StepButtons({ stepping }: { stepping: MessageStepping }): React.JSX.Element {
  const { classes } = useStylesMetadata();
  return (
    <>
      <IconButton
        size="small"
        className={classes.button}
        title="Previous message (Alt+[)"
        aria-label="Previous message"
        disabled={!stepping.canStepPrevious}
        onClick={stepping.onStepPrevious}
      >
        <ChevronLeft16Regular />
      </IconButton>
      <IconButton
        size="small"
        className={classes.button}
        title="Next message (Alt+])"
        aria-label="Next message"
        disabled={!stepping.canStepNext}
        onClick={stepping.onStepNext}
      >
        <ChevronRight16Regular />
      </IconButton>
    </>
  );
}
