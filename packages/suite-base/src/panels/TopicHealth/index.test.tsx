/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { composeStories } from "storybook-react-rsbuild";

import * as stories from "./index.stories";

const { Recording, CountsOnly } = composeStories(stories);

describe("TopicHealth", () => {
  it("summarizes recording health and filters by status", async () => {
    render(<Recording />);
    // /gps ended 5 s before the playback time; /lidar/rear/points runs at 6 Hz against 10 Hz.
    const stale = await screen.findByRole("button", { name: "1 Stale" });
    expect(screen.getByRole("button", { name: "1 Slow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "6 OK" })).toBeInTheDocument();

    fireEvent.click(stale);
    expect(screen.getByText("/gps")).toBeInTheDocument();
    expect(screen.queryByText("/imu")).not.toBeInTheDocument();
  });

  it("searches topics and schemas", async () => {
    render(<Recording />);
    fireEvent.change(await screen.findByLabelText("Filter topics"), {
      target: { value: "pointcloud" },
    });
    expect(screen.getByText("/lidar/front/points")).toBeInTheDocument();
    expect(screen.queryByText("/imu")).not.toBeInTheDocument();
  });

  it("measures sources that only report message counts", async () => {
    render(<CountsOnly />);
    // 121 messages over 20 s is about 6 Hz, below the configured 10 Hz.
    expect(await screen.findByRole("button", { name: "1 Slow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7 OK" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Not measured/ })).not.toBeInTheDocument();
  });
});
