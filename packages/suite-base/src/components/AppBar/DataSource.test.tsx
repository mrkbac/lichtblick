/** @vitest-environment jsdom */
// SPDX-License-Identifier: MPL-2.0

import { render, screen } from "@testing-library/react";

import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";

import { DataSource } from "./DataSource";

vi.mock("@lichtblick/suite-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: () => ({ closeSource: vi.fn() }),
}));
vi.mock("@lichtblick/suite-base/components/PlayerStatus/PlayerStatusPill", () => ({
  PlayerStatusPill: () => undefined,
}));
vi.mock("./EndTimestamp", () => ({ EndTimestamp: () => undefined }));

describe("DataSource", () => {
  it("treats a seekable live-history connection as live", () => {
    render(
      <MockMessagePipelineProvider
        name="ws://localhost:8765"
        presence={PlayerPresence.PRESENT}
        capabilities={[PLAYER_CAPABILITIES.playbackControl, PLAYER_CAPABILITIES.liveHistory]}
        seekPlayback={() => {}}
      >
        <DataSource />
      </MockMessagePipelineProvider>,
    );
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });
});
