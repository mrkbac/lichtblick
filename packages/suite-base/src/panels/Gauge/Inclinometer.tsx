// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { useTheme } from "@mui/material";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { GaugeConfig } from "./types";

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
  const { displayMode, angleUnit, angleRange, warningAngle, criticalAngle } = config;
  const validRange =
    warningAngle > 0 &&
    criticalAngle > warningAngle &&
    angleRange > criticalAngle &&
    angleRange <= 90;
  const numericValue =
    typeof value === "number" || (typeof value === "string" && value.trim() !== "")
      ? Number(value)
      : NaN;
  const degrees = angleUnit === "radians" ? (numericValue * 180) / Math.PI : numericValue;
  const hasValue = Number.isFinite(degrees) && validRange;
  const angle = hasValue ? Math.max(-angleRange, Math.min(angleRange, degrees)) : 0;
  const color = !hasValue
    ? theme.palette.text.disabled
    : Math.abs(degrees) >= criticalAngle
      ? theme.palette.error.main
      : Math.abs(degrees) >= warningAngle
        ? theme.palette.warning.main
        : theme.palette.success.main;
  const label = t(displayMode === "pitch" ? "pitch" : "roll");
  const range = validRange ? angleRange : 40;
  const ticks = Array.from({ length: 17 }, (_, index) => ((index - 8) * range) / 8);

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
        fill={color}
        fontSize="28"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {hasValue ? `${degrees.toFixed(1)}°` : "—"}
      </text>
      <g opacity={hasValue ? 1 : 0.35}>
        <circle cx="160" cy="150" r="99" fill={theme.palette.background.default} />
        {hasValue && (
          <g clipPath={`url(#${clipId})`}>
            <g
              transform={
                displayMode === "roll"
                  ? `rotate(${-angle} 160 150)`
                  : `translate(0 ${(angle / range) * 75})`
              }
            >
              {Array.from({ length: 8 }, (_, index) => {
                const bandAngle = ((index + 1) * range) / 8;
                return (
                  <rect
                    key={index}
                    x="-40"
                    y={150 + index * 12}
                    width="400"
                    height={index === 7 ? 250 : 10}
                    fill={
                      bandAngle >= criticalAngle
                        ? theme.palette.error.main
                        : bandAngle >= warningAngle
                          ? theme.palette.warning.main
                          : theme.palette.success.main
                    }
                  />
                );
              })}
              <path d="M -40 150 H 360" stroke={theme.palette.text.primary} strokeWidth="2" />
            </g>
          </g>
        )}
        <circle cx="160" cy="150" r="99" fill="none" stroke="currentColor" strokeWidth="2" />
        {ticks.map((tick, index) => {
          const radians = (tick * Math.PI) / 180;
          return [-1, 1].map((side) => (
            <g key={`${index}-${side}`}>
              <line
                x1={160 + side * 105 * Math.cos(radians)}
                y1={150 + 105 * Math.sin(radians)}
                x2={160 + side * (index % 2 === 0 ? 117 : 112) * Math.cos(radians)}
                y2={150 + (index % 2 === 0 ? 117 : 112) * Math.sin(radians)}
                stroke="currentColor"
                strokeWidth="2"
              />
              {index % 2 === 0 && (
                <text
                  x={160 + side * 134 * Math.cos(radians)}
                  y={150 + 134 * Math.sin(radians)}
                  fill="currentColor"
                  fontSize="11"
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {Number(Math.abs(tick).toFixed(1))}
                </text>
              )}
            </g>
          ));
        })}
        <path
          d="M 42 150 l -10 -6 v 12 Z M 278 150 l 10 -6 v 12 Z"
          fill={theme.palette.error.main}
        />
        <circle
          cx="160"
          cy="150"
          r="42"
          fill={theme.palette.background.paper}
          stroke="currentColor"
          strokeWidth="2"
        />
        <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
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
        fill="currentColor"
        textAnchor="middle"
        fontSize="18"
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
