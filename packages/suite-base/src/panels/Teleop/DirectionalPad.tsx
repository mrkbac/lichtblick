// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Stack from "@lichtblick/suite-base/components/Stack";
import { svgPathsDisabled, svgPathsEnabled } from "@lichtblick/suite-base/panels/Teleop/constants";
import {
  DirectionalPadAction,
  DirectionalPadProps,
} from "@lichtblick/suite-base/panels/Teleop/types";

import { useStyles } from "./DirectionalPad.style";

function DirectionalPad(props: Readonly<DirectionalPadProps>): React.JSX.Element {
  const { onAction, disabled = false, vector = { x: 0, y: 0 } } = props;

  const { classes, cx } = useStyles();

  const isActionActive = (action: DirectionalPadAction): boolean => {
    switch (action) {
      case DirectionalPadAction.UP:
        return vector.y > 0;
      case DirectionalPadAction.DOWN:
        return vector.y < 0;
      case DirectionalPadAction.LEFT:
        return vector.x < 0;
      case DirectionalPadAction.RIGHT:
        return vector.x > 0;
    }
  };

  const release = () => {
    onAction?.();
  };

  // Pointer events cover mouse, touch and pen
  const makePointerHandlers = (action: DirectionalPadAction) =>
    disabled
      ? undefined
      : {
          onPointerDown: () => {
            onAction?.(action);
          },
          onPointerUp: release,
          onPointerLeave: release,
          onPointerCancel: release,
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
        <g opacity={1}>
          {/* UP button */}
          <g {...makePointerHandlers(DirectionalPadAction.UP)} role="button">
            <path
              className={cx(classes.button, {
                active: isActionActive(DirectionalPadAction.UP),
                disabled,
              })}
              d={svgPathsEnabled.up}
            />
            <path className={cx(classes.buttonIcon, { disabled })} d={svgPathsDisabled.up} />
          </g>

          {/* DOWN button */}
          <g {...makePointerHandlers(DirectionalPadAction.DOWN)} role="button">
            <path
              className={cx(classes.button, {
                active: isActionActive(DirectionalPadAction.DOWN),
                disabled,
              })}
              d={svgPathsEnabled.down}
            />
            <path className={cx(classes.buttonIcon, { disabled })} d={svgPathsDisabled.down} />
          </g>
        </g>

        <g opacity={1}>
          {/* LEFT button */}
          <g {...makePointerHandlers(DirectionalPadAction.LEFT)} role="button">
            <path
              className={cx(classes.button, {
                active: isActionActive(DirectionalPadAction.LEFT),
                disabled,
              })}
              d={svgPathsEnabled.left}
            />
            <path className={cx(classes.buttonIcon, { disabled })} d={svgPathsDisabled.left} />
          </g>

          {/* RIGHT button */}
          <g {...makePointerHandlers(DirectionalPadAction.RIGHT)} role="button">
            <path
              className={cx(classes.button, {
                active: isActionActive(DirectionalPadAction.RIGHT),
                disabled,
              })}
              d={svgPathsEnabled.right}
            />
            <path className={cx(classes.buttonIcon, { disabled })} d={svgPathsDisabled.right} />
          </g>
        </g>
      </svg>
    </Stack>
  );
}

export default DirectionalPad;
