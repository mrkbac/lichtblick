// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Slider } from "@mui/material";
import { createContext, useCallback, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { PANEL_TOOLBAR_MIN_HEIGHT } from "@lichtblick/suite-base/components/PanelToolbar/constants";

import { CompareSideInfo, CompareState, SideScope, useCompare } from "./CompareContext";
import {
  COMPARE_VIEW_CONFIG_KEY,
  CompareSupport,
  CompareView,
  compareSupport,
  resolveCompareView,
} from "./compareView";

/** Set for the extra copies of a panel showing every side: they hide their toolbar */
export const CompareCopyContext = createContext<{ secondary: boolean }>({ secondary: false });

const useStyles = makeStyles()((theme) => ({
  fill: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  split: {
    display: "flex",
    flex: "1 1 auto",
    minHeight: 0,
    gap: 2,
    backgroundColor: theme.palette.divider,
  },
  layer: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    pointerEvents: "none",
  },
  badge: {
    position: "absolute",
    bottom: theme.spacing(0.75),
    zIndex: 2,
    padding: theme.spacing(0, 0.75),
    borderRadius: theme.shape.borderRadius,
    color: "#000",
    fontSize: theme.typography.caption.fontSize,
    fontWeight: 600,
    lineHeight: 1.6,
    maxWidth: "45%",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    pointerEvents: "none",
    opacity: 0.9,
  },
  handle: {
    position: "absolute",
    top: PANEL_TOOLBAR_MIN_HEIGHT,
    bottom: 0,
    width: 16,
    marginLeft: -8,
    zIndex: 3,
    cursor: "ew-resize",
    touchAction: "none",
    "&::after": {
      content: '""',
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 7,
      width: 2,
      backgroundColor: theme.palette.common.white,
      boxShadow: "0 0 3px rgba(0,0,0,0.6)",
    },
  },
  mix: {
    position: "absolute",
    bottom: theme.spacing(0.5),
    left: "50%",
    transform: "translateX(-50%)",
    width: 160,
    zIndex: 3,
    padding: theme.spacing(0, 1.5),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.background.paper,
    opacity: 0.85,
  },
}));

function SideBadge({ side, align }: { side: CompareSideInfo; align: "left" | "right" }) {
  const { classes } = useStyles();
  return (
    <div
      className={classes.badge}
      style={{ backgroundColor: side.color, [align]: 6 }}
      title={side.name}
    >
      {side.label} · {side.name}
    </div>
  );
}

type Props = {
  compare: CompareState;
  support: CompareSupport;
  view: CompareView | undefined;
  /** The panel itself */
  panel: React.ReactNode;
  /** A read-only copy of the panel, for the other sides */
  copy: React.ReactNode;
};

/** A panel while recordings are compared: one side, or every side next to or over each other */
export function ComparedPanel({ compare, support, view, panel, copy }: Props): React.JSX.Element {
  const { classes } = useStyles();
  const resolved = resolveCompareView(view, support, compare);
  const [mix, setMix] = useState(0.5);
  const containerRef = useRef<HTMLDivElement>(null);

  const onSwipe = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.buttons === 0 && event.type === "pointermove") {
      return;
    }
    if (event.type === "pointerdown") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0) {
      setMix(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
    }
  }, []);

  if (resolved.kind === "side") {
    return <SideScope side={resolved.side}>{panel}</SideScope>;
  }
  if (support.mode === "native") {
    return <>{panel}</>;
  }

  const secondary = (side: CompareSideInfo) => (
    <CompareCopyContext.Provider value={{ secondary: true }}>
      <SideScope side={side}>{copy}</SideScope>
    </CompareCopyContext.Provider>
  );

  if (resolved.layout === "split") {
    return (
      <div className={classes.split}>
        {compare.sides.map((side, index) => (
          <div key={side.prefix} className={classes.fill}>
            {index === 0 ? <SideScope side={side}>{panel}</SideScope> : secondary(side)}
            <SideBadge side={side} align="left" />
          </div>
        ))}
      </div>
    );
  }

  // Overlays: the second side is drawn over the first, below the toolbar. All input goes to the
  // first side; the copy follows its config.
  const [bottom, top] = compare.sides as [CompareSideInfo, CompareSideInfo];
  const percent = `${(mix * 100).toFixed(2)}%`;
  const layerStyle: React.CSSProperties =
    resolved.layout === "swipe"
      ? { clipPath: `inset(${PANEL_TOOLBAR_MIN_HEIGHT}px 0 0 ${percent})` }
      : resolved.layout === "blend"
        ? { clipPath: `inset(${PANEL_TOOLBAR_MIN_HEIGHT}px 0 0 0)`, opacity: mix }
        : { clipPath: `inset(${PANEL_TOOLBAR_MIN_HEIGHT}px 0 0 0)`, mixBlendMode: "difference" };
  return (
    <div ref={containerRef} className={classes.fill} style={{ isolation: "isolate" }}>
      <SideScope side={bottom}>{panel}</SideScope>
      <div className={classes.layer} style={layerStyle}>
        {secondary(top)}
      </div>
      <SideBadge side={bottom} align="left" />
      <SideBadge side={top} align="right" />
      {resolved.layout === "swipe" && (
        <div
          className={classes.handle}
          style={{ left: percent }}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(mix * 100)}
          aria-label={`${bottom.label} / ${top.label}`}
          tabIndex={0}
          onPointerDown={onSwipe}
          onPointerMove={onSwipe}
          onKeyDown={(event) => {
            const step = event.key === "ArrowLeft" ? -0.02 : event.key === "ArrowRight" ? 0.02 : 0;
            if (step !== 0) {
              event.preventDefault();
              setMix((value) => Math.min(1, Math.max(0, value + step)));
            }
          }}
        />
      )}
      {resolved.layout === "blend" && (
        <div className={classes.mix}>
          <Slider
            size="small"
            min={0}
            max={1}
            step={0.01}
            value={mix}
            aria-label={`${bottom.label} / ${top.label}`}
            onChange={(_event, value) => {
              setMix(value);
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Shows the side a panel shows (its first one when it shows every side) to the panel's settings,
 * so path inputs offer `/odom` rather than `/a/odom` and `/b/odom`.
 */
export function PanelSideScope({
  panelType,
  config,
  children,
}: {
  panelType: string | undefined;
  config: Record<string, unknown> | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const compare = useCompare();
  const support = panelType != undefined ? compareSupport(panelType, config) : undefined;
  if (!compare || !support || support.mode === "none") {
    return <>{children}</>;
  }
  const resolved = resolveCompareView(
    config?.[COMPARE_VIEW_CONFIG_KEY] as CompareView | undefined,
    support,
    compare,
  );
  const side =
    resolved.kind === "side"
      ? resolved.side
      : (compare.sides.find((item) => item.prefix === compare.activeSide) ?? compare.sides[0]!);
  return <SideScope side={side}>{children}</SideScope>;
}
