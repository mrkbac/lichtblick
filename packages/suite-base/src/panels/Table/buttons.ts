// SPDX-License-Identifier: MPL-2.0

import ExpandIcon from "@mui/icons-material/ChevronRight";
import CollapseIcon from "@mui/icons-material/ExpandMore";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const TABLE_BUTTONS = {
  expandRow: { id: "tableExpandRow", icon: ExpandIcon, placement: "inline" },
  collapseCell: { id: "tableCollapseCell", icon: CollapseIcon, placement: "inline" },
  firstPage: { id: "tableFirstPage", icon: KeyboardDoubleArrowLeftIcon, placement: "inline" },
  previousPage: { id: "tablePreviousPage", icon: KeyboardArrowLeftIcon, placement: "inline" },
  nextPage: { id: "tableNextPage", icon: KeyboardArrowRightIcon, placement: "inline" },
  lastPage: { id: "tableLastPage", icon: KeyboardDoubleArrowRightIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
