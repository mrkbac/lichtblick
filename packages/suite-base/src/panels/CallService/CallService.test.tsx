/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import PanelSetup, { Fixture } from "@lichtblick/suite-base/stories/PanelSetup";

import CallServicePanel from "./index";
import { Config } from "./types";

function setup(config: Partial<Config>, callService: jest.Mock) {
  const fixture: Fixture = {
    capabilities: [PLAYER_CAPABILITIES.callServices],
    datatypes: new Map([
      ["pkg/SetBool_Request", { definitions: [{ name: "data", type: "bool" }] }],
    ]),
    activeData: {
      serviceTypes: new Map([
        ["/set_bool", { type: "pkg/SetBool", requestSchemaName: "pkg/SetBool_Request" }],
      ]),
    },
    callService,
  };
  return render(
    <PanelSetup fixture={fixture}>
      <CallServicePanel overrideConfig={{ serviceName: "/set_bool", ...config }} />
    </PanelSetup>,
  );
}

describe("CallService", () => {
  it("fills in the request template once the request type is known", async () => {
    setup({ requestPayload: "{}" }, jest.fn());
    expect(await screen.findByLabelText("data")).not.toBeChecked();
  });

  it("calls the service with the form's request and shows the response", async () => {
    const callService = jest.fn().mockResolvedValue({ success: true });
    setup({ requestPayload: '{"data": true}' }, callService);

    expect(await screen.findByLabelText("data")).toBeChecked();
    await userEvent.click(screen.getByTestId("call-service-button"));

    expect(callService).toHaveBeenCalledWith("/set_bool", { data: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Response")).toHaveValue('{\n  "success": true\n}');
    });
    expect(screen.getByRole("combobox", { name: "Call history" })).toHaveTextContent(
      /\/set_bool · \d+ ms/,
    );

    await userEvent.click(screen.getByLabelText("Re-run call"));
    expect(callService).toHaveBeenCalledTimes(2);
  });

  it("calls the service on Ctrl+Enter and shows errors", async () => {
    const callService = jest.fn().mockRejectedValue(new Error("Service unavailable"));
    setup({ requestPayload: '{"data": true}' }, callService);

    fireEvent.keyDown(await screen.findByLabelText("data"), { key: "Enter", metaKey: true });

    expect(callService).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Response")).toHaveValue("Service unavailable");
    });
  });

  it("does not call the service with an invalid request", async () => {
    const callService = jest.fn();
    setup({ requestPayload: "{", editorMode: "json" }, callService);

    expect(await screen.findByTestId("call-service-button")).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("Message JSON"), { key: "Enter", ctrlKey: true });
    expect(callService).not.toHaveBeenCalled();
  });
});
