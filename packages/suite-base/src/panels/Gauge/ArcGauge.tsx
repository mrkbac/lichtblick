// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useState } from "react";

import { useStyles } from "@lichtblick/suite-base/panels/Gauge/Gauge.style";
import { buildConicGradient } from "@lichtblick/suite-base/panels/Gauge/buildConicGradient";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";

import { formatReading, toNumber, validLimits } from "./limits";
import { GaugeConfig } from "./types";

/** Arc display: a track filled with the color scale up to the value, with the value in the middle. */
export function ArcGauge({
  config,
  value,
}: {
  config: GaugeConfig;
  value: unknown;
}): React.JSX.Element {
  const { classes, cx } = useStyles();
  const rawValue = toNumber(value);

  // Without valid limits the fill and knob are hidden (scaledValue is NaN).
  const limits = validLimits(config);
  const scaledValue = limits
    ? (Math.max(limits.min, Math.min(rawValue, limits.max)) - limits.min) /
      (limits.max - limits.min)
    : NaN;
  const outOfBounds = limits != undefined && (rawValue < limits.min || rawValue > limits.max);

  const padding = 0.1;
  const centerX = 0.5 + padding;
  const centerY = 0.5 + padding;
  const gaugeAngle = -Math.PI / 8;
  const radius = 0.5;
  const innerRadius = 0.43;
  const width = 1 + 2 * padding;
  const height =
    Math.max(
      centerY - radius * Math.sin(gaugeAngle),
      centerY - innerRadius * Math.sin(gaugeAngle),
    ) + padding;
  const [clipPathId] = useState(() => `gauge-clip-path-${randomUUID()}`);
  const hasValue = Number.isFinite(rawValue);
  const thickness = radius - innerRadius;
  const midRadius = (radius + innerRadius) / 2;
  // CSS conic angles run clockwise from 12 o'clock; the arc starts at the lower left.
  const startAngle = -Math.PI / 2 + gaugeAngle;
  const sweep = 2 * (Math.PI / 2 - gaugeAngle);
  const fraction = Number.isFinite(scaledValue) ? scaledValue : undefined;
  const conicCenter = `at 50% ${(100 * centerY) / height}%`;
  const pct = (part: number, of: number) => `${(100 * part) / of}%`;
  const endX = midRadius * Math.cos(gaugeAngle);
  const endY = centerY - midRadius * Math.sin(gaugeAngle) + thickness;
  const clipPath = `url(#${clipPathId})`;
  const cap = thickness / 2;
  const largeArc = gaugeAngle < 0 ? 1 : 0;

  return (
    <div className={classes.root}>
      <div
        className={classes.gaugeWrapper}
        style={{
          width: `min(100cqw, ${(100 * width) / height}cqh)`,
          aspectRatio: `${width} / ${height}`,
        }}
      >
        <div className={classes.track} style={{ clipPath }} />
        {fraction != undefined && (
          <>
            <div
              className={classes.arc}
              style={{
                background: buildConicGradient({ config, width, height, gaugeAngle }),
                clipPath,
                // The color scale up to the value; the rounded start cap lies just before the start.
                mask: `conic-gradient(from ${startAngle}rad ${conicCenter}, #000 ${fraction * sweep}rad, transparent 0 ${
                  sweep + (2 * Math.PI - sweep) / 2
                }rad, #000 0)`,
              }}
            />
            <div
              className={classes.knob}
              style={{
                left: pct(centerX + midRadius * Math.sin(startAngle + fraction * sweep), width),
                top: pct(centerY - midRadius * Math.cos(startAngle + fraction * sweep), height),
                width: pct(thickness * 1.2, width),
              }}
            />
          </>
        )}
        <div
          className={cx(classes.value, outOfBounds && classes.outOfBounds)}
          style={{ top: pct(centerY, height) }}
        >
          {hasValue ? formatReading(rawValue) : "—"}
        </div>
        {limits != undefined && (
          <>
            <span
              className={classes.limit}
              style={{ left: pct(centerX - endX, width), top: pct(endY, height) }}
            >
              {limits.min.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span
              className={classes.limit}
              style={{ left: pct(centerX + endX, width), top: pct(endY, height) }}
            >
              {limits.max.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </>
        )}
      </div>
      <svg style={{ position: "absolute" }}>
        <clipPath id={clipPathId} clipPathUnits="objectBoundingBox">
          <path
            transform={`scale(${1 / width}, ${1 / height})`}
            d={[
              `M ${centerX - radius * Math.cos(gaugeAngle)},${centerY - radius * Math.sin(gaugeAngle)}`,
              `A ${radius},${radius} 0 ${largeArc} 1 ${centerX + radius * Math.cos(gaugeAngle)},${
                centerY - radius * Math.sin(gaugeAngle)
              }`,
              `A ${cap},${cap} 0 0 1 ${centerX + innerRadius * Math.cos(gaugeAngle)},${
                centerY - innerRadius * Math.sin(gaugeAngle)
              }`,
              `A ${innerRadius},${innerRadius} 0 ${largeArc} 0 ${
                centerX - innerRadius * Math.cos(gaugeAngle)
              },${centerY - innerRadius * Math.sin(gaugeAngle)}`,
              `A ${cap},${cap} 0 0 1 ${centerX - radius * Math.cos(gaugeAngle)},${
                centerY - radius * Math.sin(gaugeAngle)
              }`,
              `Z`,
            ].join(" ")}
          />
        </clipPath>
      </svg>
    </div>
  );
}
