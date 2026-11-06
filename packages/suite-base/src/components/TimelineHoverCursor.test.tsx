/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";

import {
  playbackHoverFraction,
  TimelineHoverCursor,
  usePublishPlaybackHover,
} from "@lichtblick/suite-base/components/TimelineHoverCursor";
import { useSetHoverValue } from "@lichtblick/suite-base/context/TimelineInteractionStateContext";
import TimelineInteractionStateProvider from "@lichtblick/suite-base/providers/TimelineInteractionStateProvider";

describe("playbackHoverFraction", () => {
  it("maps playback seconds onto the timeline", () => {
    expect(
      playbackHoverFraction({ componentId: "a", type: "PLAYBACK_SECONDS", value: 5 }, 20),
    ).toBe(0.25);
  });

  it("ignores non-time hover values, out-of-range values and empty timelines", () => {
    expect(playbackHoverFraction(undefined, 10)).toBeUndefined();
    expect(
      playbackHoverFraction({ componentId: "a", type: "OTHER", value: 5 }, 10),
    ).toBeUndefined();
    expect(
      playbackHoverFraction({ componentId: "a", type: "PLAYBACK_SECONDS", value: -1 }, 10),
    ).toBeUndefined();
    expect(
      playbackHoverFraction({ componentId: "a", type: "PLAYBACK_SECONDS", value: 11 }, 10),
    ).toBeUndefined();
    expect(
      playbackHoverFraction({ componentId: "a", type: "PLAYBACK_SECONDS", value: 0 }, 0),
    ).toBeUndefined();
  });
});

describe("TimelineHoverCursor", () => {
  let publish: (seconds: number | undefined) => void = () => {};
  let setOther: ReturnType<typeof useSetHoverValue> = () => {};

  function Harness() {
    publish = usePublishPlaybackHover();
    setOther = useSetHoverValue();
    return <TimelineHoverCursor durationSec={10} />;
  }

  it("follows the published hover time and hides on clear or non-time hovers", () => {
    render(
      <TimelineInteractionStateProvider>
        <Harness />
      </TimelineInteractionStateProvider>,
    );
    const cursor = screen.getByTestId("timeline-hover-cursor");
    expect(cursor.style.display).toBe("none");

    act(() => {
      publish(2.5);
    });
    expect(cursor.style.display).toBe("block");
    expect(cursor.style.left).toBe("25%");

    act(() => {
      publish(undefined);
    });
    expect(cursor.style.display).toBe("none");

    // e.g. a Plot with a non-time x axis
    act(() => {
      setOther({ componentId: "plot", type: "OTHER", value: 5 });
    });
    expect(cursor.style.display).toBe("none");
  });
});
