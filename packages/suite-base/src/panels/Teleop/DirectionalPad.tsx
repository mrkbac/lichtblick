// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Stack from "@lichtblick/suite-base/components/Stack";
import { svgPathsDisabled, svgPathsEnabled } from "@lichtblick/suite-base/panels/Teleop/constants";
import { DirectionalPadProps, TeleopVector } from "@lichtblick/suite-base/panels/Teleop/types";

import { useStyles } from "./DirectionalPad.style";

const BUTTONS: { vector: TeleopVector; path: string; icon: string }[] = [
  { vector: { x: 0, y: 1 }, path: svgPathsEnabled.up, icon: svgPathsDisabled.up },
  { vector: { x: 0, y: -1 }, path: svgPathsEnabled.down, icon: svgPathsDisabled.down },
  { vector: { x: -1, y: 0 }, path: svgPathsEnabled.left, icon: svgPathsDisabled.left },
  { vector: { x: 1, y: 0 }, path: svgPathsEnabled.right, icon: svgPathsDisabled.right },
];

function DirectionalPad(props: Readonly<DirectionalPadProps>): React.JSX.Element {
  const { onAction, vector = { x: 0, y: 0 } } = props;

  const { classes, cx } = useStyles();

  const release = () => {
    onAction?.();
  };

  return (
    <Stack
      justifyContent="center"
      alignItems="center"
      fullWidth
      fullHeight
      style={{ userSelect: "none", touchAction: "none" }}
    >
      <svg
        className={classes.svg}
        viewBox="0 0 256 256"
        onContextMenu={(event) => {
          event.preventDefault();
        }}
      >
        {BUTTONS.map((button) => (
          // Pointer events cover mouse, touch and pen
          <g
            key={button.path}
            role="button"
            onPointerDown={() => {
              onAction?.(button.vector);
            }}
            onPointerUp={release}
            onPointerLeave={release}
            onPointerCancel={release}
          >
            <path
              className={cx(classes.button, {
                // active when the command points the same way on this button's axis
                active: button.vector.x * vector.x + button.vector.y * vector.y > 0,
              })}
              d={button.path}
            />
            <path className={classes.buttonIcon} d={button.icon} />
          </g>
        ))}
      </svg>
    </Stack>
  );
}

export default DirectionalPad;
