// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { Immutable } from "@lichtblick/suite";
import { PANEL_FLOATING_TOOLBAR_HEIGHT } from "@lichtblick/suite-base/components/PanelToolbar/constants";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { parseColor, toHex8 } from "@lichtblick/suite-base/util/parseColor";

import type { PlotCoordinator } from "./PlotCoordinator";
import { PlotLegendAddRow, PlotLegendRow, ROW_HEIGHT } from "./PlotLegendRow";
import { PlotPath, PlotConfig } from "./utils/config";

const minLegendWidth = 25;
const maxLegendWidth = 800;

type Props = Immutable<{
  coordinator: PlotCoordinator | undefined;
  legendDisplay: "floating" | "top" | "left";
  onClickPath: (index: number) => void;
  paths: PlotPath[];
  saveConfig: SaveConfig<PlotConfig>;
  sidebarDimension: number;
  showValues: boolean;
  hoveredValuesBySeriesIndex?: string[];
  /** Whether series paths may end in a time-series modifier like `.@derivative` */
  supportsStreamModifiers: boolean;
}>;

const useStyles = makeStyles<void, "grid">()(({ palette, spacing }, _params, classes) => ({
  root: {
    display: "flex",
    overflow: "hidden",
  },
  rootFloating: {
    pointerEvents: "none",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    position: "absolute",
    inset: "0 0 0 0",
    height: "100%",
    width: "100%",
    overflow: "hidden",
    zIndex: 1000,
    gap: spacing(0.75),
    padding: spacing(1.5, 3.75, 4, 4.5),
    paddingTop: `calc(${spacing(1.5)} + ${PANEL_FLOATING_TOOLBAR_HEIGHT})`,

    [`.${classes.grid}`]: {
      pointerEvents: "auto",
      flex: "0 1 auto",
      width: "max-content",
      maxHeight: "100%",
      borderRadius: 8,
      gridTemplateColumns: "auto repeat(2, minmax(max-content, auto)) auto",
      backgroundColor: toHex8(parseColor(palette.background.paper).alpha(0.72)),
      backdropFilter: "blur(8px)",
      border: `1px solid ${palette.divider}`,
      boxShadow: "0 4px 16px rgb(0 0 0 / 0.18)",

      "&:not(:hover, :focus-within) [data-hide-when-idle]": {
        display: "none",
      },
    },
  },
  rootLeft: {
    alignItems: "flex-start",
    maxWidth: "80%",
    paddingTop: PANEL_FLOATING_TOOLBAR_HEIGHT,

    [`.${classes.grid}`]: {
      overflow: "auto",
      height: "100%",
      alignContent: "flex-start",
    },
  },
  rootTop: {
    flexDirection: "column",
    maxHeight: "80%",
    paddingTop: PANEL_FLOATING_TOOLBAR_HEIGHT,
  },
  grid: {
    alignItems: "center",
    display: "grid",
    gridTemplateColumns: "auto repeat(2, minmax(max-content, 1fr)) auto",
    gridAutoRows: ROW_HEIGHT,
    width: "100%",
    columnGap: 1,
    overflow: "auto",
    justifyItems: "flex-start",
  },
  dragHandle: {
    userSelect: "none",
    border: `0px solid ${palette.action.hover}`,

    "&:hover": {
      borderColor: palette.action.selected,
    },
  },
}));

const emptyPaths: string[] = [];

