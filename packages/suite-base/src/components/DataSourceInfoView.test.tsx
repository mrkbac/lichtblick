/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { DataSourceInfoView } from "@lichtblick/suite-base/components/DataSourceInfoView";
import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@lichtblick/suite-base/context/AppConfigurationContext";
import { RecordingFileInfo } from "@lichtblick/suite-base/players/types";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@lichtblick/suite-base/util/makeMockAppConfiguration";

function file(name: string, startSec: number, endSec: number): RecordingFileInfo {
  return {
    name,
    start: { sec: startSec, nsec: 0 },
    end: { sec: endSec, nsec: 0 },
    sizeBytes: 2048,
    library: "test",
    channels: [],
    schemaCount: 0,
    compression: [],
    attachments: [],
  };
}

describe("DataSourceInfoView", () => {
  it("summarises contents and lists files by start time with offsets", () => {
    render(
      <ThemeProvider isDark={false}>
        <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
          <MockMessagePipelineProvider
            startTime={{ sec: 100, nsec: 0 }}
            endTime={{ sec: 190, nsec: 0 }}
            topics={[
              { name: "/a", schemaName: "pkg/A" },
              { name: "/b", schemaName: "pkg/A" },
              { name: "/c", schemaName: "pkg/C" },
            ]}
            topicStats={
              new Map([
                ["/a", { numMessages: 1000 }],
                ["/b", { numMessages: 234 }],
              ])
            }
            activeData={{
              recordingFiles: [file("second.mcap", 160, 190), file("first.mcap", 100, 130)],
            }}
          >
            <DataSourceInfoView disableSource />
          </MockMessagePipelineProvider>
        </AppConfigurationContext.Provider>
      </ThemeProvider>,
    );

    expect(screen.getByText("Topics").parentElement).toHaveTextContent("3");
    expect(screen.getByText("Messages").parentElement).toHaveTextContent("1,234");
    expect(screen.getByText("Schemas").parentElement).toHaveTextContent("2");

    const text = document.body.textContent;
    expect(text.indexOf("first.mcap")).toBeLessThan(text.indexOf("second.mcap"));
    expect(screen.getByText(/\+0:01:00\.000 – \+0:01:30\.000/)).toHaveTextContent("2.0 KiB");
  });
});
