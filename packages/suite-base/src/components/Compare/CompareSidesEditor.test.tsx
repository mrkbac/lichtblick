/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";

import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import { CompareSide } from "@lichtblick/suite-base/players/types";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { CompareProvider } from "./CompareContext";
import { CompareSidesEditor } from "./CompareSidesEditor";

function sides(offsets: readonly number[]): CompareSide[] {
  return offsets.map((offsetSec, index) => ({
    prefix: index === 0 ? "/a" : "/b",
    name: index === 0 ? "run a" : "run b",
    start: { sec: 0, nsec: 0 },
    end: { sec: 10, nsec: 0 },
    sharedStart: { sec: offsetSec, nsec: 0 },
    offsetSec,
  }));
}

function Editors({
  compareSides,
  compareRequest,
  setCompareOffsets,
}: {
  compareSides: CompareSide[];
  compareRequest?: number;
  setCompareOffsets: (offsetsSec: readonly number[], request: number) => void;
}) {
  return (
    <ThemeProvider isDark={false}>
      <MockMessagePipelineProvider
        activeData={{ compareSides, compareRequest }}
        setCompareOffsets={setCompareOffsets}
      >
        <CompareProvider>
          {/* e.g. the data source sidebar and the playback bar popover */}
          <div data-testid="first">
            <CompareSidesEditor />
          </div>
          <div data-testid="second">
            <CompareSidesEditor />
          </div>
        </CompareProvider>
      </MockMessagePipelineProvider>
    </ThemeProvider>
  );
}

// The "+1" nudge of the `side`-th recording in the `editor`-th editor
function nudge(editor: number, side: number) {
  const buttons = screen.getAllByTitle("Move by +1 s");
  fireEvent.click(buttons[editor * 2 + side]!);
}

describe("CompareSidesEditor", () => {
  it("numbers requests per player, so two editors build on each other's pending changes", () => {
    const setCompareOffsets = vi.fn();
    render(<Editors compareSides={sides([0, 0])} setCompareOffsets={setCompareOffsets} />);

    nudge(0, 0);
    nudge(1, 1);

    expect(setCompareOffsets.mock.calls).toEqual([
      [[1, 0], 1],
      [[1, 1], 2],
    ]);
  });

  it("keeps changes pending through updates that apply none of them", () => {
    const setCompareOffsets = vi.fn();
    const { rerender } = render(
      <Editors compareSides={sides([0, 0])} setCompareOffsets={setCompareOffsets} />,
    );
    nudge(0, 0);

    // A growing recording publishes its sides again, with no offset change applied
    rerender(<Editors compareSides={sides([0, 0])} setCompareOffsets={setCompareOffsets} />);
    nudge(1, 1);

    // The second change builds on the first, still pending
    expect(setCompareOffsets.mock.calls.at(-1)).toEqual([[1, 1], 2]);

    // Once the player applies the first, the second still is what the next change builds on
    rerender(
      <Editors
        compareSides={sides([1, 0])}
        compareRequest={1}
        setCompareOffsets={setCompareOffsets}
      />,
    );
    nudge(0, 0);
    expect(setCompareOffsets.mock.calls.at(-1)).toEqual([[2, 1], 3]);
  });
});
