// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { desktopLaunchURL } from "./LaunchingInDesktopScreen";

describe("desktopLaunchURL", () => {
  it("hands the source, time and a share link's layout to the desktop app", () => {
    const url = desktopLaunchURL(
      new URL("https://app.example/?ds=remote-file&ds.url=https://data.example/a.mcap#layout=abc"),
    );
    expect(url.protocol).toBe("lichtblick:");
    expect(url.searchParams.get("ds.url")).toBe("https://data.example/a.mcap");
    expect(url.hash).toBe("#layout=abc");
  });
});
