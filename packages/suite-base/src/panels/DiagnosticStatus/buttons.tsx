// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Copy16Regular } from "@fluentui/react-icons";
import PowerInputIcon from "@mui/icons-material/PowerInput";
import ShowChartIcon from "@mui/icons-material/ShowChart";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

function PlotIcon(): React.JSX.Element {
  return <ShowChartIcon fontSize="inherit" />;
}

function StateTransitionsIcon(): React.JSX.Element {
  return <PowerInputIcon fontSize="inherit" />;
}

export const DIAGNOSTIC_STATUS_BUTTONS = {
  copyStatus: { id: "diagnosticStatusCopyStatus", icon: Copy16Regular, placement: "inline" },
  copyValue: { id: "diagnosticStatusCopyValue", icon: Copy16Regular, placement: "inline" },
  openInPlot: { id: "diagnosticStatusOpenInPlot", icon: PlotIcon, placement: "inline" },
  openInStateTransitions: {
    id: "diagnosticStatusOpenInStateTransitions",
    icon: StateTransitionsIcon,
    placement: "inline",
  },
} as const satisfies Record<string, PanelButton>;
