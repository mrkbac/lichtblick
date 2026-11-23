// SPDX-License-Identifier: MPL-2.0

import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DoubleArrowDownIcon from "@mui/icons-material/KeyboardDoubleArrowDown";
import TitleIcon from "@mui/icons-material/Title";

import { type PanelButton, RegexLabel } from "@lichtblick/suite-base/components/PanelButton";

export const LOG_BUTTONS = {
  copy: { id: "logCopy", icon: ContentCopyIcon, placement: "toolbar" },
  matchCase: { id: "logMatchCase", icon: TitleIcon, placement: "inline" },
  regex: { id: "logRegex", icon: RegexLabel, placement: "inline" },
  previousProblem: { id: "logPreviousProblem", icon: ArrowUpwardIcon, placement: "inline" },
  nextProblem: { id: "logNextProblem", icon: ArrowDownwardIcon, placement: "inline" },
  copyMessage: { id: "logCopyMessage", icon: ContentCopyIcon, placement: "inline" },
  followPlayhead: { id: "logFollowPlayhead", icon: DoubleArrowDownIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
