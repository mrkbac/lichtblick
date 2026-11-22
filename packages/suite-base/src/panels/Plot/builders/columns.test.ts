// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { PointColumns } from "./columns";

/** One message per entry, received at its index in seconds; each message holds [x, y] values */
function columns(messages: [number, number][][]): PointColumns {
  const points = new PointColumns();
  messages.forEach((rows, sec) => {
    for (const [x, y] of rows) {
      points.pushValue(x, y, y, { sec, nsec: 0 });
    }
  });
  return points;
}

const rows = (points: PointColumns) =>
  Array.from({ length: points.length }, (_, i) => [points.x[i], points.y[i]]);

describe("PointColumns.thinByTime", () => {
  it("keeps messages that mix values and gaps when their bucket keeps them", () => {
    // GIVEN two array messages with a gap inside, one message per bucket
    const points = columns([
      [[0, 1]],
      [
        [1, 10],
        [1, NaN],
        [1, 12],
      ],
      [
        [2, 20],
        [2, NaN],
        [2, 22],
      ],
      [[3, 3]],
    ]);

    points.thinByTime(0, 1);

    // THEN nothing is dropped
    expect(rows(points)).toEqual([
      [0, 1],
      [1, 10],
      [1, NaN],
      [1, 12],
      [2, 20],
      [2, NaN],
      [2, 22],
      [3, 3],
    ]);
  });

  it("keeps a missing x as a gap when asked to", () => {
    // GIVEN a message without x between finite ones, all in one bucket
    const make = () => columns([[[0, 0]], [[NaN, 5]], [[2, 2]], [[3, 3]]]);
    const withX = make();
    withX.thinByTime(0, 100, { gapsInX: true });

    // THEN the line still breaks between the first and the newest message
    expect(rows(withX)).toEqual([
      [0, 0],
      [NaN, 5],
      [3, 3],
    ]);
  });
});
