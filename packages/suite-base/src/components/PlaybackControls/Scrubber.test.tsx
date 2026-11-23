/** @jest-environment jsdom */

// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PropsWithChildren, useEffect } from "react";

import { usePublishPanelTimeRange } from "@lichtblick/suite-base/PanelAPI";
import Panel from "@lichtblick/suite-base/components/Panel";
import { PanelTimeRange } from "@lichtblick/suite-base/context/TimelineInteractionStateContext";
import EventsProvider from "@lichtblick/suite-base/providers/EventsProvider";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import Scrubber from "./Scrubber";

vi.mock("@lichtblick/suite-base/hooks/useElementSize", () => ({
  useElementSize: () => ({ ref: undefined, width: 100 }),
}));

type TestConfig = { placeholder?: boolean };

function TestPanelBody({
  children,
}: PropsWithChildren<{
  config: TestConfig;
  saveConfig: SaveConfig<TestConfig>;
}>): React.JSX.Element {
  return <>{children}</>;
}
TestPanelBody.panelType = "Test";
TestPanelBody.defaultConfig = {};
const TestPanel = Panel(TestPanelBody);

function RangeControl({ range, label }: { range?: PanelTimeRange; label: string }) {
  const publish = usePublishPanelTimeRange();
  useEffect(() => {
    publish(range);
  }, [publish, range]);
  return <button>{label}</button>;
}

function TestWorkspace({
  showSecond = true,
  firstRange,
}: {
  showSecond?: boolean;
  firstRange: PanelTimeRange;
}) {
  return (
    <PanelSetup
      fixture={{
        activeData: {
          startTime: { sec: 1000, nsec: 0 },
          endTime: { sec: 1100, nsec: 0 },
        },
      }}
    >
      <TestPanel childId="Test!parent">
        <TestPanel childId="Test!first">
          <RangeControl label="First" range={firstRange} />
        </TestPanel>
        {showSecond && (
          <TestPanel childId="Test!second">
            <RangeControl label="Second" range={{ min: 70, max: 110 }} />
          </TestPanel>
        )}
      </TestPanel>
      <TestPanel childId="Test!other">
        <RangeControl label="Other" />
      </TestPanel>
      <EventsProvider>
        <Scrubber onSeek={vi.fn()} />
      </EventsProvider>
    </PanelSetup>
  );
}

describe("Scrubber focused panel range", () => {
  it("follows the innermost focused panel through viewport updates, switches, and removal", () => {
    const { rerender } = render(<TestWorkspace firstRange={{ min: 10, max: 30 }} />);
    const range = () => screen.queryByTestId("focused-panel-time-range");
    expect(range()).toBeNull();

    fireEvent.pointerDown(screen.getByRole("button", { name: "First" }));
    expect(range()).toHaveStyle({ left: "10%", width: "20%" });

    rerender(<TestWorkspace firstRange={{ min: 20, max: 35 }} />);
    expect(range()).toHaveStyle({ left: "20%", width: "15%" });

    fireEvent.wheel(screen.getByRole("button", { name: "Second" }));
    expect(range()).toHaveStyle({ left: "70%", width: "30%" });

    fireEvent.focus(screen.getByRole("button", { name: "Other" }));
    expect(range()).toBeNull();

    fireEvent.focus(screen.getByRole("button", { name: "Second" }));
    expect(range()).toBeInTheDocument();

    rerender(<TestWorkspace firstRange={{ min: 20, max: 35 }} showSecond={false} />);
    expect(range()).toBeNull();
  });
});
