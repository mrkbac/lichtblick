// SPDX-License-Identifier: MPL-2.0

import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import * as THREE from "three";

import type { Renderer } from "../Renderer";
import { Transform, TransformTree } from "../transforms";
import { LayerSettingsMap, Maps, groundHeight } from "./Maps";

vi.mock("../ModelCache", () => ({ createBundledDracoLoader: vi.fn() }));

function setup(locationFrame?: string) {
  const transformTree = new TransformTree();
  const time = 1532402927647951000n;
  transformTree.addTransform(
    "base_link",
    "map",
    time,
    Transform.Identity().setPosition([411.3039349319818, 1180.8903791765097, 0]),
  );
  const layer: LayerSettingsMap = {
    layerId: "lichtblick.Map",
    instanceId: "map",
    label: "Map",
    visible: true,
    layers: [],
    zOffset: 0,
    locationTopic: "/gps",
    locationFrame,
  };
  const config = { layers: { map: layer } };
  const renderer = {
    config,
    transformTree,
    coordinateFrameList: [],
    normalizeFrameId: (id: string) => id,
    addCustomLayerAction: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    queueAnimationFrame: vi.fn(),
    updateConfig: (fn: (draft: typeof config) => void) => {
      fn(config);
    },
    settings: {
      setNodesForKey: vi.fn(),
      errors: { remove: vi.fn() },
    },
    hud: { displayIfTrue: vi.fn(), removeGroup: vi.fn() },
  } as unknown as Renderer;
  const maps = new Maps(renderer);
  const renderable = maps.renderables.get("map")!;
  // Check anchoring without creating a WebGL map.
  const locate = vi.spyOn(renderable, "locate").mockImplementation(() => {});
  const fix = (frame_id?: string) => {
    maps.getSubscriptions()[0]!.subscription.handler({
      topic: "/gps",
      schemaName: "foxglove.LocationFix",
      receiveTime: { sec: 1532402927, nsec: 647951000 },
      message: { latitude: 1.2988182029528779, longitude: 103.7884476477048, frame_id },
      sizeInBytes: 18,
    });
    maps.startFrame(time, "map", "map");
  };
  return { maps, locate, fix, transformTree };
}

describe("Maps location frame", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("anchors the frameless nuScenes GPS fix at base_link's recorded position", () => {
    const { maps, locate, fix } = setup("base_link");
    fix();
    expect(locate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enuFrame: "map",
        position: expect.objectContaining({ x: 411.3039349319818, y: 1180.8903791765097 }),
      }),
    );
    maps.dispose();
  });

  it("uses the message frame by default and re-anchors when the override changes", () => {
    const { maps, locate, fix } = setup();
    fix("base_link");
    expect(locate.mock.lastCall?.[0]?.position.x).toBeCloseTo(411.3039349319818);
    maps.handleSettingsAction({
      action: "update",
      payload: { path: ["layers", "map", "locationFrame"], input: "select", value: "map" },
    });
    fix("base_link");
    expect(locate.mock.lastCall?.[0]?.position.x).toBe(0);
    maps.dispose();
  });

  it("waits for an explicitly selected frame instead of silently using the origin", () => {
    const { maps, locate, fix, transformTree } = setup("gps");
    fix();
    expect(locate.mock.lastCall?.[0]).toBeUndefined();
    transformTree.addTransform("gps", "map", 0n, Transform.Identity().setPosition([5, 6, 0]));
    fix();
    expect(locate.mock.lastCall?.[0]?.position.x).toBe(5);
    maps.dispose();
  });

  it("does not expose settings for the deleted texture renderer", () => {
    // Given
    const { maps } = setup();
    // When
    const fields = maps.settingsNodes()[0]!.node.fields;
    // Then
    expect(fields).not.toHaveProperty("rendering");
    expect(fields).not.toHaveProperty("size");
    expect(fields).not.toHaveProperty("drawBehind");
    expect(fields).toHaveProperty("locationFrame");
    expect(fields).toHaveProperty("zOffset");
    maps.dispose();
  });
});

describe("Maps ground height", () => {
  it("drops a NaN fix altitude", () => {
    const { maps, locate } = setup("base_link");
    maps.getSubscriptions()[0]!.subscription.handler({
      topic: "/gps",
      schemaName: "foxglove.LocationFix",
      receiveTime: { sec: 1532402927, nsec: 647951000 },
      message: { latitude: 1.3, longitude: 103.8, altitude: NaN },
      sizeInBytes: 18,
    });
    maps.startFrame(1532402927647951000n, "map", "map");
    expect(locate.mock.lastCall?.[0]).toEqual(expect.objectContaining({ altitude: undefined }));
    maps.dispose();
  });

  it("measures the tiles' ground height under the fix", () => {
    // A tile surface 123 m above the ellipsoid, placed somewhere in the scene.
    const lat = 48.1;
    const lon = 11.5;
    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    surface.matrixAutoUpdate = false;
    WGS84_ELLIPSOID.getEastNorthUpFrame(
      THREE.MathUtils.degToRad(lat),
      THREE.MathUtils.degToRad(lon),
      123,
      surface.matrix,
    );
    const tiles = new THREE.Group();
    tiles.add(surface);
    const placed = new THREE.Group();
    placed.position.set(5, -7, 300);
    placed.rotation.z = 0.4;
    placed.add(tiles);
    placed.updateMatrixWorld(true);
    expect(groundHeight(tiles, WGS84_ELLIPSOID, lat, lon)).toBeCloseTo(123, 3);
    expect(groundHeight(tiles, WGS84_ELLIPSOID, -lat, lon)).toBeUndefined();
  });
});
