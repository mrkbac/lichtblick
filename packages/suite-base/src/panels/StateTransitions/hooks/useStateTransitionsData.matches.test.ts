/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";

import { PathSampleColumns } from "@lichtblick/suite-base/components/MessagePathSyntax/PathSampleColumns";

import useStateTransitionsData from "./useStateTransitionsData";

describe("useStateTransitionsData matches", () => {
  it("reports exact matches while the history fits the budget", () => {
    const columns = new PathSampleColumns(4);
    columns.trackChanges();
    columns.push({
      receiveTime: { sec: 1, nsec: 0 },
      headerStamp: undefined,
      count: 1,
      value: 2,
      constantName: undefined,
    });
    const path = { value: "/a.b", condition: "== 2", timestampMethod: "receiveTime" as const };
    const { result } = renderHook(() =>
      useStateTransitionsData([path], { sec: 0, nsec: 0 }, { "/a.b": columns }, [], false),
    );
    expect(result.current.matchStarts).toEqual([1]);
    expect(result.current.matchesApproximate).toBe(false);
  });

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
    expect(result.current.matchesApproximate).toBe(true);
  });

  it("doesn't count a match where the changes record cut off its oldest changes", () => {
    // 0, 1, 2 cycling with "> 0": true only turns on at 1; 1 -> 2 stays true. Wherever the
    // record's cut lands, no match may appear at a 2.
    for (let budget = 40; budget < 46; budget++) {
      const columns = new PathSampleColumns(budget);
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
      const path = { value: "/a.b", condition: "> 0", timestampMethod: "receiveTime" as const };
      const { result } = renderHook(() =>
        useStateTransitionsData([path], { sec: 0, nsec: 0 }, {}, [{ "/a.b": columns }], false),
      );
      expect(result.current.matchStarts.length).toBeGreaterThan(0);
      expect(result.current.matchStarts.filter((x) => x % 3 !== 1)).toEqual([]);
    }
  });

  it("finds the first stamped match after the cut when the record's first sample is unstamped", () => {
    // Drawn by header stamp: only even samples are stamped, and they alternate 1, 0, 1, 0, so
    // "== 1" starts at every x with x % 4 == 0. Whichever sample the cut keeps first (stamped or
    // not), every match after it must be found.
    const cuts = new Set<number>();
    for (let budget = 40; budget < 44; budget++) {
      for (let total = 300; total < 308; total++) {
        const columns = new PathSampleColumns(budget);
        columns.trackChanges();
        for (let i = 0; i < total; i++) {
          columns.push({
            receiveTime: { sec: i, nsec: 0 },
            headerStamp: i % 2 === 0 ? { sec: i, nsec: 0 } : undefined,
            count: 1,
            value: Math.floor((i + 2) / 2) % 2,
            constantName: undefined,
          });
        }
        const path = { value: "/a.b", condition: "== 1", timestampMethod: "headerStamp" as const };
        const { result } = renderHook(() =>
          useStateTransitionsData([path], { sec: 0, nsec: 0 }, {}, [{ "/a.b": columns }], false),
        );
        const cut = columns.changes().at(0)!.receiveTime.sec;
        cuts.add(cut % 4);
        const expected = Array.from({ length: total }, (_, x) => x).filter(
          (x) => x % 4 === 0 && x > cut,
        );
        expect(result.current.matchStarts.filter((x) => x % 4 !== 0)).toEqual([]);
        expect(result.current.matchStarts.filter((x) => x > cut)).toEqual(expected);
      }
    }
    // Covered: an unstamped first sample right before a match.
    expect(cuts.has(3)).toBe(true);
  });
});
