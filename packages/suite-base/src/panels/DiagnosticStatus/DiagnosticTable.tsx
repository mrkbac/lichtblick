// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import PowerInputIcon from "@mui/icons-material/PowerInput";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import { IconButton, Tooltip, Typography } from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import CopyButton from "@lichtblick/suite-base/components/CopyButton";
import {
  useStyles,
  VALUE_FLASH_MS,
} from "@lichtblick/suite-base/panels/DiagnosticStatus/DiagnosticTable.style";
import { MIN_SPLIT_FRACTION } from "@lichtblick/suite-base/panels/DiagnosticStatus/constants";
import {
  DiagnosticInfo,
  FormattedKeyValue,
} from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import { getFormattedKeyValues } from "@lichtblick/suite-base/panels/DiagnosticStatus/utils/getFormattedKeyValues";
import { isFloatOrInteger } from "@lichtblick/suite-base/panels/DiagnosticStatus/utils/isFloaterOrInteger";
import { useLevelSince } from "@lichtblick/suite-base/panels/DiagnosticSummary/DiagnosticNodeRow";
import DiagnosticTimeline from "@lichtblick/suite-base/panels/DiagnosticSummary/DiagnosticTimeline";
import { MESSAGE_COLORS } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import { TimelineRange } from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticsPanelData";
import { HistoryById } from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/history";
import { openSiblingPlotPanel } from "@lichtblick/suite-base/panels/Plot/utils/openSiblingPlotPanel";
import { openSiblingStateTransitionsPanel } from "@lichtblick/suite-base/panels/StateTransitions/openSiblingStateTransitionsPanel";
import { OpenSiblingPanel } from "@lichtblick/suite-base/types/panels";

type Row =
  | { kind: "header" | "message"; key: string; info: DiagnosticInfo }
  | { kind: "value"; key: string; info: DiagnosticInfo; kv: FormattedKeyValue };

/** Last value of a key and when it last changed (performance.now()). */
type ValueChange = { value: string; previous?: string; changedAt: number };

export type DiagnosticTableProps = {
  /** Statuses to show, in display order. */
  infos: readonly DiagnosticInfo[];
  history: HistoryById;
  range: TimelineRange | undefined;
  staleSec: number;
  onSeek?: (seconds: number) => void;
  numericPrecision: number | undefined;
  splitFraction: number | undefined;
  onChangeSplitFraction: (splitFraction: number) => void;
  openSiblingPanel: OpenSiblingPanel;
};

const statusPath = (info: DiagnosticInfo) =>
  `${info.topic}.status[:]{hardware_id=="${info.status.hardware_id}"}{name=="${info.status.name}"}`;

export function formatValue(value: string, numericPrecision: number | undefined): string {
  return numericPrecision != undefined && isFloatOrInteger(value)
    ? parseFloat(value).toFixed(numericPrecision)
    : value;
}

