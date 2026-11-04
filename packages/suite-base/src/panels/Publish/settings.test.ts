/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook, waitFor } from "@testing-library/react";

import { SettingsTreeAction } from "@lichtblick/suite";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

import { defaultConfig, usePublishPanelSettings } from "./settings";
import { PublishConfig } from "./types";

jest.mock("@lichtblick/suite-base/providers/PanelStateContextProvider", () => ({
  usePanelSettingsTreeUpdate: jest.fn(),
}));

const datatypes: RosDatatypes = new Map([
  ["pkg/A", { definitions: [{ name: "a", type: "int32" }] }],
  ["pkg/B", { definitions: [{ name: "b", type: "string" }] }],
]);
const topics = [{ name: "/b", schemaName: "pkg/B" }];

function setup(config: PublishConfig, { confirmResult }: { confirmResult: boolean }) {
  const updateTree = jest.fn();
  (usePanelSettingsTreeUpdate as jest.Mock).mockReturnValue(updateTree);
  let current = config;
  const saveConfig = jest.fn((update: unknown) => {
    current =
      typeof update === "function"
        ? (update as (c: PublishConfig) => PublishConfig)(current)
        : { ...current, ...(update as Partial<PublishConfig>) };
  });
  const confirmReplace = jest.fn(async () => confirmResult);
  renderHook(() => {
    usePublishPanelSettings(config, saveConfig, topics, datatypes, confirmReplace);
  });
  const handler = (
    updateTree.mock.lastCall![0] as { actionHandler: (a: SettingsTreeAction) => void }
  ).actionHandler;
  const selectTopic = (value: string) => {
    handler({
      action: "update",
      payload: { path: ["general", "topicName"], input: "autocomplete", value },
    });
  };
  return { selectTopic, confirmReplace, getConfig: () => current };
}

describe("usePublishPanelSettings", () => {
  it("replaces an unedited message with the new schema's template", () => {
    const { selectTopic, confirmReplace, getConfig } = setup(
      { ...defaultConfig, datatype: "pkg/A", value: '{\n  "a": 0\n}' },
      { confirmResult: false },
    );
    selectTopic("/b");
    expect(confirmReplace).not.toHaveBeenCalled();
    expect(getConfig()).toMatchObject({
      topicName: "/b",
      datatype: "pkg/B",
      value: '{\n  "b": ""\n}',
    });
  });

  it("asks before replacing an edited message and keeps it when declined", async () => {
    const { selectTopic, confirmReplace, getConfig } = setup(
      { ...defaultConfig, datatype: "pkg/A", value: '{"a": 5}' },
      { confirmResult: false },
    );
    selectTopic("/b");
    expect(confirmReplace).toHaveBeenCalledWith("pkg/B");
    await waitFor(() => {
      expect(getConfig()).toMatchObject({ topicName: "/b", datatype: "pkg/B", value: '{"a": 5}' });
    });
  });

  it("replaces an edited message when confirmed", async () => {
    const { selectTopic, getConfig } = setup(
      { ...defaultConfig, datatype: "pkg/A", value: '{"a": 5}' },
      { confirmResult: true },
    );
    selectTopic("/b");
    await waitFor(() => {
      expect(getConfig().value).toBe('{\n  "b": ""\n}');
    });
  });
});
