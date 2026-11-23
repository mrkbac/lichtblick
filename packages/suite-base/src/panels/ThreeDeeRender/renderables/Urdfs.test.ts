// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import * as urdf from "@lichtblick/den/urdf";
import { UrdfRobot } from "@lichtblick/den/urdf";

import { createRenderable, jointPositions, Urdfs } from "./Urdfs";
import { LoadedModel } from "../ModelCache";
import type { Renderer } from "../Renderer";
import { TransformTree } from "../transforms";
import { MESH_FETCH_FAILED, RenderableMeshResource } from "./markers/RenderableMeshResource";

vi.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => ({ default: "" }));

const meshErrors = { add: vi.fn(), remove: vi.fn(), hasError: vi.fn().mockReturnValue(false) };
const rendererStub = {
  normalizeFrameId: (id: string) => id,
  queueAnimationFrame: vi.fn(),
  settings: { errors: meshErrors },
  config: { topics: {} },
  modelCache: {
    load: async () => await new Promise(() => {}),
  } as unknown as Renderer["modelCache"],
};
const renderer = rendererStub as unknown as Renderer;

const robot: UrdfRobot = {
  name: "robot",
  links: new Map(),
  joints: new Map(),
  materials: new Map(),
};

describe("Urdfs createRenderable", () => {
  it.each([false, true])(
    "keeps URDF colors for plain OBJ models (warning: %s)",
    async (warning) => {
      // Given
      const cachedModel: LoadedModel = new THREE.Group();
      cachedModel.hasEmbeddedMaterials = false;
      cachedModel.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
      const load = vi
        .spyOn(renderer.modelCache, "load")
        .mockImplementation(async (_url, _opts, reportError) => {
          if (warning) {
            reportError(new Error("Missing optional material library"));
          }
          return cachedModel;
        });
      // When
      const renderable = createRenderable({
        visual: {
          geometry: { geometryType: "mesh", filename: "file:///plain.obj" },
          material: { color: { r: 1, g: 0, b: 0, a: 1 } },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
        },
        robot,
        id: 0,
        frameId: "base_link",
        renderer,
      }) as RenderableMeshResource;
      await vi.waitFor(() => {
        expect(renderable.children).toHaveLength(1);
      });
      // Then
      const mesh = renderable.children[0]!.children[0] as THREE.Mesh;
      expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xff0000);
      const added = meshErrors.add.mock.invocationCallOrder.at(-1) ?? 0;
      const removed = meshErrors.remove.mock.invocationCallOrder.at(-1) ?? 0;
      expect(added > removed).toBe(warning);
      load.mockRestore();
      renderable.dispose();
    },
  );

  it("preserves vertex colors and applies URDF fallback per OBJ mesh", async () => {
    // Given
    const model: LoadedModel = new THREE.Group();
    model.hasEmbeddedMaterials = false;
    const colored = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true }),
    );
    colored.geometry.setAttribute("color", new THREE.Float32BufferAttribute([0, 1, 0], 3));
    const plain = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    model.add(colored, plain);
    const load = vi.spyOn(renderer.modelCache, "load").mockResolvedValue(model);

    // When
    const renderable = createRenderable({
      visual: {
        geometry: { geometryType: "mesh", filename: "file:///mixed.obj" },
        material: { color: { r: 1, g: 0, b: 0, a: 1 } },
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
      },
      robot,
      id: 0,
      frameId: "base_link",
      renderer,
    }) as RenderableMeshResource;

    try {
      // Then
      await vi.waitFor(() => {
        expect(renderable.children).toHaveLength(1);
      });
      const meshes = renderable.children[0]!.children as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshStandardMaterial
      >[];
      expect(meshes[0]!.material).toBe(colored.material);
      expect(meshes[1]!.material.color.getHex()).toBe(0xff0000);
    } finally {
      load.mockRestore();
      renderable.dispose();
    }
  });

  it.each([false, true])("ignores late mesh loads after disposal (loaded: %s)", async (loaded) => {
    // Given
    const pending = Promise.withResolvers<LoadedModel | undefined>();
    let reportError!: (error: Error) => void;
    const load = vi
      .spyOn(renderer.modelCache, "load")
      .mockImplementation(async (_url, _opts, report) => {
        reportError = report;
        return await pending.promise;
      });
    const renderable = createRenderable({
      visual: {
        geometry: { geometryType: "mesh", filename: "file:///late.obj" },
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
      },
      robot,
      id: 0,
      frameId: "base_link",
      renderer,
    }) as RenderableMeshResource;
    // When
    renderable.dispose();
    meshErrors.add.mockClear();
    reportError(new Error("late mesh failure"));
    pending.resolve(loaded ? new THREE.Group() : undefined);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    // Then
    expect(renderable.children).toHaveLength(0);
    expect(meshErrors.add).not.toHaveBeenCalled();
    load.mockRestore();
  });

  it.each([
    ["mesh.glb", true],
    ["mesh.GLTF", true],
    ["mesh.dae", true],
    ["mesh.glb?token=abc", true],
    ["mesh.stl?v=glb", false],
    ["mesh.stl?preview=robot.glb#view", false],
    ["mesh.stl", false],
    ["mesh.obj", true],
  ])("uses embedded materials for %s: %s", (filename, expected) => {
    const renderable = createRenderable({
      visual: {
        geometry: { geometryType: "mesh", filename: `file:///${filename}` },
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
      },
      robot,
      id: 0,
      frameId: "base_link",
      renderer,
    }) as RenderableMeshResource;
    expect(renderable.userData.marker.mesh_use_embedded_materials).toBe(expected);
  });
});