/** Key/value rows of one or more statuses in a single virtualized list, so huge tables stay fast. */
export default function DiagnosticTable(props: DiagnosticTableProps): React.JSX.Element {
  const {
    infos,
    history,
    range,
    staleSec,
    onSeek,
    numericPrecision,
    splitFraction = 0.5,
    onChangeSplitFraction,
    openSiblingPanel,
  } = props;
  const { classes, cx } = useStyles();
  const { t } = useTranslation("diagnostics");
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track value changes across messages to highlight what just changed.
  const changesRef = useRef(new Map<string, ValueChange>());
  const rows = useMemo(() => {
    const now = performance.now();
    const changes = changesRef.current;
    const out: Row[] = [];
    for (const info of infos) {
      out.push({ kind: "header", key: `${info.id}|h`, info });
      out.push({ kind: "message", key: `${info.id}|m`, info });
      getFormattedKeyValues(info.status).forEach((kv, index) => {
        const key = `${info.id}|v|${index}|${kv.key}`;
        const prev = changes.get(key);
        if (!prev) {
          changes.set(key, { value: kv.value, changedAt: -Infinity });
        } else if (prev.value !== kv.value) {
          changes.set(key, { value: kv.value, previous: prev.value, changedAt: now });
        }
        out.push({ kind: "value", key, info, kv });
      });
    }
    return out;
  }, [infos]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 10,
    getItemKey: (index) => rows[index]!.key,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  const [resizing, setResizing] = useState(false);
  const resizeMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!rootRef.current) {
        return;
      }
      const { left, right } = rootRef.current.getBoundingClientRect();
      onChangeSplitFraction(
        _.clamp(
          (event.clientX - left) / (right - left),
          MIN_SPLIT_FRACTION,
          1 - MIN_SPLIT_FRACTION,
        ),
      );
    },
    [onChangeSplitFraction],
  );
  useEffect(() => {
    if (!resizing) {
      return undefined;
    }
    const stop = () => {
      setResizing(false);
    };
    window.addEventListener("mousemove", resizeMouseMove);
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mousemove", resizeMouseMove);
      window.removeEventListener("mouseup", stop);
    };
  }, [resizeMouseMove, resizing]);

  const now = performance.now();
  const gridTemplateColumns = `${100 * splitFraction}% 1fr`;

  const renderRow = (row: Row): React.ReactNode => {
    const { info } = row;
    const color = MESSAGE_COLORS[info.status.level];
    switch (row.kind) {
      case "header":
        return (
          <HeaderCell
            info={info}
            history={history}
            range={range}
            staleSec={staleSec}
            onSeek={onSeek}
          />
        );
      case "message":
        return (
          <div className={cx(classes.cell, classes.fullWidth)}>
            <Typography
              className={classes.valueText}
              color={color}
              variant="inherit"
              style={{ fontWeight: 800 }}
            >
              {info.status.message || "\xa0"}
            </Typography>
            <IconButton
              className={classes.iconButton}
              title={t("openInStateTransitions")}
              size="small"
              onClick={() => {
                openSiblingStateTransitionsPanel(openSiblingPanel, `${statusPath(info)}.message`);
              }}
            >
              <PowerInputIcon fontSize="inherit" />
            </IconButton>
          </div>
        );
      case "value": {
        const { key, value, keyHtml, valueHtml } = row.kv;
        const change = changesRef.current.get(row.key);
        const age = change ? now - change.changedAt : Infinity;
        const valuePath = `${statusPath(info)}.values[:]{key=="${key}"}.value`;
        const isNumber = value.length > 0 && !isNaN(Number(value));
        return (
          <>
            {keyHtml ? (
              <div
                className={cx(classes.cell, classes.keyCell, classes.htmlCell)}
                dangerouslySetInnerHTML={keyHtml}
              />
            ) : (
              <div className={cx(classes.cell, classes.keyCell)}>{key || "\xa0"}</div>
            )}
            <div
              className={cx(classes.cell, { [classes.flash]: age < VALUE_FLASH_MS })}
              // Resume the fade where it was if the row re-mounts (e.g. while scrolling).
              style={age < VALUE_FLASH_MS ? { animationDelay: `-${age}ms` } : undefined}
              title={
                change?.previous != undefined
                  ? t("previousValue", { value: change.previous })
                  : undefined
              }
              data-testid={age < VALUE_FLASH_MS ? "diagnostic-value-changed" : undefined}
            >
              {valueHtml ? (
                <div
                  className={cx(classes.valueText, classes.htmlCell)}
                  dangerouslySetInnerHTML={valueHtml}
                />
              ) : (
                <span className={classes.valueText}>
                  {formatValue(value, numericPrecision) || "\xa0"}
                </span>
              )}
              {value.length > 0 && (
                <>
                  <CopyButton
                    className={classes.iconButton}
                    size="small"
                    iconSize="small"
                    color="inherit"
                    aria-label={t("copyValue")}
                    getText={() => value}
                  />
                  <IconButton
                    className={classes.iconButton}
                    title={isNumber ? t("openInPlot") : t("openInStateTransitions")}
                    color="inherit"
                    size="small"
                    data-testid={isNumber ? "open-plot-button" : "open-state-transitions-button"}
                    onClick={() => {
                      if (isNumber) {
                        openSiblingPlotPanel(openSiblingPanel, valuePath);
                      } else {
                        openSiblingStateTransitionsPanel(openSiblingPanel, valuePath);
                      }
                    }}
                  >
                    {isNumber ? (
                      <ShowChartIcon fontSize="inherit" />
                    ) : (
                      <PowerInputIcon fontSize="inherit" />
                    )}
                  </IconButton>
                </>
              )}
            </div>
          </>
        );
      }
    }
  };

  return (
    <div className={classes.root} ref={rootRef}>
      <div
        className={classes.resizeHandle}
        style={{ left: `${100 * splitFraction}%` }}
        onMouseDown={(event) => {
          setResizing(true);
          event.preventDefault();
        }}
        data-testid="DiagnosticTable-resizeHandle"
      />
      <div className={classes.scroller} ref={scrollRef} data-testid="filtered-diagnostics">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={cx(classes.row, { [classes.headerRow]: row.kind === "header" })}
                style={{ transform: `translateY(${item.start}px)`, gridTemplateColumns }}
              >
                {renderRow(row)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HeaderCell(props: {
  info: DiagnosticInfo;
  history: HistoryById;
  range: TimelineRange | undefined;
  staleSec: number;
  onSeek?: (seconds: number) => void;
}): React.JSX.Element {
  const { info, history, range, staleSec, onSeek } = props;
  const { classes, cx } = useStyles();
  const { t } = useTranslation("diagnostics");
  const checkHistory = history.get(info.id);
  const levelSince = useLevelSince(info, checkHistory, range, staleSec);

  return (
    <div className={cx(classes.cell, classes.fullWidth)} data-testid="DiagnosticTable-header">
      <Tooltip
        arrow
        title={
          <>
            <Typography variant="body2">
              {t("hardwareId")}: <code>{info.status.hardware_id}</code>
            </Typography>
            <Typography variant="body2">
              {t("name")}: <code>{info.status.name}</code>
            </Typography>
          </>
        }
      >
        <Typography
          className={classes.valueText}
          color={MESSAGE_COLORS[info.status.level]}
          variant="subtitle1"
          noWrap
          data-testid="DiagnosticTable-display-name"
          style={{ fontWeight: 800 }}
        >
          {info.displayName}
        </Typography>
      </Tooltip>
      {levelSince && (
        <Typography variant="caption" title={levelSince.title} noWrap color="textSecondary">
          {levelSince.text}
        </Typography>
      )}
      {range && (
        <DiagnosticTimeline
          history={checkHistory}
          start={range.start}
          end={range.end}
          current={range.current}
          staleSec={staleSec}
          width="35%"
          onSeek={onSeek}
        />
      )}
      <CopyButton
        className={classes.iconButton}
        size="small"
        iconSize="small"
        color="inherit"
        aria-label={t("copyStatus")}
        getText={() => JSON.stringify(info.status, undefined, 2) ?? ""}
      />
    </div>
  );
}
