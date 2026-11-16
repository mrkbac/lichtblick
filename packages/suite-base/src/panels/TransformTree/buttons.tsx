// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Dismiss12Regular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

function MeasureFromLabel(): React.JSX.Element {
  const { t } = useTranslation("threeDee");
  return <>{t("frameMeasureFromBadge")}</>;
}

function MeasureToLabel(): React.JSX.Element {
  const { t } = useTranslation("threeDee");
  return <>{t("frameMeasureToBadge")}</>;
}

export const TRANSFORM_TREE_BUTTONS = {
  measureFrom: { id: "transformTreeMeasureFrom", icon: MeasureFromLabel, placement: "inline" },
  measureTo: { id: "transformTreeMeasureTo", icon: MeasureToLabel, placement: "inline" },
  closeEditor: { id: "transformTreeCloseEditor", icon: Dismiss12Regular, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
