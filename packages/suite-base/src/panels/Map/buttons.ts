// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  ArrowAutofitHeight20Regular,
  Delete20Regular,
  LocationAdd20Regular,
  Ruler20Regular,
  Triangle20Regular,
  ZoomFit20Regular,
} from "@fluentui/react-icons";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const MAP_BUTTONS = {
  zoomToData: { id: "mapZoomToData", icon: ZoomFit20Regular, placement: "overlay" },
  measuringTools: { id: "mapMeasuringTools", icon: Ruler20Regular, placement: "overlay" },
  distance: { id: "mapMeasureDistance", icon: Ruler20Regular, placement: "overlay" },
  height: { id: "mapMeasureHeight", icon: ArrowAutofitHeight20Regular, placement: "overlay" },
  angle: { id: "mapMeasureAngle", icon: Triangle20Regular, placement: "overlay" },
  point: { id: "mapPinPoints", icon: LocationAdd20Regular, placement: "overlay" },
  clearAll: { id: "mapClearMeasurements", icon: Delete20Regular, placement: "overlay" },
} as const satisfies Record<string, PanelButton>;
