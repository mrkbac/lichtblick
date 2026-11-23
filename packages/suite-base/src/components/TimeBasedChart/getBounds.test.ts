// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { getBounds } from "./useProvider";

describe("getBounds", () => {
  it("returns undefined if x is NaN", () => {
    expect(
      getBounds([
        {
          data: [
            {
              x: NaN,
              y: 1,
            },
          ],
        },
      ]),
    ).toEqual(undefined);
  });

  it("returns undefined if y is NaN", () => {
    expect(
      getBounds([
        {
          data: [
            {
              x: 1,
              y: NaN,
            },
          ],
        },
      ]),
    ).toEqual(undefined);
  });

  it("ignores one NaN", () => {
    expect(
      getBounds([
        {
          data: [
            {
              x: NaN,
              y: NaN,
            },
            {
              x: 1,
              y: 1,
            },
          ],
        },
      ]),
    ).toEqual({
      x: {
        min: 1,
        max: 1,
      },
      y: {
        min: 1,
        max: 1,
      },
    });
  });
});
