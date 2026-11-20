// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteSweep from "@mui/icons-material/DeleteSweep";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { Chip, IconButton, Typography } from "@mui/material";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useStylesPanelLogs } from "@lichtblick/suite-base/components/PanelLogs.style";
import { PanelLog, PanelLogLevel, PanelLogsProps } from "@lichtblick/suite-base/components/types";
import { MAX_HEIGHT, MIN_HEIGHT } from "@lichtblick/suite-base/constants/panelLogs";

/** Most severe first, the order the filter chips are shown in. */
const LEVELS: readonly PanelLogLevel[] = ["error", "warn", "info", "debug"];

/** Distance from the bottom (px) within which the list keeps following new entries. */
const FOLLOW_THRESHOLD = 24;

function formatLog(log: PanelLog): string {
  const repeat = (log.count ?? 1) > 1 ? ` (x${log.count})` : "";
  const stack = log.error ? `\n${log.error.stack ?? log.error.message}` : "";
  return `${log.timestamp} [${log.level.toUpperCase()}] ${log.message}${repeat}${stack}`;
}

export default function PanelLogs({
  logs,
  onClose,
  onClear,
  initialHeight = MAX_HEIGHT,
  onHeightChange,
}: PanelLogsProps): React.ReactElement {
  const { classes, cx } = useStylesPanelLogs();
  const { t } = useTranslation("panelLogs");
  const { enqueueSnackbar } = useSnackbar();
  const [height, setHeight] = useState(initialHeight);
  const [isDragging, setIsDragging] = useState(false);
  const [hiddenLevels, setHiddenLevels] = useState<ReadonlySet<PanelLogLevel>>(new Set());
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startYRef.current = e.clientY;
      startHeightRef.current = height;
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    },
    [height],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) {
        return;
      }

      const deltaY = startYRef.current - e.clientY;
      const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeightRef.current + deltaY));
      setHeight(newHeight);
    },
    [isDragging],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";

    // Save the height when dragging ends
    if (onHeightChange) {
      onHeightChange(height);
    }
  }, [height, onHeightChange]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
    return undefined;
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const levelCounts = useMemo(() => {
    const counts = new Map<PanelLogLevel, number>();
    for (const log of logs) {
      counts.set(log.level, (counts.get(log.level) ?? 0) + 1);
    }
    return counts;
  }, [logs]);

  const visibleLogs = useMemo(
    () => (hiddenLevels.size === 0 ? logs : logs.filter((log) => !hiddenLevels.has(log.level))),
    [hiddenLevels, logs],
  );

  const toggleLevel = useCallback((level: PanelLogLevel) => {
    setHiddenLevels((prev) => {
      const next = new Set(prev);
      if (!next.delete(level)) {
        next.add(level);
      }
      return next;
    });
  }, []);

  const copyLogs = useCallback(() => {
    navigator.clipboard.writeText(visibleLogs.map(formatLog).join("\n")).catch(() => {
      enqueueSnackbar(t("copyFailed"), { variant: "error" });
    });
  }, [enqueueSnackbar, t, visibleLogs]);

  // Keep the newest entry in view unless the user scrolled up to read older ones.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && followRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [visibleLogs]);

  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (list) {
      followRef.current =
        list.scrollHeight - list.scrollTop - list.clientHeight <= FOLLOW_THRESHOLD;
    }
  }, []);

  return (
    <div className={classes.root} style={{ height: `${height}px`, maxHeight: "none" }}>
      <div className={classes.resizeHandle} onMouseDown={handleMouseDown} title={t("resize")}>
        <DragIndicatorIcon className={classes.resizeIcon} />
      </div>

      <div className={classes.header}>
        <Typography variant="subtitle2" className={classes.title}>
          {t("title", { count: logs.length })}
        </Typography>
        <div className={classes.filters}>
          {LEVELS.map((level) => {
            const count = levelCounts.get(level);
            if (count == undefined) {
              return undefined;
            }
            const shown = !hiddenLevels.has(level);
            return (
              <Chip
                key={level}
                size="small"
                label={`${level.toUpperCase()} ${count}`}
                variant={shown ? "filled" : "outlined"}
                className={cx(classes.chip, shown && classes[`${level}Chip`])}
                aria-pressed={shown}
                title={t(shown ? "hideLevel" : "showLevel", { level })}
                onClick={() => {
                  toggleLevel(level);
                }}
              />
            );
          })}
        </div>
        <div className={classes.actions}>
          <IconButton
            size="small"
            onClick={copyLogs}
            title={t("copy")}
            disabled={visibleLogs.length === 0}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={onClear}
            title={t("clear")}
            disabled={logs.length === 0}
          >
            <DeleteSweep fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onClose} title={t("close")}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </div>
      </div>

      <div className={classes.listContainer} ref={listRef} onScroll={handleScroll} role="log">
        {logs.length === 0 ? (
          <div className={classes.empty}>
            <Typography variant="body2">{t("empty")}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t("emptyHint")}
            </Typography>
          </div>
        ) : visibleLogs.length === 0 ? (
          <div className={classes.empty}>
            <Typography variant="body2" color="text.secondary">
              {t("allFiltered")}
            </Typography>
          </div>
        ) : (
          visibleLogs.map((log) => (
            <div key={log.id} className={cx(classes.row, classes[`${log.level}Row`])}>
              <span className={cx(classes.level, classes[log.level])}>
                {log.level.toUpperCase()}
              </span>
              <div className={classes.body}>
                <span className={classes.message}>{log.message}</span>
                {log.error && (
                  <details className={classes.details}>
                    <summary>{t("stackTrace")}</summary>
                    <pre className={classes.stack}>{log.error.stack ?? log.error.message}</pre>
                  </details>
                )}
              </div>
              {(log.count ?? 1) > 1 && (
                <span className={classes.repeat} title={t("repeated", { count: log.count })}>
                  ×{log.count}
                </span>
              )}
              <span className={classes.time}>{log.timestamp}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
