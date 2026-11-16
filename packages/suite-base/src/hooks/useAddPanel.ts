// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback } from "react";

import { PanelSelection } from "@lichtblick/suite-base/components/PanelCatalog";
import {
  useCurrentLayoutActions,
  useSelectedPanels,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { AddPanelPayload } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { getPanelIdForType } from "@lichtblick/suite-base/util/layout";
import { isTabPanel } from "@lichtblick/suite-base/util/tabLayout";

export type PanelBox = { id: string; width: number; height: number };

/**
 * Where a new panel goes: it splits one panel instead of squeezing the whole layout. That is the
 * selected panel if exactly one is selected and visible, else the largest visible panel. The split
 * runs along the panel's longer side. Undefined when nothing is visible (layout default applies).
 */
export function splitPlacement(
  panels: readonly PanelBox[],
  selectedIds: readonly string[],
): Pick<AddPanelPayload, "position" | "targetPanelId"> | undefined {
  // Tab panels contain other panels; split the panel inside the shown tab instead.
  const visible = panels.filter((p) => p.width > 0 && p.height > 0 && !isTabPanel(p.id));
  const selected =
    selectedIds.length === 1 ? visible.find((p) => p.id === selectedIds[0]) : undefined;
  const target =
    selected ??
    visible.reduce<PanelBox | undefined>(
      (best, p) => (best == undefined || p.width * p.height > best.width * best.height ? p : best),
      undefined,
    );
  if (target == undefined) {
    return undefined;
  }
  return {
    targetPanelId: target.id,
    position: target.width >= target.height ? "right" : "bottom",
  };
}

/** Sizes of the panels on screen, from the `data-panel-id` attribute set by `Panel`. */
function measurePanels(): PanelBox[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-panel-id]"), (el) => {
    const rect = el.getBoundingClientRect();
    return { id: el.dataset.panelId ?? "", width: rect.width, height: rect.height };
  });
}

/** Adds a panel next to the panel the user is working on and selects it. */
export default function useAddPanel(): (selection: PanelSelection) => void {
  const { addPanel } = useCurrentLayoutActions();
  const { getSelectedPanelIds, setSelectedPanelIds } = useSelectedPanels();
  return useCallback(
    ({ type, config }: PanelSelection) => {
      const id = getPanelIdForType(type);
      addPanel({ id, config, ...splitPlacement(measurePanels(), getSelectedPanelIds()) });
      // Selected, so its settings are one step away and the next new panel goes next to it.
      setSelectedPanelIds([id]);
    },
    [addPanel, getSelectedPanelIds, setSelectedPanelIds],
  );
}
