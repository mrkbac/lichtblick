// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { CustomLayerInterface, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { MercatorCoordinate } from "maplibre-gl";
import * as THREE from "three";

import { ObjectPool } from "@lichtblick/den/collection";

import type { IRenderer } from "./IRenderer";
import { SharedMap, mapCameraAngles } from "./SharedMap";
import { Transform, TransformTree } from "./transforms";

describe("mapCameraAngles", () => {
  it.each([0, 35, -120])("preserves bearing %s, pitch, and roll", (bearing) => {
    const matrix = new THREE.Matrix4()
      .makeRotationZ(THREE.MathUtils.degToRad(-bearing))
      .multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(40)))
      .multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(-12)));
    const angles = mapCameraAngles(matrix);
    expect(angles.bearing).toBeCloseTo(bearing);
    expect(angles.pitch).toBeCloseTo(40);
    expect(angles.roll).toBeCloseTo(12);
  });

  it("handles a straight-down camera without an undefined bearing", () => {
    const angles = mapCameraAngles(new THREE.Matrix4().makeRotationZ(-Math.PI / 2));
    expect(angles.bearing).toBeCloseTo(90);
    expect(angles.pitch).toBeCloseTo(0);
    expect(angles.roll).toBeCloseTo(0);
  });
});

describe("SharedMap", () => {
  it("shares the scene, reloads its custom layer after style changes, and hides unanchored maps", () => {
    const handlers = new Map<string, () => void>();
    let layer: CustomLayerInterface | undefined;
    let style: StyleSpecification = { version: 8, sources: {}, layers: [] };
    const map = {
      on: (event: string, handler: () => void) => handlers.set(event, handler),
      off: vi.fn(),
      remove: vi.fn(),
      getStyle: () => style,
      getLayer: () => layer,
      isStyleLoaded: () => true,
      addLayer: vi.fn((value: CustomLayerInterface) => {
        layer = value;
      }),
      setStyle: vi.fn((value: StyleSpecification) => {
        style = value;
        layer = undefined;
        handlers.get("style.load")?.();
      }),
      queryTerrainElevation: () => 0,
      setVerticalFieldOfView: vi.fn(),
      calculateCameraOptionsFromCameraLngLatAltRotation: vi.fn<
        MapLibreMap["calculateCameraOptionsFromCameraLngLatAltRotation"]
      >(() => ({ zoom: 10 })),
      getMinZoom: () => 0,
      getZoom: vi.fn(() => 10),
      getCanvas: vi.fn(() => ({ clientHeight: 800 })),
      jumpTo: vi.fn(),
      redraw: vi.fn(),
    };
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0, 20);
    const transformTree = new TransformTree(new ObjectPool(Transform.Empty));
    transformTree.addTransform("base", "map", 0n, Transform.Identity().setPosition([10, 20, 0]));
    const resetState = vi.fn();
    const setCameraState = vi.fn();
    const queueAnimationFrame = vi.fn();
    const renderer = {
      currentTime: 0n,
      transformTree,
      cameraHandler: { getActiveCamera: () => camera },
      getCameraState: () => ({ distance: 20 }),
      setCameraState,
      emit: vi.fn(),
      queueAnimationFrame,
      gl: { resetState },
      hud: { displayIfTrue: vi.fn() },
    } as unknown as IRenderer;
    const shared = new SharedMap(map as unknown as MapLibreMap, "map-layer");
    const draw = vi.fn();
    shared.attach(renderer, draw);
    const mapStyle: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [{ id: "background", type: "background" }],
    };
    shared.setStyle(mapStyle);
    expect(map.getStyle().layers).toEqual([]);
    shared.locate({ lat: 48, lon: 11, enuFrame: "map", position: new THREE.Vector3(10, 20, 0) }, 0);
    shared.render("base", "map");
    expect(map.getStyle()).toBe(mapStyle);
    expect(map.setVerticalFieldOfView).toHaveBeenCalledWith(45);
    expect(map.jumpTo).toHaveBeenCalled();
    expect(shared.maxCameraDistance).toBeCloseTo(
      800 /
        (2 *
          Math.tan(Math.PI / 8) *
          800 *
          MercatorCoordinate.fromLngLat([11, 48]).meterInMercatorCoordinateUnits()),
    );
    const [eye, altitude] = map.calculateCameraOptionsFromCameraLngLatAltRotation.mock.calls[0]!;
    expect(eye).toEqual(
      expect.objectContaining({ lng: expect.closeTo(11, 10), lat: expect.closeTo(48, 10) }),
    );
    expect(altitude).toBeCloseTo(20);
    shared.render("base", "map");
    expect(map.calculateCameraOptionsFromCameraLngLatAltRotation.mock.calls[1]).toEqual(
      map.calculateCameraOptionsFromCameraLngLatAltRotation.mock.calls[0],
    );
    expect(map.addLayer).toHaveBeenCalledTimes(3);
    const originalProjection = camera.projectionMatrix.clone();
    const origin = MercatorCoordinate.fromLngLat([11, 48]);
    const scale = origin.meterInMercatorCoordinateUnits();
    const renderToMercator = new THREE.Matrix4()
      .makeScale(scale, -scale, scale)
      .setPosition(origin.x, origin.y, 0);
    const mapProjection = originalProjection
      .clone()
      .multiply(camera.matrixWorldInverse)
      .multiply(renderToMercator.invert())
      .multiplyScalar(1000);
    layer!.render(
      {} as WebGL2RenderingContext,
      {
        defaultProjectionData: { mainMatrix: mapProjection.elements },
      } as unknown as Parameters<CustomLayerInterface["render"]>[1],
    );
    expect(draw).toHaveBeenCalledOnce();
    expect(resetState).toHaveBeenCalledTimes(2);
    expect(camera.projectionMatrix.elements[11]).toBe(-1);
    camera.projectionMatrix.elements.forEach((value, index) => {
      expect(value).toBeCloseTo(originalProjection.elements[index]!, 5);
    });
    const product = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.projectionMatrixInverse,
    );
    product.elements.forEach((value, index) => {
      expect(value).toBeCloseTo(new THREE.Matrix4().elements[index]!, 5);
    });
    // A collapsed panel must not clamp its saved orbit distance to zero.
    map.getCanvas.mockReturnValue({ clientHeight: 0 });
    shared.render("base", "map");
    expect(setCameraState).not.toHaveBeenCalled();
    expect(shared.maxCameraDistance).toBe(Infinity);
    map.getCanvas.mockReturnValue({ clientHeight: 800 });
    map.getZoom.mockReturnValue(11);
    shared.render("base", "map");
    expect(shared.maxCameraDistance).toBe(10);
    expect(setCameraState).toHaveBeenCalledWith({ distance: 10 });
    expect(queueAnimationFrame).toHaveBeenCalledOnce();
    shared.locate(undefined, 0);
    shared.render("base", "map");
    expect(map.getStyle().layers).toEqual([]);
    expect(shared.maxCameraDistance).toBe(Infinity);
    shared.dispose();
    expect(map.remove).toHaveBeenCalledOnce();
  });
});
