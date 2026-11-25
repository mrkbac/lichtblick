/** @jest-environment jsdom */

// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import {
  shiftRange,
  useTrimStore,
} from "@lichtblick/suite-base/components/ExportRecordingDialog/trimStore";
import EventsProvider from "@lichtblick/suite-base/providers/EventsProvider";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";

import Scrubber from "./Scrubber";

vi.mock("@lichtblick/suite-base/hooks/useElementSize", () => ({
  useElementSize: () => ({ ref: undefined, width: 100 }),
}));

const S = 1_000_000_000n;

describe("shiftRange", () => {
  it("moves both ends by the delta", () => {
    expect(shiftRange(20n, 40n, 5n, 0n, 100n)).toEqual([25n, 45n]);
    expect(shiftRange(20n, 40n, -5n, 0n, 100n)).toEqual([15n, 35n]);
  });

  it("keeps the length when clamped at either bound", () => {
    expect(shiftRange(20n, 40n, 500n, 0n, 100n)).toEqual([80n, 100n]);
    expect(shiftRange(20n, 40n, -500n, 0n, 100n)).toEqual([0n, 20n]);
  });

  it("pins a range longer than the bounds to the start", () => {
    expect(shiftRange(0n, 200n, 10n, 0n, 100n)).toEqual([0n, 200n]);
  });
});

// The slider spans x 0..1000 over a 100 s recording, so 10 px = 1 s. It is 32 px tall: y 8 is on
// the band above the track, y 16 is the track itself.
const WIDTH = 1000;
const BAND_Y = 8;
const TRACK_Y = 16;

function setup() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, WIDTH, 32),
  );
  const onSeek = vi.fn();
  render(
    <PanelSetup
      fixture={{
        activeData: { startTime: { sec: 1000, nsec: 0 }, endTime: { sec: 1100, nsec: 0 } },
      }}
    >
      <EventsProvider>
        <Scrubber onSeek={onSeek} />
      </EventsProvider>
    </PanelSetup>,
  );
  act(() => {
    useTrimStore.getState().startEditing(1020n * S, 1040n * S);
  });
  return { onSeek, slider: screen.getByTestId("playback-slider") };
}

function cut() {
  const { start, end } = useTrimStore.getState();
  return [Number(start! / S) - 1000, Number(end! / S) - 1000];
}

function press(target: Element, x: number, y: number, toX = x) {
  fireEvent.pointerDown(target.firstElementChild!, { clientX: x, clientY: y, button: 0 });
  fireEvent.pointerMove(window, { clientX: toX, clientY: y });
  fireEvent.pointerUp(window, { clientX: toX, clientY: y });
}

describe("TrimRangeOverlay band drag", () => {
  afterEach(() => {
    act(() => {
      useTrimStore.getState().clear();
    });
    vi.restoreAllMocks();
  });

  it("moves the whole cut at a fixed length without seeking", () => {
    const { onSeek, slider } = setup();
    press(slider, 300, BAND_Y, 400);
    expect(cut()).toEqual([30, 50]);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("clamps the moved cut to the recording", () => {
    const { slider } = setup();
    press(slider, 300, BAND_Y, 1000);
    expect(cut()).toEqual([80, 100]);
    press(slider, 900, BAND_Y, 0);
    expect(cut()).toEqual([0, 20]);
  });

  it("seeks on a press on the band that doesn't drag", () => {
    const { onSeek, slider } = setup();
    press(slider, 300, BAND_Y, 301);
    expect(cut()).toEqual([20, 40]);
    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it("keeps scrubbing on the track and outside the cut", () => {
    const { onSeek, slider } = setup();
    press(slider, 300, TRACK_Y, 400);
    press(slider, 600, BAND_Y, 700);
    expect(cut()).toEqual([20, 40]);
    expect(onSeek).toHaveBeenCalled();
  });

  it("moves the cut with arrow keys on the focusable band", () => {
    setup();
    const band = screen.getByRole("slider", { name: "Move trim range" });
    fireEvent.keyDown(band, { key: "ArrowRight" });
    fireEvent.keyDown(band, { key: "ArrowRight" });
    expect(cut()).toEqual([22, 42]);
    for (let i = 0; i < 100; i++) {
      fireEvent.keyDown(band, { key: "ArrowLeft" });
    }
    expect(cut()).toEqual([0, 20]);
  });
});
