// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { useTheme } from "@mui/material";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { toNumber, validAngles } from "./limits";
import { GaugeConfig } from "./types";

/** Radius of the ring that shows the warning and critical ranges. */
const RING = 104;

/** Keeps invalid readings and thresholds from appearing as a live, level horizon. */
export function Inclinometer({
  config,
  value,
}: {
  config: GaugeConfig;
  value: unknown;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation("gauge");
  const clipId = useId();
  const { displayMode, angleUnit } = config;
  const angles = validAngles(config);
  const validRange = angles != undefined;
  // Invalid thresholds draw an empty 40° dial: no reading, no colored bands.
  const {
    range,
    warning: warningAngle,
    critical: criticalAngle,
  } = angles ?? {
    range: 40,
    warning: Infinity,
    critical: Infinity,
  };
  const numericValue = toNumber(value);
  const degrees = angleUnit === "radians" ? (numericValue * 180) / Math.PI : numericValue;
  const hasValue = Number.isFinite(degrees) && validRange;
  const angle = hasValue ? Math.max(-range, Math.min(range, degrees)) : 0;
  const color = !hasValue
    ? theme.palette.text.disabled
    : Math.abs(degrees) >= criticalAngle
      ? theme.palette.error.main
      : Math.abs(degrees) >= warningAngle
        ? theme.palette.warning.main
        : theme.palette.success.main;
  const label = t(displayMode === "pitch" ? "pitch" : "roll");
  const ticks = Array.from({ length: 17 }, (_, index) => ((index - 8) * range) / 8);
  const muted = theme.palette.text.secondary;

  // Both sides of the dial show the same scale: `side` 1 is the right half, -1 the left.
  const point = (side: 1 | -1, degreesOnDial: number, radius: number): [number, number] => {
    const radians = (degreesOnDial * Math.PI) / 180;
    return [160 + side * radius * Math.cos(radians), 150 + radius * Math.sin(radians)];
  };
  const ringArc = (side: 1 | -1, from: number, to: number): string => {
    const [x1, y1] = point(side, from, RING);
    const [x2, y2] = point(side, to, RING);
    return `M ${x1} ${y1} A ${RING} ${RING} 0 0 ${side === 1 ? 1 : 0} ${x2} ${y2}`;
  };
  // Warning and critical ranges as thin segments on the ring, on both sides of level.
  const zones: { from: number; to: number; color: string }[] = [];
  if (warningAngle < range) {
    const to = Math.min(criticalAngle, range);
    zones.push({ from: warningAngle, to, color: theme.palette.warning.main });
    zones.push({ from: -to, to: -warningAngle, color: theme.palette.warning.main });
  }
  if (criticalAngle < range) {
    zones.push({ from: criticalAngle, to: range, color: theme.palette.error.main });
    zones.push({ from: -range, to: -criticalAngle, color: theme.palette.error.main });
  }
  // Markers where the horizon meets the dial.
  const marker = (side: 1 | -1, at: number): string => {
    const [x, y] = point(side, at, 99);
    const [ax, ay] = point(side, at, 89);
    const radians = (at * Math.PI) / 180;
    const nx = -Math.sin(radians) * 5;
    const ny = side * Math.cos(radians) * 5;
    return `M ${ax} ${ay} L ${x + nx} ${y + ny} L ${x - nx} ${y - ny} Z`;
  };

  return (
    <svg
      viewBox={range > 60 ? "0 -40 320 380" : "0 0 320 300"}
      width="100%"
      height="100%"
      role="img"
      aria-label={`${label}: ${hasValue ? `${degrees.toFixed(1)}°` : "—"}${validRange ? "" : ` ${t("invalidAngles")}`}`}
      style={{ color: theme.palette.text.primary, fontFamily: theme.typography.fontFamily }}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="160" cy="150" r="99" />
        </clipPath>
      </defs>
      <text
        x="160"
        y={range > 60 ? -5 : 31}
        textAnchor="middle"
        fill={hasValue ? color : muted}
        fontSize="30"
        fontWeight="600"
        letterSpacing="-0.5"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {hasValue ? `${degrees.toFixed(1)}°` : "—"}
      </text>
      <g opacity={hasValue ? 1 : 0.4}>
        <circle cx="160" cy="150" r="99" fill={theme.palette.action.hover} />
        {hasValue && (
          <g clipPath={`url(#${clipId})`}>
            {/* Positive angles tilt the horizon clockwise: left side up, right side down. */}
            <g transform={`rotate(${angle} 160 150)`}>
              <rect x="-40" y="150" width="400" height="250" fill={theme.palette.action.selected} />
              <path d="M -40 150 H 360" stroke={color} strokeWidth="2.5" />
            </g>
          </g>
        )}
        <circle
          cx="160"
          cy="150"
          r="99"
          fill="none"
          stroke={theme.palette.divider}
          strokeWidth="1"
        />
        {zones.map((zone, index) =>
          ([1, -1] as const).map((side) => (
            <path
              key={`${index}-${side}`}
              d={ringArc(side, zone.from, zone.to)}
              fill="none"
              stroke={zone.color}
              strokeWidth="4"
            />
          )),
        )}
        {ticks.map((tick, index) =>
          ([1, -1] as const).map((side) => {
            const major = index % 4 === 0;
            const [x1, y1] = point(side, tick, 109);
            const [x2, y2] = point(side, tick, major ? 118 : 114);
            const [lx, ly] = point(side, tick, 132);
            return (
              <g key={`${index}-${side}`}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={muted}
                  strokeWidth={major ? 1.5 : 1}
                  strokeLinecap="round"
                />
                {major && (
                  <text
                    x={lx}
                    y={ly}
                    fill={muted}
                    fontSize="14"
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {Number(Math.abs(tick).toFixed(1))}
                  </text>
                )}
              </g>
            );
          }),
        )}
        {hasValue && <path d={`${marker(1, angle)} ${marker(-1, -angle)}`} fill={color} />}
        <circle cx="160" cy="150" r="40" fill={theme.palette.background.default} />
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          {displayMode === "roll" ? (
            <>
              <path d="M 136 160 V 143 L 142 132 H 178 L 184 143 V 160 Z M 141 143 H 179 M 145 136 H 175 V 143 H 145 Z M 141 153 H 148 M 172 153 H 179" />
              <path d="M 137 160 V 168 H 146 V 160 M 174 160 V 168 H 183 V 160" />
            </>
          ) : (
            <>
              <path d="M 131 158 V 146 H 145 L 151 134 H 172 L 181 146 H 190 V 158 H 183 M 146 158 H 171 M 150 146 H 176 L 169 138 H 155 Z" />
              <circle cx="139" cy="158" r="7" />
              <circle cx="178" cy="158" r="7" />
            </>
          )}
        </g>
      </g>
      <text
        x="160"
        y={range > 60 ? 325 : 283}
        fill={muted}
        textAnchor="middle"
        fontSize="18"
        fontWeight="500"
      >
        {label}
      </text>
      {!validRange && (
        <text x="160" y="299" fill={theme.palette.error.main} textAnchor="middle" fontSize="9">
          {t("invalidAngles")}
        </text>
      )}
    </svg>
  );
}
