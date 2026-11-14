// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { CompareSideInfo, CompareState } from "./CompareContext";

/** Panel config key holding how the panel shows compared recordings */
export const COMPARE_VIEW_CONFIG_KEY = "compareView";

/** How a panel showing every side lays them out (panels that draw sides themselves ignore it) */
export type CompareLayout = "split" | "swipe" | "blend" | "difference";

export type CompareView = {
  /**
   * "follow": the side chosen for the whole layout; "all": every side; else a side's prefix
   * (e.g. "/b"). Unset is "all" for panels that draw every side themselves, else "follow".
   */
  show?: string;
  layout?: CompareLayout;
};

/**
 * How a panel type takes part in a comparison:
 * - native: draws every side itself (reads `useCompare()` and the topics of every side)
 * - copies: shows one side, or every side as one copy of the panel per side
 * - none: not about recorded topics, shown as is
 */
export type CompareSupport = {
  mode: "native" | "copies" | "none";
  /** Copies can be laid over each other (swipe, blend, difference), for panels showing pictures */
  overlay: boolean;
};

const NATIVE = new Set(["Plot", "StateTransitions"]);
const NONE = new Set([
  "CallService",
  "GlobalVariableSliderPanel",
  "NodePlayground",
  "Notes",
  "Parameters",
  "PlaybackPerformance",
  "Publish",
  // Data source info has its own comparison of the recordings
  "SourceInfo",
  "Tab",
  "Teleop",
]);
const OVERLAY = new Set(["3D", "CameraGrid", "Image", "map"]);

export function compareSupport(panelType: string): CompareSupport {
  return {
    mode: NATIVE.has(panelType) ? "native" : NONE.has(panelType) ? "none" : "copies",
    overlay: OVERLAY.has(panelType),
  };
}

export type ResolvedCompareView =
  | { kind: "side"; side: CompareSideInfo; followed: boolean }
  | { kind: "all"; layout: CompareLayout };

/** What a panel of `support` with `view` shows of `compare` */
export function resolveCompareView(
  view: CompareView | undefined,
  support: CompareSupport,
  compare: CompareState,
): ResolvedCompareView {
  const show = view?.show ?? (support.mode === "native" ? "all" : "follow");
  if (show === "all") {
    const layout = view?.layout ?? "split";
    return { kind: "all", layout: support.overlay || layout === "split" ? layout : "split" };
  }
  const chosen = compare.sides.find((side) => side.prefix === show);
  const active = compare.sides.find((side) => side.prefix === compare.activeSide);
  return {
    kind: "side",
    side: chosen ?? active ?? compare.sides[0]!,
    followed: chosen == undefined,
  };
}
