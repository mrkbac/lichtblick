// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Suspense, lazy } from "react";
import { create } from "zustand";

/** Whether the panel guide is open, and at which panel. */
export const usePanelGuideStore = create<{
  open: boolean;
  panelType: string | undefined;
  show: (panelType?: string) => void;
  hide: () => void;
}>()((set) => ({
  open: false,
  panelType: undefined,
  show: (panelType) => {
    set((state) => ({ open: true, panelType: panelType ?? state.panelType }));
  },
  hide: () => {
    set({ open: false });
  },
}));

// The guide (docs of every panel) only loads when it is opened: kept out of the startup bundle
const PanelGuideDialog = lazy(async () => ({
  default: (await import("./PanelDocs")).PanelGuideDialog,
}));

/** Mounts the panel guide; it only renders while open. */
export function PanelGuide(): React.JSX.Element {
  const open = usePanelGuideStore((state) => state.open);
  return (
    <>
      {open && (
        <Suspense fallback={undefined}>
          <PanelGuideDialog />
        </Suspense>
      )}
    </>
  );
}
