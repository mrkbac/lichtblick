// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ObjectData } from "./types";

export type Point = { index: number; x: number; y: number; label?: string | undefined };

/**
 * iterateObjects iterates over ObjectData, yielding a `Point` for each entry.
 */
export function* iterateObjects(
  dataset: ObjectData,
  start = 0,
  end = dataset.length,
): Generator<Point> {
  for (let index = start; index < end; index++) {
    const datum = dataset[index];
    if (datum == undefined) {
      continue;
    }
    const { x, y, label } = datum;
    yield { index, x, y, label };
  }
}
