/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";

import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";
import PublishBuilder from "@lichtblick/suite-base/testing/builders/PublishBuilder";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

import Publish from "./index";
import { PublishConfig } from "./types";

const mockPublish = vi.fn();

vi.mock("@lichtblick/suite-base/PanelAPI", () => ({
  useDataSourceInfo: vi.fn(() => ({
    topics: [],
    datatypes: new Map(),
    capabilities: [],
  })),
  useConfigById: vi.fn(() => [undefined, vi.fn()]),
}));

vi.mock("@lichtblick/suite-base/components/MessagePipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lichtblick/suite-base/components/MessagePipeline")>()),
  useMessagePipeline: vi.fn(() => undefined),
}));

vi.mock("@lichtblick/suite-base/hooks/usePublisher", () => ({
  __esModule: true,
  default: vi.fn(() => mockPublish),
}));

vi.mock("@lichtblick/suite-base/hooks/useCallbackWithToast", () => ({
  __esModule: true,
  default: (fn: unknown) => fn,
}));

vi.mock("@lichtblick/suite-base/providers/PanelStateContextProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lichtblick/suite-base/providers/PanelStateContextProvider")>()),
  usePanelSettingsTreeUpdate: vi.fn(),
  useDefaultPanelTitle: vi.fn(() => ["Publish", vi.fn()]),
}));

vi.mock("./settings", () => ({
  usePublishPanelSettings: vi.fn(),
  defaultConfig: {
    buttonText: "Publish",
    buttonTooltip: "",
    advancedView: true,
    value: "{}",
  },
}));

describe("Publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setup(
    configOverride: Partial<PublishConfig> = {},
    capabilities: string[] = [],
    datatypes: RosDatatypes = new Map(),
  ) {
    const config = PublishBuilder.config(configOverride);
    (useDataSourceInfo as Mock).mockReturnValue({
      topics: [],
      datatypes,
      capabilities,
    });

    const ui = (
      <PanelSetup>
        <Publish overrideConfig={config} />
      </PanelSetup>
    );

    return { ...render(ui), config };
  }

  describe("when advancedView is enabled", () => {
    it("renders the JSON textarea", () => {
      // Given / When
      setup({ advancedView: true });

      // Then
      expect(screen.getByPlaceholderText("Enter the message as JSON")).toBeInTheDocument();
    });
  });

  describe("when advancedView is disabled", () => {
    it("does not render the JSON textarea", () => {
      // Given / When
      setup({ advancedView: false });

      // Then
      expect(screen.queryByPlaceholderText("Enter the message as JSON")).not.toBeInTheDocument();
    });
  });

  describe("when not connected to a data source with publish capability", () => {
    it("shows a status message to connect to a data source", () => {
      // Given / When
      setup({}, []);

      // Then
      expect(
        screen.getByText("Connect to a data source that supports publishing"),
      ).toBeInTheDocument();
    });
  });

  describe("when connected but topic and datatype are not configured", () => {
    it("shows a status message to configure topic and schema", () => {
      // Given / When
      setup({ topicName: "", datatype: "" }, [PLAYER_CAPABILITIES.advertise]);

      // Then
      expect(
        screen.getByText("Configure a topic and message schema in the panel settings"),
      ).toBeInTheDocument();
    });
  });

  describe("when all publish conditions are met", () => {
    it("enables the publish button", () => {
      // Given / When
      const { config } = setup({ value: '{"data": "hello"}' }, [PLAYER_CAPABILITIES.advertise]);

      // Then
      expect(screen.getByRole("button", { name: config.buttonText })).not.toBeDisabled();
    });

    it("calls publish when the button is clicked", async () => {
      // Given
      const { config } = setup({ value: '{"data": "hello"}' }, [PLAYER_CAPABILITIES.advertise]);

      // When
      await userEvent.click(screen.getByRole("button", { name: config.buttonText }));

      // Then
      expect(mockPublish).toHaveBeenCalledWith({ data: "hello" });
    });
  });

  describe("when the JSON value is invalid", () => {
    it("shows a parse error", () => {
      // Given / When
      setup({ value: "not-json" }, [PLAYER_CAPABILITIES.advertise]);

      // Then
      expect(screen.getByText(/unexpected token/i)).toBeInTheDocument();
    });
  });

  describe("with a known message schema", () => {
    const datatypes: RosDatatypes = new Map([
      ["std_msgs/String", { definitions: [{ name: "data", type: "string" }] }],
    ]);

    it("edits the message in a form", () => {
      // Given / When
      setup({ datatype: "std_msgs/String", value: '{"data": "a"}' }, [], datatypes);

      // Then
      expect(screen.getByLabelText("data")).toHaveValue("a");
      expect(screen.queryByPlaceholderText("Enter the message as JSON")).not.toBeInTheDocument();
    });
  });

  describe("keyboard shortcut", () => {
    it("publishes on Ctrl+Enter", () => {
      // Given
      setup({ value: '{"data": "hello"}' }, [PLAYER_CAPABILITIES.advertise]);

      // When
      fireEvent.keyDown(screen.getByPlaceholderText("Enter the message as JSON"), {
        key: "Enter",
        ctrlKey: true,
      });

      // Then
      expect(mockPublish).toHaveBeenCalledWith({ data: "hello" });
    });
  });

  describe("repeated publishing", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function startRepeating() {
      const result = setup({ value: '{"data": 1}', publishRate: 10 }, [
        PLAYER_CAPABILITIES.advertise,
      ]);
      fireEvent.click(screen.getByRole("button", { name: "10 Hz" }));
      return result;
    }

    function advance(ms: number) {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    }

    it("publishes at the configured rate", () => {
      // Given / When
      startRepeating();
      advance(350);

      // Then
      expect(mockPublish).toHaveBeenCalledTimes(3);
      expect(screen.getByText("Publishing at 10 Hz")).toBeInTheDocument();
    });

    it("stops publishing when Stop is clicked", () => {
      // Given
      startRepeating();

      // When
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      advance(500);

      // Then
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it("stops publishing when the panel unmounts", () => {
      // Given
      const { unmount } = startRepeating();

      // When
      unmount();
      advance(500);

      // Then
      expect(mockPublish).not.toHaveBeenCalled();
    });
  });
});
