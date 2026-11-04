// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useState } from "react";
import { makeStyles } from "tss-react/mui";

import { zoomModeForModifiers } from "./hooks/usePlotInteractionHandlers";
import { PixelRect, ZoomMode } from "./types";

/** Drags shorter than this are clicks, not zooms */
const MIN_DRAG_PX = 4;

const useStyles = makeStyles()((theme) => ({
  root: {
    position: "absolute",
    inset: 0,
    cursor: "zoom-in",
    touchAction: "none",
  },
  rect: {
    position: "absolute",
    pointerEvents: "none",
    border: `1px solid ${theme.palette.primary.main}`,
    backgroundColor: `${theme.palette.primary.main}22`,
  },
}));

type Drag = { startX: number; startY: number; x: number; y: number; mode: ZoomMode };

export type BoxZoomOverlayProps = {
  onZoom: (rect: PixelRect, mode: ZoomMode) => void;
  onWheel: (event: React.WheelEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
};

/** Box zoom tool: drag a rectangle to zoom to it. Alt/Option zooms only x, Shift only y. */
export function BoxZoomOverlay({
  onZoom,
  onWheel,
  onDoubleClick,
}: BoxZoomOverlayProps): React.JSX.Element {
  const { classes } = useStyles();
  const [drag, setDrag] = useState<Drag | undefined>();

  const position = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = position(event);
    setDrag({ startX: x, startY: y, x, y, mode: zoomModeForModifiers(event) ?? "xy" });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) {
      return;
    }
    const { x, y } = position(event);
    setDrag({ ...drag, x, y, mode: zoomModeForModifiers(event) ?? "xy" });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(undefined);
    const rect = toRect(drag);
    if (rect.right - rect.left >= MIN_DRAG_PX || rect.bottom - rect.top >= MIN_DRAG_PX) {
      onZoom(rect, drag.mode);
    }
  };

  const rect = drag ? toRect(drag) : undefined;

  return (
    <div
      className={classes.root}
      data-testid="plot-box-zoom-overlay"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        setDrag(undefined);
      }}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
    >
      {drag && rect != undefined && (
        <div
          className={classes.rect}
          style={{
            // An x-only zoom spans the full height and a y-only zoom the full width.
            left: drag.mode === "y" ? 0 : rect.left,
            width: drag.mode === "y" ? "100%" : rect.right - rect.left,
            top: drag.mode === "x" ? 0 : rect.top,
            height: drag.mode === "x" ? "100%" : rect.bottom - rect.top,
          }}
        />
      )}
    </div>
  );
}

function toRect(drag: Drag): PixelRect {
  return {
    left: Math.min(drag.startX, drag.x),
    right: Math.max(drag.startX, drag.x),
    top: Math.min(drag.startY, drag.y),
    bottom: Math.max(drag.startY, drag.y),
  };
}
