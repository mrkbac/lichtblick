/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { DiagnosticInfo } from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import DiagnosticNodeRow, {
  NodeRowProps,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/DiagnosticNodeRow";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";
import DiagnosticsBuilder from "@lichtblick/suite-base/testing/builders/DiagnosticsBuilder";
import { BasicBuilder } from "@lichtblick/test-builders";

describe("DiagnosticNodeRow", () => {
  const onClick = vi.fn();
  const onClickPin = vi.fn();
  let info: DiagnosticInfo;
  let isPinned: boolean;
  let mockProps: NodeRowProps;

  beforeEach(() => {
    vi.clearAllMocks();
    info = DiagnosticsBuilder.info();
    isPinned = BasicBuilder.boolean();

    mockProps = { info, isPinned, onClick, onClickPin };
  });

  it("renders diagnostic node row and triggers onClick", () => {
    const displayName = info.displayName;

    render(
      <PanelSetup>
        <DiagnosticNodeRow {...mockProps} />
      </PanelSetup>,
    );
    const rowButton = screen.getByTestId("diagnostic-row-button");
    fireEvent.click(rowButton);

    expect(screen.getByText(displayName)).toBeInTheDocument();
    expect(onClick).toHaveBeenCalledWith(info);
  });

  it("triggers onClickPin when pin button is clicked", () => {
    render(
      <PanelSetup>
        <DiagnosticNodeRow {...mockProps} />
      </PanelSetup>,
    );

    const pinButton = screen.getByTestId("diagnostic-row-icon");
    fireEvent.click(pinButton);

    expect(onClickPin).toHaveBeenCalledWith(info);
  });

  it("seeks when the timeline is clicked without opening details", () => {
    const onSeek = vi.fn();
    render(
      <PanelSetup>
        <DiagnosticNodeRow
          {...mockProps}
          showHistory
          onSeek={onSeek}
          history={{ changes: [{ t: 0, level: 0 }], lastSeen: 10 }}
          range={{ start: 0, end: 10, current: 5 }}
        />
      </PanelSetup>,
    );

    const timeline = screen.getByTestId("diagnostic-timeline");
    jest
      .spyOn(timeline, "getBoundingClientRect")
      .mockReturnValue({ left: 0, width: 100 } as DOMRect);
    fireEvent.click(timeline, { clientX: 25 });

    expect(onSeek).toHaveBeenCalledWith(2.5);
    expect(onClick).not.toHaveBeenCalled();
  });
});
