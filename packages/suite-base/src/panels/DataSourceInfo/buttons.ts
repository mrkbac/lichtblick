// SPDX-License-Identifier: MPL-2.0

import { Copy16Regular } from "@fluentui/react-icons";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const SOURCE_INFO_BUTTONS = {
  sortDirection: { id: "sourceInfoSortDirection", icon: ArrowUpwardIcon, placement: "inline" },
  // Drawn by the shared CopyButton, which swaps in a check mark once copied.
  copyTopicName: { id: "sourceInfoCopyTopicName", icon: Copy16Regular, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
