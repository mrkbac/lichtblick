/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";

import { PathSampleColumns } from "@lichtblick/suite-base/components/MessagePathSyntax/PathSampleColumns";

import useStateTransitionsData from "./useStateTransitionsData";

describe("useStateTransitionsData matches", () => {
  it("finds every match even when the drawn samples are thinned past the changes", () => {
    // 3 values cycling every sample: a budget of 40 must merge, which blurs changes.
    const columns = new PathSampleColumns(40);
    columns.trackChanges();
    for (let i = 0; i < 300; i++) {
      columns.push({
        receiveTime: { sec: i, nsec: 0 },
        headerStamp: undefined,
        count: 1,
        value: i % 3,
        constantName: undefined,
      });
    }
    const path = { value: "/a.b", condition: "== 0", timestampMethod: "receiveTime" as const };
    const { result } = renderHook(() =>
      useStateTransitionsData([path], { sec: 0, nsec: 0 }, {}, [{ "/a.b": columns }], false),
    );
    // The drawn samples are merged stretches with no matches; the changes record has the newest
    // changes, each match among them exactly.
    const first = columns.changes().at(0)!.receiveTime.sec;
    const expected = Array.from({ length: 100 }, (_, i) => i * 3).filter((x) => x >= first);
    expect(expected.length).toBeGreaterThan(0);
    expect(result.current.matchStarts).toEqual(expected);
  });
});
