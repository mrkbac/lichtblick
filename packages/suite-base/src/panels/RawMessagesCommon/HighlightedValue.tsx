// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Fragment } from "react";

import MaybeCollapsedValue from "@lichtblick/suite-base/panels/RawMessagesCommon/MaybeCollapsedValue";
import { diffArrow } from "@lichtblick/suite-base/panels/RawMessagesCommon/constants";
import { useStylesDiffSpan } from "@lichtblick/suite-base/panels/RawMessagesCommon/index.style";
import {
  diffLabels,
  PropsHighlightedValue,
} from "@lichtblick/suite-base/panels/RawMessagesCommon/types";

import { DiffSpan } from "./DiffSpan";

/** Splits a number at its decimal point so stacked numbers line up on it; undefined otherwise. */
function splitAtDecimal(text: string): [string, string] | undefined {
  if (text === "" || Number.isNaN(Number(text))) {
    return undefined;
  }
  const dot = text.indexOf(".");
  return dot < 0 ? [text, ""] : [text.slice(0, dot), text.slice(dot)];
}

export default function HighlightedValue({ itemLabel }: PropsHighlightedValue): React.JSX.Element {
  const { classes, cx } = useStylesDiffSpan();
  // react-json-tree's valueRenderer only gets called for primitives, so diff before/after values must be at same level by the time it gets to the tree
  const splitItemLabel = itemLabel.length > 0 ? itemLabel.split(diffArrow) : [];
  const itemLabelContainsChange = splitItemLabel.length === 2;

  if (itemLabelContainsChange) {
    // Old value above the new one, so they compare digit by digit; numbers line up on the
    // decimal point, and the column keeps its place while the digits change.
    const lines = splitItemLabel.map((text) => text.trim());
    const numbers = lines.map(splitAtDecimal);
    const aligned = numbers.every((parts) => parts != undefined);

    return (
      <DiffSpan style={{ color: diffLabels.CHANGED.color }}>
        <span className={classes.stacked}>
          {lines.map((text, index) => {
            const lineClass = index === 0 ? classes.before : undefined;
            const parts = numbers[index];
            return aligned && parts ? (
              <Fragment key={index}>
                <span className={cx(classes.integer, lineClass)}>{parts[0]}</span>
                <span className={lineClass}>{parts[1]}</span>
              </Fragment>
            ) : (
              <span key={index} className={cx(classes.whole, lineClass)}>
                <MaybeCollapsedValue itemLabel={text} />
              </span>
            );
          })}
        </span>
      </DiffSpan>
    );
  }

  return (
    <DiffSpan>
      <MaybeCollapsedValue itemLabel={itemLabel} />
    </DiffSpan>
  );
}
