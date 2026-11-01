// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { SettingsTreeAction } from "@lichtblick/suite";

import { applySettingsAction, buildSettingsTree, Config, normalizeConfig } from "./config";

const update = (path: string[], value: unknown): SettingsTreeAction =>
  ({
    action: "update",
    payload: { path, input: "string", value },
  }) as SettingsTreeAction;
const nodeAction = (id: string, path: string[]): SettingsTreeAction => ({
  action: "perform-node-action",
  payload: { id, path },
});

describe("normalizeConfig", () => {
  it("migrates Leaflet-era layouts", () => {
    expect(normalizeConfig({ layer: "map" }).layers).toMatchObject([{ source: "osm" }]);
    expect(normalizeConfig({ layer: "satellite" }).layers).toMatchObject([
      { source: "esri-imagery" },
    ]);
    expect(
      normalizeConfig({
        layer: "custom",
        customTileUrl: "https://t/{z}/{x}/{y}",
        maxNativeZoom: 20,
      }).layers,
    ).toMatchObject([
      {
        source: "custom",
        custom: { kind: "raster", url: "https://t/{z}/{x}/{y}", maxZoom: 20 },
      },
    ]);
  });

  it("gives new panels a vector base map and keeps saved layers", () => {
    expect(normalizeConfig({}).layers).toMatchObject([{ source: "ofm-liberty" }]);
    const layers = [{ id: "a", source: "osm", visible: false, opacity: 0.3 }];
    expect(normalizeConfig({ layer: "satellite", layers }).layers).toEqual(layers);
  });
});

describe("applySettingsAction", () => {
  const base: Config = normalizeConfig({});
  const apply = (config: Config, ...actions: SettingsTreeAction[]) =>
    actions.reduce((c, a) => applySettingsAction(c, a, []), config);

  it("adds, reorders, and deletes layers", () => {
    let config = apply(base, nodeAction("add-layer", ["layers"]));
    expect(config.layers.map((l) => l.source)).toEqual(["esri-transportation", "ofm-liberty"]);
    config = apply(config, nodeAction("move-down", ["layers", "0"]));
    expect(config.layers.map((l) => l.source)).toEqual(["ofm-liberty", "esri-transportation"]);
    config = apply(config, {
      action: "reorder-node",
      payload: { path: ["layers", "1"], targetPath: ["layers", "0"] },
    });
    expect(config.layers.map((l) => l.source)).toEqual(["esri-transportation", "ofm-liberty"]);
    config = apply(config, nodeAction("delete-layer", ["layers", "0"]));
    expect(config.layers.map((l) => l.source)).toEqual(["ofm-liberty"]);
  });

  it("switches a layer to a custom or saved source", () => {
    let config = apply(base, update(["layers", "0", "source"], "custom:raster"));
    expect(config.layers[0]).toMatchObject({
      source: "custom",
      custom: { kind: "raster", url: "" },
    });
    config = apply(config, update(["layers", "0", "url"], " https://t/{z}/{x}/{y}.png "));
    expect(config.layers[0]!.custom!.url).toBe("https://t/{z}/{x}/{y}.png");

    const saved = [
      {
        kind: "dem" as const,
        url: "https://dem/{z}/{x}/{y}.png",
        encoding: "mapbox" as const,
      },
    ];
    config = applySettingsAction(config, update(["layers", "0", "source"], "saved:0"), saved);
    expect(config.layers[0]).toMatchObject({
      source: "custom",
      custom: saved[0],
    });
    // Elevation layers start with subtle shading.
    expect(config.layers[0]!.opacity).toBe(0.5);
  });

  it("toggles topics and drops a hidden follow topic", () => {
    let config = apply(base, update(["general", "followTopic"], "/gps"));
    config = apply(config, update(["topics", "/gps", "visible"], false));
    expect(config.disabledTopics).toEqual(["/gps"]);
    expect(config.followTopic).toBe("");
    config = apply(config, update(["topics", "/gps", "history"], "line"));
    expect(config.topicStyles["/gps"]).toEqual({ history: "line" });
  });

  it("resets the camera when rotation is turned off", () => {
    const config = apply(
      { ...base, bearing: 30, pitch: 45 },
      update(["general", "allowRotation"], false),
    );
    expect(config).toMatchObject({
      allowRotation: false,
      bearing: 0,
      pitch: 0,
    });
  });
});

describe("buildSettingsTree", () => {
  it("only offers position topics to follow", () => {
    const tree = buildSettingsTree(
      normalizeConfig({}),
      [
        { name: "/gps", schemaName: "sensor_msgs/NavSatFix" },
        { name: "/fence", schemaName: "foxglove.GeoJSON" },
      ],
      [],
      new Map(),
    );
    const follow = tree.general?.fields?.followTopic;
    expect(follow?.input === "select" && follow.options.map((o) => o.value)).toEqual(["", "/gps"]);
    expect(tree.topics?.children?.["/fence"]?.fields?.history).toBeUndefined();
  });
});