describe("Urdfs mesh opacity", () => {
  it("fades a copy of the model's own materials and restores them", async () => {
    // Given a model with its own material
    const cachedMaterial = new THREE.MeshStandardMaterial({ opacity: 0.8, transparent: true });
    const model: LoadedModel = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(), cachedMaterial));
    const load = vi.spyOn(renderer.modelCache, "load").mockResolvedValue(model);
    const renderable = createRenderable({
      visual: {
        geometry: { geometryType: "mesh", filename: "file:///robot.dae" },
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
      },
      robot,
      id: 0,
      frameId: "base_link",
      renderer,
    }) as RenderableMeshResource;
    await vi.waitFor(() => {
      expect(renderable.children).toHaveLength(1);
    });
    const mesh = renderable.children[0]!.children[0] as THREE.Mesh;
    const marker = renderable.userData.marker;
    // When
    renderable.update({ ...marker, color: { ...marker.color, a: 0.5 } }, undefined);
    // Then
    const faded = mesh.material as THREE.MeshStandardMaterial;
    expect(faded).not.toBe(cachedMaterial);
    expect(faded.opacity).toBeCloseTo(0.4);
    expect(cachedMaterial.opacity).toBe(0.8);
    // When
    renderable.update({ ...marker, color: { ...marker.color, a: 1 } }, undefined);
    // Then
    expect((mesh.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.8);
    load.mockRestore();
    renderable.dispose();
  });
});