function PlotLegendComponent(props: Props): React.JSX.Element {
  const {
    coordinator,
    legendDisplay,
    onClickPath,
    paths,
    saveConfig,
    sidebarDimension,
    showValues,
    hoveredValuesBySeriesIndex,
    supportsStreamModifiers,
  } = props;
  // The row whose path is edited inline, or "new" for the add row
  const [editing, setEditing] = useState<number | "new">();
  const gridRef = useRef<HTMLDivElement>(null);
  const endEdit = useCallback(() => {
    setEditing(undefined);
    // The wide input may have scrolled a narrow legend sideways
    if (gridRef.current) {
      gridRef.current.scrollLeft = 0;
    }
  }, []);
  const { classes, cx } = useStyles();

  const dragStart = useRef({ x: 0, y: 0, sidebarDimension: 0 });

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (legendDisplay === "floating" || event.buttons !== 1) {
        return;
      }
      const delta =
        legendDisplay === "left"
          ? event.clientX - dragStart.current.x
          : event.clientY - dragStart.current.y;
      const newDimension = _.clamp(
        dragStart.current.sidebarDimension + delta,
        minLegendWidth,
        maxLegendWidth,
      );
      saveConfig({ sidebarDimension: newDimension });
    },
    [legendDisplay, saveConfig],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStart.current = { x: event.clientX, y: event.clientY, sidebarDimension };
    },
    [sidebarDimension],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const savePaths = useCallback(
    (newPaths: PlotPath[]) => {
      saveConfig({ paths: newPaths });
    },
    [saveConfig],
  );

  const [pathsWithMismatchedDataLengths, setPathsWithMismatchedDataLengths] =
    useState<string[]>(emptyPaths);
  useEffect(() => {
    if (!coordinator) {
      return;
    }
    const handler = (newPaths: readonly string[]) => {
      // Emitted on every downsample, usually with the same (empty) list; keep the old array so
      // the legend and all its rows don't re-render.
      setPathsWithMismatchedDataLengths((prev) =>
        prev.length === newPaths.length && sameValues(prev, newPaths) ? prev : newPaths.slice(),
      );
    };
    coordinator.on("pathsWithMismatchedDataLengthsChanged", handler);
    return () => {
      coordinator.off("pathsWithMismatchedDataLengthsChanged", handler);
      setPathsWithMismatchedDataLengths(emptyPaths);
    };
  }, [coordinator]);

  const [currentValuesBySeriesIndex, setCurrentValuesBySeriesIndex] = useState<
    unknown[] | undefined
  >();
  useEffect(() => {
    if (!coordinator || !showValues) {
      return;
    }
    const handler = (values: readonly unknown[]) => {
      // Emitted every frame; keep the old array when no value changed, so the legend doesn't re-render.
      setCurrentValuesBySeriesIndex((prev) =>
        // An index loop, not every(): every() skips holes, which mark series without a value.
        prev?.length === values.length && sameValues(prev, values) ? prev : values.slice(),
      );
    };
    coordinator.on("currentValuesChanged", handler);
    return () => {
      coordinator.off("currentValuesChanged", handler);
      setCurrentValuesBySeriesIndex(undefined);
    };
  }, [coordinator, showValues]);

  const valuesBySeriesIndex = hoveredValuesBySeriesIndex ?? currentValuesBySeriesIndex;
  const valueSource = hoveredValuesBySeriesIndex ? "hover" : "current";

  return (
    <div
      className={cx(classes.root, {
        [classes.rootFloating]: legendDisplay === "floating",
        [classes.rootLeft]: legendDisplay === "left",
        [classes.rootTop]: legendDisplay === "top",
      })}
    >
      <div
        ref={gridRef}
        className={classes.grid}
        style={{
          height: legendDisplay === "top" ? Math.round(sidebarDimension) : undefined,
          width: legendDisplay === "left" ? Math.round(sidebarDimension) : undefined,
        }}
      >
        {paths.map((path, index) => (
          <PlotLegendRow
            editing={editing === index}
            onStartEdit={() => {
              setEditing(index);
            }}
            onEndEdit={endEdit}
            supportsStreamModifiers={supportsStreamModifiers}
            hasMismatchedDataLength={pathsWithMismatchedDataLengths.includes(path.value)}
            index={index}
            key={index}
            onClickPath={() => {
              onClickPath(index);
            }}
            path={path}
            paths={paths}
            savePaths={savePaths}
            value={valuesBySeriesIndex?.[index]}
            valueSource={valueSource}
          />
        ))}
        <PlotLegendAddRow
          editing={editing === "new"}
          hideWhenIdle={paths.length > 0}
          onStartEdit={() => {
            setEditing("new");
          }}
          onEndEdit={endEdit}
          onAdd={(values) => {
            savePaths([
              ...paths,
              ...values.map((value) => ({
                value,
                enabled: true,
                timestampMethod: "receiveTime" as const,
              })),
            ]);
          }}
          supportsStreamModifiers={supportsStreamModifiers}
        />
      </div>
      {legendDisplay !== "floating" && (
        <div
          className={classes.dragHandle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={
            legendDisplay === "left"
              ? {
                  marginLeft: -6,
                  cursor: "ew-resize",
                  borderRightWidth: 2,
                  height: "100%",
                  width: 4,
                }
              : {
                  marginTop: -6,
                  cursor: "ns-resize",
                  borderBottomWidth: 2,
                  width: "100%",
                  height: 4,
                }
          }
        />
      )}
    </div>
  );
}

export const PlotLegend = React.memo(PlotLegendComponent);

function sameValues(a: readonly unknown[], b: readonly unknown[]): boolean {
  for (let i = 0; i < b.length; i++) {
    if (!Object.is(a[i], b[i])) {
      return false;
    }
  }
  return true;
}
