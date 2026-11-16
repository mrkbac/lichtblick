// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ChevronLeft16Regular, ChevronRight16Regular, Copy16Regular } from "@fluentui/react-icons";
import CopyAllIcon from "@mui/icons-material/CopyAll";
import DiffOutlinedIcon from "@mui/icons-material/DifferenceOutlined";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import FilterIcon from "@mui/icons-material/FilterAlt";
import StateTransitionsIcon from "@mui/icons-material/PowerInput";
import ScatterPlotIcon from "@mui/icons-material/ScatterPlot";
import SearchIcon from "@mui/icons-material/Search";
import LineChartIcon from "@mui/icons-material/ShowChart";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const RAW_MESSAGES_BUTTONS = {
  diff: { id: "rawMessagesDiff", icon: DiffOutlinedIcon, placement: "toolbar" },
  expandAll: { id: "rawMessagesExpandAll", icon: UnfoldMoreIcon, placement: "toolbar" },
  collapseAll: { id: "rawMessagesCollapseAll", icon: UnfoldLessIcon, placement: "toolbar" },
  search: { id: "rawMessagesSearch", icon: SearchIcon, placement: "toolbar" },
  previousMessage: {
    id: "rawMessagesPreviousMessage",
    icon: ChevronLeft16Regular,
    placement: "inline",
  },
  nextMessage: { id: "rawMessagesNextMessage", icon: ChevronRight16Regular, placement: "inline" },
  copyMessage: { id: "rawMessagesCopyMessage", icon: Copy16Regular, placement: "inline" },
  dragValue: { id: "rawMessagesDragValue", icon: DragIndicatorIcon, placement: "inline" },
  copyValue: { id: "rawMessagesCopyValue", icon: CopyAllIcon, placement: "inline" },
  filter: { id: "rawMessagesFilter", icon: FilterIcon, placement: "inline" },
  plotLine: { id: "rawMessagesPlotLine", icon: LineChartIcon, placement: "inline" },
  plotScatter: { id: "rawMessagesPlotScatter", icon: ScatterPlotIcon, placement: "inline" },
  stateTransitions: {
    id: "rawMessagesStateTransitions",
    icon: StateTransitionsIcon,
    placement: "inline",
  },
} as const satisfies Record<string, PanelButton>;
