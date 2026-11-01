// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useTheme } from "@mui/material";
import { useRef } from "react";

import { clampToUnit, isActive } from "@lichtblick/suite-base/panels/Teleop/twist";
import { JoystickProps } from "@lichtblick/suite-base/panels/Teleop/types";

const CENTER = 128;
const BASE_RADIUS = 124;
const KNOB_RADIUS = 36;
// how far the knob center travels for a full deflection
const TRAVEL = BASE_RADIUS - KNOB_RADIUS;

function Joystick({ vector, onChange }: Readonly<JoystickProps>): React.JSX.Element {
  const theme = useTheme();
  const dragging = useRef(false);

  const toVector = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // the svg keeps its aspect ratio, so the circle is centered with the smaller side as diameter
    const travelPx = (Math.min(rect.width, rect.height) / 2) * (TRAVEL / CENTER);
    if (travelPx <= 0) {
      return { x: 0, y: 0 };
    }
    return clampToUnit(
      (event.clientX - (rect.left + rect.width / 2)) / travelPx,
      -(event.clientY - (rect.top + rect.height / 2)) / travelPx,
    );
  };

  const release = () => {
    if (dragging.current) {
      dragging.current = false;
      onChange(undefined);
    }
  };

  const active = isActive(vector);
  // keyboard diagonals reach (1, 1), keep the knob on the ring
  const knob = clampToUnit(vector.x, vector.y);
  const knobX = CENTER + knob.x * TRAVEL;
  const knobY = CENTER - knob.y * TRAVEL;

  return (
    <svg
      data-testid="teleop-joystick"
      viewBox="0 0 256 256"
      style={{ maxWidth: "100%", maxHeight: "100%", touchAction: "none", cursor: "grab" }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        onChange(toVector(event));
      }}
      onPointerMove={(event) => {
        if (dragging.current) {
          onChange(toVector(event));
        }
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      <circle
        cx={CENTER}
        cy={CENTER}
        r={BASE_RADIUS}
        fill={theme.palette.action.hover}
        stroke={active ? theme.palette.primary.main : theme.palette.divider}
      />
      <circle
        cx={CENTER}
        cy={CENTER}
        r={TRAVEL}
        fill="none"
        stroke={theme.palette.divider}
        strokeDasharray="4 4"
      />
      <path
        d={`M${CENTER} ${CENTER - TRAVEL}V${CENTER + TRAVEL}M${CENTER - TRAVEL} ${CENTER}H${CENTER + TRAVEL}`}
        stroke={theme.palette.divider}
      />
      {active && (
        <line
          x1={CENTER}
          y1={CENTER}
          x2={knobX}
          y2={knobY}
          stroke={theme.palette.primary.main}
          strokeWidth={4}
          strokeLinecap="round"
        />
      )}
      <circle
        cx={knobX}
        cy={knobY}
        r={KNOB_RADIUS}
        fill={active ? theme.palette.primary.main : theme.palette.background.paper}
        stroke={active ? theme.palette.primary.dark : theme.palette.text.secondary}
        strokeWidth={2}
      />
    </svg>
  );
}

export default Joystick;
