// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useTheme } from "@mui/material";

import { ButtonName } from "@lichtblick/suite-base/panels/Teleop/types";

// diamond layout of a standard gamepad
const BUTTONS: { name: ButtonName; label: string; cx: number; cy: number }[] = [
  { name: "y", label: "Y", cx: 128, cy: 52 },
  { name: "x", label: "X", cx: 52, cy: 128 },
  { name: "b", label: "B", cx: 204, cy: 128 },
  { name: "a", label: "A", cx: 128, cy: 204 },
];

type Props = {
  pressed: ReadonlySet<ButtonName>;
  onPress: (button: ButtonName) => void;
  onRelease: (button: ButtonName) => void;
};

/** Momentary on-screen A/B/X/Y buttons; each can be held with its own finger */
export default function FaceButtons({
  pressed,
  onPress,
  onRelease,
}: Readonly<Props>): React.JSX.Element {
  const theme = useTheme();
  return (
    <svg
      viewBox="0 0 256 256"
      style={{ maxWidth: "100%", maxHeight: "100%", touchAction: "none", userSelect: "none" }}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      {BUTTONS.map(({ name, label, cx, cy }) => {
        const down = pressed.has(name);
        const release = () => {
          onRelease(name);
        };
        return (
          <g
            key={name}
            role="button"
            aria-label={label}
            aria-pressed={down}
            style={{ cursor: "pointer" }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              onPress(name);
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onLostPointerCapture={release}
          >
            <circle
              cx={cx}
              cy={cy}
              r={40}
              fill={down ? theme.palette.primary.main : theme.palette.action.hover}
              stroke={down ? theme.palette.primary.dark : theme.palette.divider}
              strokeWidth={2}
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={32}
              fontWeight={600}
              fill={down ? theme.palette.primary.contrastText : theme.palette.text.secondary}
              style={{ pointerEvents: "none" }}
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
