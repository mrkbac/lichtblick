// SPDX-License-Identifier: MPL-2.0

import { ContextType, createContext } from "react";

import type { DockPanelContext } from "@lichtblick/suite-base/components/DockPanelContext";
import type PanelContext from "@lichtblick/suite-base/components/PanelContext";
import type { PanelWindowContext } from "@lichtblick/suite-base/components/PanelWindow";

/** Where a panel is shown right now: what it would get from the layout it is shown in. */
export type PanelSlot = {
  dock: NonNullable<ContextType<typeof DockPanelContext>>;
  /** The Tab panels the showing layout is nested in (see LayoutTabContext). */
  tabPath: readonly string[];
  /** The panel the showing layout is in (a Tab panel), if any. */
  parentPanel: ContextType<typeof PanelContext>;
  parentWindow: ContextType<typeof PanelWindowContext>;
  /** Whether the layout showing the panel can be seen (see PanelVisibleContext). */
  layoutVisible: boolean;
};

/**
 * Renders every panel of a window once, so a panel keeps running (and keeps its state) when it
 * moves between layouts, e.g. when stacking panels turns them into tabs of a Tab panel.
 */
export type PanelHost = {
  /** Show the panel in `slot`; returns the element to put where it is shown. */
  claim: (panelId: string, owner: object, slot: PanelSlot) => HTMLElement;
  /** `owner` no longer shows the panel. It keeps running for a moment, in case it moved. */
  release: (panelId: string, owner: object) => void;
};

export const PanelHostContext = createContext<PanelHost | undefined>(undefined);
PanelHostContext.displayName = "PanelHostContext";
