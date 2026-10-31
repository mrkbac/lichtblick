/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { fromNanoSec } from "@lichtblick/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import { IteratorResult } from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";

import { RecordingInspector } from "./index";

jest.mock("@lichtblick/suite-base/components/PanelToolbar", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  ...jest.requireActual("@lichtblick/suite-base/components/MessagePipeline"),
  useMessagePipeline: jest.fn(),
}));
const actualUseMessagePipeline = jest.requireActual<
  typeof import("@lichtblick/suite-base/components/MessagePipeline")
>("@lichtblick/suite-base/components/MessagePipeline").useMessagePipeline;
const seek = jest.fn();
const pause = jest.fn();

async function* iterator(): AsyncIterableIterator<IteratorResult> {
  for (const sec of [0, 1, 9, 10]) {
    yield {
      type: "message-event",
      msgEvent: {
        topic: "/camera",
        receiveTime: { sec, nsec: 0 },
        message: {},
        sizeInBytes: 10,
        schemaName: "Image",
      },
    };
  }
}

function setup({ live = false }: { live?: boolean } = {}) {
  jest
    .mocked(useMessagePipeline)
    .mockImplementation((selector) =>
      actualUseMessagePipeline((ctx: MessagePipelineContext) =>
        selector({ ...ctx, getBatchIterator: () => iterator() }),
      ),
    );
  return render(
    <MockMessagePipelineProvider
      name="example.mcap"
      startTime={fromNanoSec(0n)}
      endTime={fromNanoSec(10_000_000_000n)}
      topics={[
        { name: "/camera", schemaName: "Image" },
        { name: "/imu", schemaName: "Imu" },
      ]}
      topicStats={
        new Map([
          ["/camera", { numMessages: 4 }],
          ["/imu", { numMessages: 10 }],
        ])
      }
      capabilities={live ? [] : [PLAYER_CAPABILITIES.playbackControl]}
      seekPlayback={seek}
      pausePlayback={pause}
    >
      <RecordingInspector />
    </MockMessagePipelineProvider>,
  );
}

it("filters topics by schema and preserves summary counts", () => {
  setup();
  expect(screen.getByText("14")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search topics or schemas"), {
    target: { value: "Image" },
  });
  expect(screen.getByRole("button", { name: "/camera" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "/imu" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Scan 1 topic" })).toBeEnabled();
});

it("scans a topic and seeks to the largest interval without starting playback", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "/camera" }));
  fireEvent.click(screen.getByRole("button", { name: "Scan this topic" }));
  await waitFor(() => {
    expect(screen.getByText("1/2 scanned")).toBeInTheDocument();
  });
  expect(screen.getByText("≈ 40 Bytes")).toBeInTheDocument();
  expect(screen.getByText("0.40 Hz")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "8.000 s" }));
  expect(pause).toHaveBeenCalled();
  expect(seek).toHaveBeenLastCalledWith({ sec: 1, nsec: 0 });
  fireEvent.click(screen.getByRole("button", { name: "/camera: 1 messages at +0.00 s" }));
  expect(seek).toHaveBeenLastCalledWith({ sec: 0, nsec: 0 });
});

it("disables recording scans for live sources", () => {
  setup({ live: true });
  expect(screen.getByRole("button", { name: "Scan 2 topics" })).toBeDisabled();
  expect(screen.getByText(/Live source: counts/)).toBeInTheDocument();
});

it("sorts message counts in both directions from the column header", () => {
  setup();
  const heading = screen.getByRole("button", { name: "Messages" });
  fireEvent.click(heading);
  const rowsDescending = screen.getAllByRole("row");
  expect(rowsDescending[1]).toHaveTextContent("/imu");
  expect(screen.getByRole("columnheader", { name: "Messages" })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  fireEvent.click(heading);
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("/camera");
  expect(screen.getByRole("columnheader", { name: "Messages" })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
});

it("renders metadata as labeled properties rather than raw JSON", () => {
  setup();
  fireEvent.click(screen.getByRole("tab", { name: "Metadata (1)" }));
  expect(screen.getByText("key", { selector: "dt" })).toBeInTheDocument();
  expect(screen.getByText("value", { selector: "dd" })).toBeInTheDocument();
  expect(document.querySelector("pre")).toBeNull();
});

it("keeps low-level chunk and file-offset details out of the panel", () => {
  setup();
  expect(screen.queryByRole("tab", { name: /Chunks/ })).not.toBeInTheDocument();
  expect(screen.queryByText("File offset")).not.toBeInTheDocument();
});

it("uses a shared scan, displays timing details, and reuses completed results", async () => {
  const shared = jest.fn(() => iterator());
  const decoded = jest.fn(() => iterator());
  jest.mocked(useMessagePipeline).mockImplementation((selector) =>
    actualUseMessagePipeline((ctx: MessagePipelineContext) =>
      selector({
        ...ctx,
        getBatchIterator: decoded,
        getInspectionIterator: shared,
      }),
    ),
  );
  render(
    <MockMessagePipelineProvider
      startTime={{ sec: 0, nsec: 0 }}
      endTime={{ sec: 10, nsec: 0 }}
      topics={[
        { name: "/front", schemaName: "Image", aliasedFromName: "/camera" },
        { name: "/imu", schemaName: "Imu" },
      ]}
      capabilities={[PLAYER_CAPABILITIES.playbackControl]}
    >
      <RecordingInspector />
    </MockMessagePipelineProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Scan 2 topics" }));
  await waitFor(() => {
    expect(screen.getByText("2/2 scanned")).toBeInTheDocument();
  });
  expect(shared).toHaveBeenCalledTimes(1);
  expect(shared).toHaveBeenCalledWith(["/camera", "/imu"], {
    start: { sec: 0, nsec: 0 },
    end: { sec: 10, nsec: 0 },
  });
  expect(decoded).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "/front" }));
  expect(screen.getByText("Median frequency")).toBeInTheDocument();
  expect(screen.getByText("0.13–1.00 Hz")).toBeInTheDocument();
  expect(screen.getByText("Timing jitter (σ)")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Scan 2 topics" }));
  expect(shared).toHaveBeenCalledTimes(1);
});

it("keeps namespace totals visible when collapsed and sorts folders by their combined counts", () => {
  render(
    <MockMessagePipelineProvider
      startTime={{ sec: 0, nsec: 0 }}
      endTime={{ sec: 10, nsec: 0 }}
      topics={[
        { name: "/a/one", schemaName: "" },
        { name: "/a/two", schemaName: "" },
        { name: "/b/one", schemaName: "" },
      ]}
      topicStats={
        new Map([
          ["/a/one", { numMessages: 6 }],
          ["/a/two", { numMessages: 6 }],
          ["/b/one", { numMessages: 10 }],
        ])
      }
    >
      <RecordingInspector />
    </MockMessagePipelineProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Tree" }));
  fireEvent.click(screen.getByRole("button", { name: "Messages" }));
  const group = screen.getByRole("button", { name: "/a 2 topics" });
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("/a");
  expect(group.closest("tr")).toHaveTextContent("12");
  expect(group.closest("tr")).toHaveTextContent("1.20 Hz");
  fireEvent.click(group);
  expect(screen.queryByRole("button", { name: "/a/one" })).not.toBeInTheDocument();
  expect(group.closest("tr")).toHaveTextContent("12");
});
