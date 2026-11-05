// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import LibraryAddOutlinedIcon from "@mui/icons-material/LibraryAddOutlined";
import { IconButton, Tooltip } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useStyles } from "./Watch.style";
import { HISTORY_SIZE, WatchStore, historyValues } from "./WatchStore";
import { WatchRow } from "./config";
import { EnumNames, formatExpanded, formatValue, isExpandable } from "./format";

export const DRAG_TYPE = "application/x-lichtblick-watch-row";
const FLASH_MS = 600;

/** Called by the panel once per animation frame for rows whose value changed. */
export type Painters = Map<string, () => void>;

export type RowAction = "openInPlot" | "copy" | "duplicate" | "remove";

type Props = {
  row: WatchRow;
  store: WatchStore;
  painters: Painters;
  enumNames: EnumNames | undefined;
  invalid: boolean;
  sparklines: boolean;
  isDropTarget: boolean;
  onAction: (action: RowAction, id: string) => void;
  onDragOverRow: (id: string) => void;
  onDropRow: (fromId: string, toId: string) => void;
};

function drawSparkline(canvas: HTMLCanvasElement, values: readonly number[], color: string): void {
  const dpr = window.devicePixelRatio;
  const width = Math.round(canvas.clientWidth * dpr);
  const height = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, width, height);
  if (values.length < 2) {
    return;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const range = max === min ? 1 : max - min;
  const pad = dpr;
  const step = width / (HISTORY_SIZE - 1);
  const offset = width - (values.length - 1) * step; // newest value at the right edge
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = offset + i * step;
    // A flat line is drawn in the middle
    const y = max === min ? height / 2 : pad + (1 - (v - min) / range) * (height - 2 * pad);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = dpr;
  ctx.stroke();
}

export const WatchRowView = memo(function WatchRowViewInner({
  row,
  store,
  painters,
  enumNames,
  invalid,
  sparklines,
  isDropTarget,
  onAction,
  onDragOverRow,
  onDropRow,
}: Props): React.JSX.Element {
  const { t } = useTranslation("watch");
  const { classes, cx } = useStyles();
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const rootRef = useRef<HTMLDivElement>(ReactNull);
  const valueRef = useRef<HTMLSpanElement>(ReactNull);
  const sparkRef = useRef<HTMLCanvasElement>(ReactNull);
  const expandedRef = useRef<HTMLPreElement>(ReactNull);
  const hadValue = useRef(false);

  const flashColor = alpha(theme.palette.primary.main, 0.2);
  const lineColor = theme.palette.primary.main;

  // Writes straight to the DOM: values change far more often than React should render
  const paint = useCallback(() => {
    const root = rootRef.current;
    const valueEl = valueRef.current;
    if (!root || !valueEl) {
      return;
    }
    const state = store.get(row.id);
    const value = state?.value;
    const error = state?.error;
    const text = error ?? formatValue(value, row.precision, enumNames);
    if (valueEl.textContent !== text) {
      valueEl.textContent = text;
      valueEl.title = text;
      // Flash changes, but not the first value after adding a row or seeking
      if (hadValue.current && value != undefined && typeof root.animate === "function") {
        root.animate([{ backgroundColor: flashColor }, { backgroundColor: "transparent" }], {
          duration: FLASH_MS,
          easing: "ease-out",
        });
      }
    }
    hadValue.current = value != undefined;
    root.dataset.error = String(error != undefined);
    root.dataset.expandable = String(isExpandable(value));
    if (sparkRef.current) {
      drawSparkline(sparkRef.current, state ? historyValues(state) : [], lineColor);
    }
    if (expandedRef.current) {
      expandedRef.current.textContent = isExpandable(value) ? formatExpanded(value) : text;
    }
  }, [enumNames, flashColor, lineColor, row.id, row.precision, store]);

  useLayoutEffect(() => {
    painters.set(row.id, paint);
    paint();
    return () => {
      painters.delete(row.id);
    };
  }, [expanded, paint, painters, row.id, sparklines]);

  const onDragStart = useCallback(
    (event: React.DragEvent) => {
      event.dataTransfer.setData(DRAG_TYPE, row.id);
      event.dataTransfer.effectAllowed = "move";
    },
    [row.id],
  );
  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      if (event.dataTransfer.types.includes(DRAG_TYPE)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOverRow(row.id);
      }
    },
    [onDragOverRow, row.id],
  );
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const fromId = event.dataTransfer.getData(DRAG_TYPE);
      if (fromId) {
        event.preventDefault();
        onDropRow(fromId, row.id);
      }
    },
    [onDropRow, row.id],
  );

  return (
    <>
      <div
        ref={rootRef}
        className={cx(classes.row, { [classes.dropTarget]: isDropTarget })}
        data-testid="watch-row"
        data-expandable="false"
        data-expanded={expanded}
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <IconButton
          data-expand
          size="small"
          className={classes.expandButton}
          aria-label={expanded ? t("collapse") : t("expand")}
          onClick={() => {
            setExpanded((prev) => !prev);
          }}
        >
          {expanded ? (
            <KeyboardArrowDownIcon fontSize="small" />
          ) : (
            <KeyboardArrowRightIcon fontSize="small" />
          )}
        </IconButton>
        <Tooltip title={invalid ? t("invalidPath") : `${row.path} — ${t("openInPlot")}`}>
          <span
            role="button"
            tabIndex={0}
            className={cx(classes.name, { [classes.invalid]: invalid })}
            onClick={() => {
              onAction("openInPlot", row.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onAction("openInPlot", row.id);
              }
            }}
          >
            {row.label ?? row.path}
          </span>
        </Tooltip>
        <span ref={valueRef} data-value className={classes.value} />
        {row.unit != undefined && <span className={classes.unit}>{row.unit}</span>}
        {sparklines && <canvas ref={sparkRef} className={classes.sparkline} />}
        <span data-actions className={classes.actions}>
          <Tooltip title={t("copyValue")}>
            <IconButton
              size="small"
              onClick={() => {
                onAction("copy", row.id);
              }}
            >
              <ContentCopyIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("duplicate")}>
            <IconButton
              size="small"
              onClick={() => {
                onAction("duplicate", row.id);
              }}
            >
              <LibraryAddOutlinedIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("remove")}>
            <IconButton
              size="small"
              onClick={() => {
                onAction("remove", row.id);
              }}
            >
              <DeleteOutlineIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </span>
      </div>
      {expanded && <pre ref={expandedRef} className={classes.expanded} />}
    </>
  );
});
