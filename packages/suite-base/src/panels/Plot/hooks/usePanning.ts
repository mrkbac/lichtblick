// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect } from "react";

import { PlotCoordinator } from "@lichtblick/suite-base/panels/Plot/PlotCoordinator";
import { listenForPan } from "@lichtblick/suite-base/util/listenForPan";

const usePanning = (
  canvasDiv: HTMLDivElement | null,
  coordinator: PlotCoordinator | undefined,
  draggingRef: React.RefObject<boolean>,
): void => {
  useEffect(() => {
    if (!canvasDiv || !coordinator) {
      return;
    }

    return listenForPan(canvasDiv, 10, {
      onStart: ({ deltaX, deltaY }) => {
        draggingRef.current = true;
        coordinator.addInteractionEvent({ type: "panstart", deltaX, deltaY });
      },
      onMove: ({ deltaX, deltaY }) => {
        coordinator.addInteractionEvent({ type: "panmove", deltaX, deltaY });
      },
      onEnd: () => {
        coordinator.addInteractionEvent({ type: "panend" });
        // We need to do this a little bit later so that the onClick handler still sees
        // draggingRef.current===true and can skip the seek.
        setTimeout(() => {
          draggingRef.current = false;
        }, 0);
      },
    });
  }, [canvasDiv, coordinator, draggingRef]);
};

export default usePanning;
