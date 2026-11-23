// SPDX-License-Identifier: MPL-2.0

import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const SOURCE_INFO_BUTTONS = {
  sortDirection: { id: "sourceInfoSortDirection", icon: ArrowUpwardIcon, placement: "inline" },
  // Drawn by the shared CopyButton, which swaps in a check mark once copied.
  copyTopicName: { id: "sourceInfoCopyTopicName", icon: ContentCopyIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
