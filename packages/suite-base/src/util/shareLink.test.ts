// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  MAX_SHARED_LAYOUT_LENGTH,
  buildShareLink,
  decodeSharedLayout,
  encodeSharedLayout,
  sharedLayoutFromHash,
} from "./shareLink";

const PAGE = "https://app.example/?time=2024-01-01T00:00:00.000000000Z";
const SOURCE = { ds: "remote-file", dsParams: { url: "https://data.example/run.mcap" } };

describe("shareLink", () => {
  it("round-trips a layout through a link fragment", async () => {
    const layout = { configById: { "Plot!1": { paths: [{ value: "/a.b" }] } }, layout: "Plot!1" };
    const encoded = await encodeSharedLayout(layout);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);

    const { link, layoutIncluded } = buildShareLink(
      PAGE,
      { ...SOURCE, time: { sec: 1700000000, nsec: 5 } },
      encoded,
    );
    expect(layoutIncluded).toBe(true);
    const url = new URL(link);
    expect(url.searchParams.get("time")).toBe("2023-11-14T22:13:20.000000005Z");
    expect(url.searchParams.get("ds.url")).toBe("https://data.example/run.mcap");
    expect(link).toContain("ds.url=https://data.example/run.mcap");

    const fromHash = sharedLayoutFromHash(url.hash);
    expect(JSON.parse(await decodeSharedLayout(fromHash!))).toEqual(layout);
  });

  it("leaves out a layout that is too large and drops time for live sources", () => {
    const { link, layoutIncluded } = buildShareLink(
      `${PAGE}#layout=old`,
      SOURCE,
      "x".repeat(MAX_SHARED_LAYOUT_LENGTH + 1),
    );
    expect(layoutIncluded).toBe(false);
    const url = new URL(link);
    expect(url.hash).toBe("");
    expect(url.searchParams.has("time")).toBe(false);
  });

  it("links the active source, not stale params in the address bar", () => {
    const { link } = buildShareLink(
      "https://app.example/?mcap-bundle=old&ds=remote-file&ds.url=https://data.example/old.mcap&layoutUrl=https://x.example/l.json",
      SOURCE,
      "abc",
    );
    const params = new URL(link).searchParams;
    expect([...params.keys()].sort()).toEqual(["ds", "ds.url"]);
    expect(params.get("ds.url")).toBe("https://data.example/run.mcap");
  });

  it("ignores other or oversized fragments", () => {
    expect(sharedLayoutFromHash("")).toBeUndefined();
    expect(sharedLayoutFromHash("#other=1")).toBeUndefined();
    expect(sharedLayoutFromHash("#layout=")).toBeUndefined();
    expect(sharedLayoutFromHash(`#layout=${"x".repeat(MAX_SHARED_LAYOUT_LENGTH + 1)}`)).toBe(
      undefined,
    );
  });
});
