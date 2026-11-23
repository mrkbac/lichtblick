// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three/webgpu";

import { SettingsTreeField, Topic } from "@lichtblick/suite";
import {
  DEFAULT_POINT_SETTINGS,
  pointSettingsNode,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/settingsNodes/topics";
import { BasicBuilder } from "@lichtblick/test-builders";

import {
  createGeometry,
  HistoryLimits,
  payloadFingerprint,
  PointsRenderable,
  RenderObjectHistory,
  isSameRecord,
  pointStyle,
} from "./pointExtensionUtils";
import type { BaseUserData } from "../Renderable";
import type { Renderer } from "../Renderer";

type SettingsTreeFieldWithOptions = SettingsTreeField & {
  options: { label: string; value: string };
};

// Foxglove messages
const RGBA_OPTION = { label: "RGBA (separate fields)", value: "rgba-fields" };
const FOXGLOVE_POINTCLOUD_DATATYPE = "foxglove.PointCloud";
const VALID_MESSAGE_FIELDS = ["red", "blue", "green", "alpha"];

// ROS messages
const BGR_OPTION_ROS = { label: "BGR (packed)", value: "rgb" };
const BGRA_OPTION_ROS = { label: "BGRA (packed)", value: "rgba" };
const ROS_POINTCLOUD_DATATYPE = "sensor_msgs/PointCloud2";

describe("pointExtensionUtils", () => {
  describe("colorModeFields", () => {
    const createTopic = (topicArgs?: Partial<Topic>): Topic => {
      return {
        name: BasicBuilder.string(),
        schemaName: BasicBuilder.string(),
        ...topicArgs,
      };
    };

    it("should include RGBA color mode when topic schema is valid and contains RGBA fields", () => {
      const mockTopic = createTopic({ schemaName: FOXGLOVE_POINTCLOUD_DATATYPE });

      const panelSettings = pointSettingsNode(mockTopic, VALID_MESSAGE_FIELDS, {});
      const colorMode = panelSettings.fields.colorMode! as SettingsTreeFieldWithOptions;

      expect(colorMode.options).toEqual(expect.arrayContaining([RGBA_OPTION]));
      expect(colorMode.options).toEqual(
        expect.not.arrayContaining([BGR_OPTION_ROS, BGRA_OPTION_ROS]),
      );
    });

    it("should include RGBA color mode when topic is convertible to a valid schema and contains RGBA fields", () => {
      const mockTopic = createTopic({ convertibleTo: [FOXGLOVE_POINTCLOUD_DATATYPE] });

      const panelSettings = pointSettingsNode(mockTopic, VALID_MESSAGE_FIELDS, {});
      const colorMode = panelSettings.fields.colorMode! as SettingsTreeFieldWithOptions;

      expect(colorMode.options).toEqual(expect.arrayContaining([RGBA_OPTION]));
      expect(colorMode.options).toEqual(
        expect.not.arrayContaining([BGR_OPTION_ROS, BGRA_OPTION_ROS]),
      );
    });

    it("should not include RGBA color mode when topic has no RGBA fields", () => {
      const mockTopic = createTopic({ convertibleTo: [FOXGLOVE_POINTCLOUD_DATATYPE] });

      const panelSettings = pointSettingsNode(mockTopic, [], {});
      const colorMode = panelSettings.fields.colorMode! as SettingsTreeFieldWithOptions;

      expect(colorMode.options).toEqual(expect.not.arrayContaining([RGBA_OPTION]));
      expect(colorMode.options).toEqual(
        expect.not.arrayContaining([BGR_OPTION_ROS, BGRA_OPTION_ROS]),
      );
    });

    it("should not include RGBA color mode when topic schema is invalid, even with valid RGBA fields", () => {
      const mockTopic = createTopic();

      const panelSettings = pointSettingsNode(mockTopic, VALID_MESSAGE_FIELDS, {});
      const colorMode = panelSettings.fields.colorMode! as SettingsTreeFieldWithOptions;

      expect(colorMode.options).toEqual(expect.not.arrayContaining([RGBA_OPTION]));
      expect(colorMode.options).toEqual(
        expect.not.arrayContaining([BGR_OPTION_ROS, BGRA_OPTION_ROS]),
      );
    });

    it("should include BGR and BGRA color modes for ROS PointCloud2 messages", () => {
      const mockTopic = createTopic({ schemaName: ROS_POINTCLOUD_DATATYPE });

      const panelSettings = pointSettingsNode(mockTopic, BasicBuilder.strings(), {});
      const colorMode = panelSettings.fields.colorMode! as SettingsTreeFieldWithOptions;

      expect(colorMode.options).toEqual(expect.arrayContaining([BGR_OPTION_ROS, BGRA_OPTION_ROS]));
      expect(colorMode.options).toEqual(expect.not.arrayContaining([RGBA_OPTION]));
    });

    it("should include BGR and BGRA color modes for ROS PointCloud2 messages from message converter", () => {
      const mockTopic = createTopic({ convertibleTo: [ROS_POINTCLOUD_DATATYPE] });

      const panelSettings = pointSettingsNode(mockTopic, BasicBuilder.strings(), {});
      const colorMode = panelSettings.fields.colorMode! as SettingsTreeFieldWithOptions;

      expect(colorMode.options).toEqual(expect.arrayContaining([BGR_OPTION_ROS, BGRA_OPTION_ROS]));
      expect(colorMode.options).toEqual(expect.not.arrayContaining([RGBA_OPTION]));
    });
  });

  describe("pointShape", () => {
    const topic: Topic = { name: "/points", schemaName: ROS_POINTCLOUD_DATATYPE };

    it("shows cube size instead of point size for cubes", () => {
      const node = pointSettingsNode(topic, [], { pointShape: "cube", cubeSize: 0.2 });
      expect(node.fields.cubeSize?.value).toBe(0.2);
      expect(node.fields.pointSize).toBeUndefined();
    });

    it("offers an outline for cubes only", () => {
      expect(
        pointSettingsNode(topic, [], { pointShape: "cube" }).fields.showOutlines,
      ).toBeDefined();
      const sphere = pointSettingsNode(topic, [], { pointShape: "sphere", cubeSize: 0.3 });
      expect(sphere.fields.showOutlines).toBeUndefined();
      expect(sphere.fields.cubeSize?.label).toBe("Sphere size (m)");
      expect(sphere.fields.cubeSize?.value).toBe(0.3);
    });

    it("shows point size for flat shapes", () => {
      const node = pointSettingsNode(topic, [], { pointShape: "square" });
      expect(node.fields.pointSize).toBeDefined();
      expect(node.fields.cubeSize).toBeUndefined();
    });

    it("only offers the given shapes", () => {
      const node = pointSettingsNode(topic, [], {}, undefined, ["circle", "square"]);
      const pointShape = node.fields.pointShape as SettingsTreeFieldWithOptions;
      expect(pointShape.options).toEqual([
        { label: "Circle", value: "circle" },
        { label: "Square", value: "square" },
      ]);
    });
  });
});

describe("RenderObjectHistory", () => {
  type Params = ConstructorParameters<typeof RenderObjectHistory>[0];
  let live = 0;

  function entry(time: bigint, points: number) {
    live++;
    const geometry = new THREE.BufferGeometry();
    geometry.setDrawRange(0, points);
    const renderable = Object.assign(new THREE.Object3D(), {
      geometry,
      dispose: vi.fn(() => {
        live--;
      }),
      releaseMessage: vi.fn(),
    });
    return { receiveTime: time, messageTime: time, renderable };
  }

  function makeHistory(limits: HistoryLimits, decayTime = 1000) {
    live = 0;
    const parentRenderable = Object.assign(new THREE.Object3D(), {
      userData: { settings: { decayTime } },
    }) as unknown as Params["parentRenderable"];
    const history = new RenderObjectHistory({
      initial: entry(0n, 1),
      parentRenderable,
      renderer: {} as Renderer,
      limits,
    });
    return history;
  }

  it("caps the entry count on insert and disposes evicted entries", () => {
    const history = makeHistory({ maxEntries: 3, maxPoints: Infinity });
    for (let i = 1n; i <= 10n; i++) {
      history.addHistoryEntry(entry(i, 1));
    }
    expect(live).toBe(3);
    expect(history.latest().receiveTime).toBe(10n);
  });

  it("drops the oldest entries over the point budget, keeping the latest", () => {
    const history = makeHistory({ maxEntries: 100, maxPoints: 250 });
    for (let i = 1n; i <= 10n; i++) {
      history.addHistoryEntry(entry(i, 100));
    }
    history.updateHistoryFromCurrentTime(10n);
    expect(live).toBe(2);

    history.addHistoryEntry(entry(11n, 1_000));
    history.updateHistoryFromCurrentTime(11n);
    expect(live).toBe(1);
    expect(history.latest().receiveTime).toBe(11n);
  });

  it("keeps read-back entries within the point budget as they are inserted", () => {
    const history = makeHistory({ maxEntries: 100, maxPoints: 250 });
    history.addHistoryEntry(entry(100n, 100)); // the latest
    for (let i = 1n; i <= 10n; i++) {
      history.insertOlderEntry(entry(i, 100)); // a window read back after a seek
    }

    // Without waiting for the next frame's trim
    expect(live).toBe(2);
    expect(history.latest().receiveTime).toBe(100n);
  });

  it("releases the message of every entry but the latest", () => {
    const history = makeHistory({ maxEntries: 100, maxPoints: Infinity });
    const first = entry(1n, 1);
    const second = entry(2n, 1);
    history.addHistoryEntry(first);
    history.addHistoryEntry(second);
    expect(first.renderable.releaseMessage).toHaveBeenCalledTimes(1);
    expect(second.renderable.releaseMessage).not.toHaveBeenCalled();
  });

  it("disposes everything on dispose", () => {
    const history = makeHistory({ maxEntries: 100, maxPoints: Infinity });
    for (let i = 1n; i <= 5n; i++) {
      history.addHistoryEntry(entry(i, 1));
    }
    history.dispose();
    expect(live).toBe(0);
  });
});

describe("PointsRenderable mesh shapes", () => {
  function setup() {
    const geometry = createGeometry("/points", THREE.DynamicDrawUsage);
    geometry.resize(3);
    const points = new PointsRenderable("/points", { topic: "/points" } as BaseUserData, geometry);
    points.syncPoints();
    const all = () => {
      const found: THREE.Object3D[] = [];
      points.traverse((child) => found.push(child));
      return found;
    };
    const meshes = () => all().filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const lines = () =>
      all().filter((child): child is THREE.LineSegments => child instanceof THREE.LineSegments);
    const style = (shape: "point" | "cube" | "sphere", { outline = false } = {}) => ({
      ...pointStyle(DEFAULT_POINT_SETTINGS),
      shape,
      outline,
    });
    return { points, meshes, lines, style };
  }

  it("swaps the instanced geometry between cubes and spheres", () => {
    const { points, meshes, style } = setup();
    points.setStyle(style("cube"));
    const cubeVertices = meshes()[0]!.geometry.attributes.position!.count;
    points.setStyle(style("sphere"));
    expect(meshes()).toHaveLength(1);
    expect(meshes()[0]!.visible).toBe(true);
    expect(meshes()[0]!.geometry.attributes.position!.count).toBeGreaterThan(cubeVertices);
    points.setStyle(style("point"));
    expect(meshes()).toHaveLength(0);
    points.dispose();
  });

  it("draws cube outlines only when asked and never for spheres", () => {
    const { points, lines, style } = setup();
    points.setStyle(style("cube"));
    expect(lines()).toHaveLength(0);
    points.setStyle(style("cube", { outline: true }));
    expect(lines()).toHaveLength(1);
    points.setStyle(style("sphere", { outline: true }));
    expect(lines()).toHaveLength(0);
    points.dispose();
  });
});

describe("payloadFingerprint", () => {
  it("tells apart payloads that differ anywhere, not just where it might sample", () => {
    const payload = new Uint8Array(10_000).map((_, i) => i % 251);
    const changed = payload.slice();
    changed[5_003] = (changed[5_003]! + 1) % 256;

    expect(payloadFingerprint(payload)).toBe(payloadFingerprint(payload.slice()));
    expect(payloadFingerprint(changed)).not.toBe(payloadFingerprint(payload));
    // Unaligned views of the same bytes hash the same
    const shifted = new Uint8Array(10_001);
    shifted.set(payload, 1);
    expect(payloadFingerprint(shifted.subarray(1))).toBe(payloadFingerprint(payload));
  });
});

describe("isSameRecord", () => {
  // Hashing a view of a detached buffer throws
  const detached = new ArrayBuffer(4);
  const unread = new Uint8Array(detached);
  structuredClone(detached, { transfer: [detached] });

  it("hashes payloads only when both times tie", () => {
    const a = { receiveTime: 1n, messageTime: 1n, payload: unread };
    expect(isSameRecord(a, { ...a, receiveTime: 2n })).toBe(false);
    expect(isSameRecord({ ...a, recordId: "x" }, { ...a, recordId: "x" })).toBe(true);
    const bytes = Uint8Array.of(1, 2, 3);
    expect(isSameRecord({ ...a, payload: bytes }, { ...a, payload: bytes.slice() })).toBe(true);
    expect(isSameRecord({ ...a, payload: bytes }, { ...a, payload: Uint8Array.of(1) })).toBe(false);
  });
});
