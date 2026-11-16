// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
export const gauge = {
  displayMode: "Display mode",
  displayModeHelp: "Arc for a value in a range; Roll or Pitch for a tilt angle.",
  arc: "Arc",
  roll: "Roll",
  pitch: "Pitch",
  angleUnit: "Input angle unit",
  angleUnitHelp: "Whether the value is in degrees or radians.",
  degrees: "Degrees",
  radians: "Radians",
  angleRange: "Angle range (±°)",
  angleRangeHelp: "Largest angle shown, at most 90°; larger values are clamped.",
  warningAngle: "Warning angle (°)",
  warningAngleHelp: "Angle at which the indicator turns to the warning color.",
  criticalAngle: "Critical angle (°)",
  criticalAngleHelp: "Angle at which the indicator turns to the critical color.",
  gradientHelp: "Start and end colors of the arc.",
  invalidAngles: "Use 0 < warning < critical < range ≤ 90°.",
  messagePath: {
    label: "Message path",
    help: "The single number to show.",
  },
  minValue: {
    label: "Min",
    help: "Value at the left end of the arc; lower values are clamped.",
  },
  maxValue: {
    label: "Max",
    help: "Value at the right end of the arc; higher values are clamped.",
  },
  colorMode: {
    label: "Color mode",
    help: "Color the arc with a predefined color map or a custom two-color gradient.",
    options: {
      colorMap: "Color map",
      gradient: "Gradient",
    },
  },
  colorMap: {
    label: "Color mode",
    help: "Predefined colors along the arc, from min to max.",
    options: {
      rainbow: "Rainbow",
      redYellowGreen: "Red to green",
      turbo: "Turbo",
    },
  },
  reverse: {
    label: "Reverse",
    help: "Flips the colors so they run from max to min.",
  },
};
