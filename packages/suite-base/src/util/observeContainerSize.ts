// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { DockviewApi } from "dockview-react";

/** Lay out before paint; Dockview's automatic resizing adds a frame at every nested Tab layout. */
export function observeContainerSize(
  element: HTMLElement,
  api: Pick<DockviewApi, "width" | "height" | "layout">,
): () => void {
  const observer = new ResizeObserver(([entry]) => {
    // Hidden tabs must keep their split sizes until they become visible again.
    if (!entry || !element.isConnected || !element.offsetParent) {
      return;
    }
    const width = Math.round(entry.contentRect.width);
    const height = Math.round(entry.contentRect.height);
    if (width === api.width && height === api.height) {
      return;
    }
    api.layout(width, height);
  });
  observer.observe(element);
  return () => {
    observer.disconnect();
  };
}
