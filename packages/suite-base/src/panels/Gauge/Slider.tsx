// SPDX-License-Identifier: MPL-2.0

import { useTheme } from "@mui/material";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { getColorStops } from "./buildConicGradient";
import { formatReading, toNumber, validLimits } from "./limits";
import { GaugeConfig } from "./types";

const X0 = 20;
const X1 = 300;
const fmt = (v: number | undefined) =>
  v != undefined && Number.isFinite(v) ? String(Number(v.toFixed(3))) : "—";

/** Linear track between the min/max limits that shows where the value sits, flagging values outside. */
export function Slider({
  config,
  value,
}: {
  config: GaugeConfig;
  value: unknown;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation("gauge");
  const gradientId = useId();
  const { minValue, maxValue } = config;
  const numericValue = toNumber(value);
  const limits = validLimits(config);
  const fraction = limits ? (numericValue - limits.min) / (limits.max - limits.min) : NaN;
  const hasValue = limits != undefined && Number.isFinite(numericValue);
  const below = limits != undefined && numericValue < limits.min;
  const above = limits != undefined && numericValue > limits.max;
  const x = X0 + Math.max(0, Math.min(1, fraction)) * (X1 - X0);
  const color = !Number.isFinite(numericValue)
    ? theme.palette.text.disabled
    : below || above
      ? theme.palette.error.main
      : theme.palette.text.primary;
  const status = below
    ? t("belowLimit")
    : above
      ? t("aboveLimit")
      : `${(fraction * 100).toFixed(0)}%`;
  // The reading stays visible without valid limits; only the marker and status need them.
  const readout = Number.isFinite(numericValue) ? formatReading(numericValue) : "—";

  return (
    <svg
      viewBox="0 0 320 112"
      width="100%"
      height="100%"
      role="img"
      aria-label={hasValue ? `${readout} (${status})` : readout}
      style={{ color: theme.palette.text.primary, fontFamily: theme.typography.fontFamily }}
    >
      <defs>
        <linearGradient id={gradientId}>
          {getColorStops(config).map((stop, index) => (
            <stop key={index} offset={stop.location} stopColor={stop.color} />
          ))}
        </linearGradient>
      </defs>
      <text
        x="160"
        y="32"
        textAnchor="middle"
        fill={color}
        fontSize="28"
        fontWeight="600"
        letterSpacing="-0.5"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {readout}
      </text>
      {hasValue && (
        <text
          x="160"
          y="50"
          textAnchor="middle"
          fill={below || above ? color : theme.palette.text.secondary}
          fontSize="13"
        >
          {status}
        </text>
      )}
      <rect
        x={X0}
        y="69"
        width={X1 - X0}
        height="8"
        rx="4"
        fill={`url(#${gradientId})`}
        opacity={hasValue ? 1 : 0.5}
      />
      {hasValue && (
        <circle
          cx={x}
          cy="73"
          r="7"
          fill={theme.palette.background.default}
          stroke={below || above ? color : theme.palette.text.primary}
          strokeWidth="2.5"
        />
      )}
      <text x={X0} y="100" fill={theme.palette.text.secondary} fontSize="14" textAnchor="start">
        {fmt(minValue)}
      </text>
      <text x={X1} y="100" fill={theme.palette.text.secondary} fontSize="14" textAnchor="end">
        {fmt(maxValue)}
      </text>
    </svg>
  );
}