describe("URDF requests", () => {
  function createExtension(
    fetchAsset: Renderer["fetchAsset"],
    layer: Record<string, unknown> = {},
    overrides: Record<string, unknown> = {},
  ) {
    const addError = vi.fn();
    const removeError = vi.fn();
    const queueAnimationFrame = vi.fn();
    const context = {
      ...rendererStub,
      addCoordinateFrame: vi.fn(),
      queueAnimationFrame,
      config: {
        topics: {},
        layers: {
          robot: {
            layerId: "foxglove.Urdf",
            sourceType: "url",
            url: "https://example.com/old.urdf",
            label: "URDF",
            ...layer,
          },
        },
      },
      on: vi.fn(),
      addCustomLayerAction: vi.fn(),
      updateConfig: vi.fn(),
      settings: { errors: { add: addError, remove: removeError }, setNodesForKey: vi.fn() },
      fetchAsset,
      addTransform: vi.fn(),
      transformTree: { getOrCreateFrame: vi.fn() },
      ...overrides,
    };
    const extension = new Urdfs(context as unknown as Renderer);
    return { extension, addError, removeError, queueAnimationFrame, context };
  }

  it("clears the previous mesh error on the URDF path when reloading the robot", async () => {
    // Given
    const parse = vi.spyOn(urdf, "parseRobot").mockResolvedValue(robot);
    // When
    const { extension, removeError } = createExtension(async (uri) => ({
      uri,
      data: new TextEncoder().encode("URDF"),
    }));
    // Then
    await vi.waitFor(() => {
      expect(removeError).toHaveBeenCalledWith(["layers", "robot"], "MESH_FETCH_FAILED");
    });
    parse.mockRestore();
    extension.dispose();
  });

  it("reports a fetch that rejects with a non-Error value", async () => {
    // Given
    const { extension, addError } = createExtension(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "offline";
    });
    // Then
    await vi.waitFor(() => {
      expect(addError).toHaveBeenCalledWith(
        ["layers", "robot"],
        "FetchUrdf",
        'Failed to load URDF from "https://example.com/old.urdf": offline',
      );
    });
    extension.dispose();
  });

  it.each(["success", "failure"])("ignores a superseded fetch %s", async (result) => {
    // Given
    const request = Promise.withResolvers<{ uri: string; data: Uint8Array }>();
    const { extension, addError } = createExtension(async () => await request.promise);
    const renderable = extension.renderables.get("robot")!;
    renderable.userData.fetching = undefined;
    renderable.userData.urdf = "new selection";
    addError.mockClear();
    // When
    if (result === "success") {
      request.resolve({
        uri: "https://example.com/old.urdf",
        data: new TextEncoder().encode("old response"),
      });
    } else {
      request.reject(new Error("old failure"));
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    // Then
    expect(renderable.userData.urdf).toBe("new selection");
    expect(addError).not.toHaveBeenCalled();
    extension.dispose();
  });
  it.each(["success", "failure"])(
    "ignores an identical-content parse %s after reloading",
    async (result) => {
      // Given
      const previous = Promise.withResolvers<UrdfRobot>();
      const current = Promise.withResolvers<UrdfRobot>();
      const parse = vi
        .spyOn(urdf, "parseRobot")
        .mockImplementationOnce(async () => await previous.promise)
        .mockImplementation(async () => await current.promise);
      const { extension, addError, queueAnimationFrame } = createExtension(async (uri) => ({
        uri,
        data: new TextEncoder().encode("same URDF"),
      }));
      await vi.waitFor(() => {
        expect(parse).toHaveBeenCalledTimes(1);
      });
      // When
      const layer = extension
        .settingsNodes()
        .find((entry) => entry.path[0] === "layers" && entry.path[1] === "robot")!;
      layer.node.handler!({
        action: "update",
        payload: { path: ["layers", "robot", "displayMode"], input: "select", value: "visual" },
      });
      await vi.waitFor(() => {
        expect(parse).toHaveBeenCalledTimes(2);
      });
      queueAnimationFrame.mockClear();
      addError.mockClear();
      if (result === "success") {
        previous.resolve(robot);
      } else {
        previous.reject(new Error("previous parse failed"));
      }
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      // Then
      expect(queueAnimationFrame).not.toHaveBeenCalled();
      expect(addError).not.toHaveBeenCalled();
      parse.mockRestore();
      extension.dispose();
    },
  );
  it.each([false, true])(
    "clears stale parent mesh errors and preserves current warnings (%s)",
    async (warning) => {
      // Given
      const visual = {
        geometry: { geometryType: "mesh" as const, filename: "model.obj" },
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
      };
      const parsed: UrdfRobot = {
        ...robot,
        links: new Map([["base_link", { name: "base_link", visuals: [visual], colliders: [] }]]),
      };
      const parse = vi.spyOn(urdf, "parseRobot").mockResolvedValue(parsed);
      const fetching = Promise.withResolvers<{ uri: string; data: Uint8Array }>();
      const { extension, context, addError } = createExtension(async () => await fetching.promise);
      let message: string | undefined = "previous mesh failure";
      context.settings.errors.remove.mockImplementation((path: readonly string[], code: string) => {
        if (path.join("/") === "layers/robot" && code === MESH_FETCH_FAILED) {
          message = undefined;
        }
      });
      addError.mockImplementation((path: readonly string[], code: string, value: string) => {
        if (path.join("/") === "layers/robot" && code === MESH_FETCH_FAILED) {
          message = value;
        }
      });
      const model = new THREE.Group();
      model.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
      const load = vi
        .spyOn(context.modelCache, "load")
        .mockImplementation(async (_url, _opts, reportError) => {
          await Promise.resolve();
          if (warning) {
            reportError(new Error("current appearance warning"));
          }
          return model;
        });
      // When
      fetching.resolve({
        uri: "https://example.com/robot.urdf",
        data: new TextEncoder().encode("robot"),
      });
      const parent = extension.renderables.get("robot")!;
      await vi.waitFor(() => {
        expect(parent.children[0]?.children).toHaveLength(1);
      });
      // Then
      expect(message).toBe(
        warning
          ? 'Error loading mesh from "https://example.com/model.obj": current appearance warning'
          : undefined,
      );
      load.mockRestore();
      parse.mockRestore();
      extension.dispose();
    },
  );

  it("drops a joint's manual offset when the field is cleared instead of saving NaN", async () => {
    // Given a robot with one revolute joint that has a manual angle
    const jointRobot: UrdfRobot = {
      ...robot,
      joints: new Map([
        [
          "j1",
          {
            name: "j1",
            jointType: "revolute",
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
            parent: "base",
            child: "link",
            axis: { x: 0, y: 0, z: 1 },
          },
        ],
      ]),
    };
    const parse = vi.spyOn(urdf, "parseRobot").mockResolvedValue(jointRobot);
    const { extension, context } = createExtension(async (uri) => ({
      uri,
      data: new TextEncoder().encode("URDF"),
    }));
    const frame: { id: string; offsetEulerDegrees: number[] | undefined } = {
      id: "link",
      offsetEulerDegrees: [0, 0, 30],
    };
    context.transformTree.getOrCreateFrame.mockReturnValue(frame);
    await vi.waitFor(() => {
      expect(context.addTransform).toHaveBeenCalled();
    });
    const entry = extension.settingsNodes().find((e) => e.path[1] === "robot");

    // When the manual angle is cleared
    entry?.node.handler?.({
      action: "update",
      payload: {
        path: ["layers", "robot", "joints", "j1", "manual"],
        input: "number",
        value: undefined,
      },
    });

    // Then
    expect(frame.offsetEulerDegrees).toBeUndefined();
    parse.mockRestore();
    extension.dispose();
  });

  describe("joint states control mode", () => {
    const meshVisual = {
      geometry: { geometryType: "mesh" as const, filename: "model.stl" },
      origin: { xyz: { x: 1, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
    };
    const armRobot: UrdfRobot = {
      ...robot,
      links: new Map([
        ["base", { name: "base", visuals: [], colliders: [] }],
        ["arm", { name: "arm", visuals: [meshVisual], colliders: [] }],
      ]),
      joints: new Map([
        [
          "shoulder",
          {
            name: "shoulder",
            jointType: "revolute",
            origin: { xyz: { x: 1, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
            parent: "base",
            child: "arm",
            axis: { x: 0, y: 0, z: 1 },
          },
        ],
      ]),
    };

    async function setup(layer: Record<string, unknown>) {
      const parse = vi.spyOn(urdf, "parseRobot").mockResolvedValue(armRobot);
      const transformTree = new TransformTree();
      transformTree.getOrCreateFrame("base");
      const config = {
        topics: {},
        layers: {
          robot: {
            layerId: "foxglove.Urdf",
            sourceType: "url",
            url: "https://example.com/arm.urdf",
            label: "URDF",
            ...layer,
          } as Record<string, unknown>,
        },
      };
      const { extension } = createExtension(
        async (uri) => ({ uri, data: new TextEncoder().encode("URDF") }),
        layer,
        {
          transformTree,
          config,
          topics: [{ name: "/arm/joints", schemaName: "sensor_msgs/JointState" }],
          updateConfig: (update: (draft: typeof config) => void) => {
            update(config);
          },
          removeTransform: vi.fn(),
          sharedGeometry: { getGeometry: (_key: string, create: () => unknown) => create() },
        },
      );
      const parent = extension.renderables.get("robot")!;
      await vi.waitFor(() => {
        expect(parent.userData.parts).toHaveLength(1);
      });
      parse.mockRestore();
      return { extension, parent, config };
    }

    function publishJointState(extension: Urdfs, position: number) {
      const subscription = extension
        .getSubscriptions()
        .find((sub) => sub.type === "schema" && sub.schemaNames.has("sensor_msgs/JointState"))!;
      subscription.subscription.handler({
        topic: "/arm/joints",
        schemaName: "sensor_msgs/JointState",
        receiveTime: { sec: 1, nsec: 0 },
        sizeInBytes: 0,
        message: { name: ["shoulder"], position: [position] },
      } as never);
      return subscription;
    }

    it("places links by forward kinematics from the first joint states topic", async () => {
      // Given
      const { extension, parent } = await setup({ controlMode: "jointStates" });
      // When
      const subscription = publishJointState(extension, Math.PI / 2);
      extension.startFrame(0n, "base", "base");
      // Then the visual, 1 m along the arm, swings 90° around the shoulder at x = 1
      const part = parent.userData.parts[0]!.object;
      expect(part.visible).toBe(true);
      expect(part.position.x).toBeCloseTo(1);
      expect(part.position.y).toBeCloseTo(1);
      expect(subscription.subscription.shouldSubscribe?.("/arm/joints")).toBe(true);
      extension.dispose();
    });

    it("hides a link and applies its offset", async () => {
      // Given
      const { extension, parent } = await setup({
        controlMode: "jointStates",
        links: { arm: { position: [0, 0, 2] } },
      });
      // When
      extension.startFrame(0n, "base", "base");
      // Then
      const part = parent.userData.parts[0]!.object;
      expect(part.position.toArray()).toEqual([2, 0, 2]);
      // When the link is hidden
      const entry = extension.settingsNodes().find((e) => e.path[1] === "robot")!;
      entry.node.handler!({
        action: "update",
        payload: {
          path: ["layers", "robot", "links", "arm", "visible"],
          input: "boolean",
          value: false,
        },
      });
      extension.startFrame(0n, "base", "base");
      // Then
      expect(part.visible).toBe(false);
      extension.dispose();
    });

    it("does not subscribe to joint states in transforms mode", async () => {
      // Given
      const { extension } = await setup({});
      // When
      const subscription = publishJointState(extension, 0);
      // Then
      expect(subscription.subscription.shouldSubscribe?.("/arm/joints")).toBe(false);
      extension.dispose();
    });

    it("applies opacity, outlines and axes in place", async () => {
      // Given
      const { extension, parent } = await setup({});
      const part = parent.userData.parts[0]!.object as RenderableMeshResource;
      const entry = extension.settingsNodes().find((e) => e.path[1] === "robot")!;
      const update = (field: string, value: unknown) => {
        entry.node.handler!({
          action: "update",
          payload: { path: ["layers", "robot", field], input: "number", value } as never,
        });
      };
      // When
      update("opacity", 0.25);
      update("showOutlines", false);
      update("showAxis", true);
      update("axisScale", 2);
      // Then the same renderable is kept, faded, without outlines, with one axis per link
      expect(parent.userData.parts[0]!.object).toBe(part);
      expect(part.userData.marker.color.a).toBeCloseTo(0.25);
      expect(part.getSettings()?.showOutlines).toBe(false);
      expect(parent.userData.axes.map((axis) => axis.frameId)).toEqual(["base", "arm"]);
      expect(parent.userData.axes[0]!.object.scale.x).toBe(2);
      // When
      update("showAxis", false);
      // Then
      expect(parent.userData.axes).toHaveLength(0);
      extension.dispose();
    });
  });
});

describe("jointPositions", () => {
  it("reads sensor_msgs/JointState, foxglove.JointStates and foxglove.JointState", () => {
    expect(jointPositions({ name: ["a", "b"], position: [1, 2] })).toEqual({
      names: ["a", "b"],
      positions: [1, 2],
    });
    expect(
      jointPositions({ joints: [{ name: "a", position: 1 }, { name: "b" }, undefined] }),
    ).toEqual({ names: ["a", "b", undefined], positions: [1, undefined, undefined] });
    expect(jointPositions({ name: "a", position: 0.5 })).toEqual({
      names: ["a"],
      positions: [0.5],
    });
    expect(jointPositions({})).toEqual({ names: [], positions: [] });
  });
});
