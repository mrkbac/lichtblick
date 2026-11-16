// SPDX-License-Identifier: MPL-2.0

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";
import PublishPointIcon from "@lichtblick/suite-base/components/PublishPointIcon";

function PinIcon(): React.JSX.Element {
  return <PublishPointIcon fontSize="small" />;
}

export const DIAGNOSTIC_SUMMARY_BUTTONS = {
  pin: { id: "diagnosticSummaryPin", icon: PinIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
