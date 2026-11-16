// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  ArrowDown16Regular,
  ArrowUp16Regular,
  Copy16Regular,
  Copy20Filled,
  TextCaseTitle16Regular,
} from "@fluentui/react-icons";
import DoubleArrowDownIcon from "@mui/icons-material/KeyboardDoubleArrowDown";
import { Typography } from "@mui/material";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

function RegexLabel(): React.JSX.Element {
  return (
    <Typography variant="caption" style={{ fontFamily: "monospace", lineHeight: 1 }}>
      .*
    </Typography>
  );
}

export const LOG_BUTTONS = {
  copy: { id: "logCopy", icon: Copy20Filled, placement: "toolbar" },
  matchCase: { id: "logMatchCase", icon: TextCaseTitle16Regular, placement: "inline" },
  regex: { id: "logRegex", icon: RegexLabel, placement: "inline" },
  previousProblem: { id: "logPreviousProblem", icon: ArrowUp16Regular, placement: "inline" },
  nextProblem: { id: "logNextProblem", icon: ArrowDown16Regular, placement: "inline" },
  copyMessage: { id: "logCopyMessage", icon: Copy16Regular, placement: "inline" },
  followPlayhead: { id: "logFollowPlayhead", icon: DoubleArrowDownIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
