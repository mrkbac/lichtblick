// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { NumericType, VoxelGrid } from "@foxglove/schemas";
import * as THREE from "three";

import {
  BitVoxelGrid,
  decodeBitVoxelGrid,
  decodePackedVoxelGrid,
  VoxelBuffer,
  VoxelGridRenderable,
} from "./VoxelGrids";
import { Picker } from "../Picker";
import type { Renderer } from "../Renderer";
import {
  LayerSettingsVoxelGrid,
  packedVoxelGridSettingsNode,
  VOXEL_GRID_DEFAULTS,
} from "../settingsNodes/voxelGrids";

const settings = (overrides: Partial<LayerSettingsVoxelGrid>): LayerSettingsVoxelGrid => ({
  ...VOXEL_GRID_DEFAULTS,
  ...overrides,
});

function voxels(out: VoxelBuffer): { pos: number[]; rgba: number[]; cell: number }[] {
  return Array.from({ length: out.count }, (_, i) => ({
    pos: Array.from(out.positions.subarray(i * 3, i * 3 + 3)),
    rgba: Array.from(out.colors.subarray(i * 4, i * 4 + 4)),
    cell: out.cells[i]!,
  }));
}

describe("decodeBitVoxelGrid", () => {
  // 2x1 columns, 3 levels. Column 0: level 0 marked+present, level 1 present only, level 2
  // marked only. Column 1: empty.
  const grid: BitVoxelGrid = {
    header: { seq: 0, stamp: { sec: 0, nsec: 0 }, frame_id: "map" },
    data: new Uint32Array([(1 << 0) | (1 << 16) | (1 << 17) | (1 << 2), 0]),
    origin: { x: 0, y: 0, z: 0 },
    resolutions: { x: 0.5, y: 1, z: 2 },
    size_x: 2,
    size_y: 1,
    size_z: 3,
  };
  const byType = settings({
    bitColorMode: "type",
    markedPresentColor: "#ff0000ff",
    presentColor: "#00ff00ff",
    markedColor: "#0000ffff",
  });

  it("colors each voxel by its bits and places it at the cell center", () => {
    // Given a column with one voxel of each kind
    const out = new VoxelBuffer();

    // When decoding by type
    const error = decodeBitVoxelGrid(grid, byType, out);

    // Then each set voxel is drawn with its color, empty cells are skipped
    expect(error).toBeUndefined();
    expect(voxels(out)).toEqual([
      { pos: [0.25, 0.5, 1], rgba: [255, 0, 0, 255], cell: 0 },
      { pos: [0.25, 0.5, 3], rgba: [0, 255, 0, 255], cell: 2 },
      { pos: [0.25, 0.5, 5], rgba: [0, 0, 255, 255], cell: 4 },
    ]);
  });

  it("hides voxel kinds whose color is fully transparent", () => {
    // Given present-only and marked-only voxels with alpha 0
    const out = new VoxelBuffer();

    // When decoding
    decodeBitVoxelGrid(
      grid,
      { ...byType, presentColor: "#00ff0000", markedColor: "#0000ff00" },
      out,
    );

    // Then only the marked-and-present voxel is drawn
    expect(voxels(out).map((v) => v.cell)).toEqual([0]);
  });

  it("colors only marked-and-present voxels by height in rainbow mode", () => {
    // Given marked-and-present voxels on the lowest and highest level
    const out = new VoxelBuffer();
    const tall: BitVoxelGrid = { ...grid, data: new Uint32Array([0x10001 | 0x40004, 0x20000]) };

    // When decoding in rainbow mode
    decodeBitVoxelGrid(tall, settings({ bitColorMode: "rainbow" }), out);

    // Then the one-bit voxel is hidden and the two levels get the rainbow's ends
    const drawn = voxels(out);
    expect(drawn.map((v) => v.cell)).toEqual([0, 4]);
    expect(drawn[0]!.rgba).not.toEqual(drawn[1]!.rgba);
  });

  it("reports data that does not match the grid size", () => {
    const out = new VoxelBuffer();
    expect(decodeBitVoxelGrid({ ...grid, size_x: 3 }, byType, out)).toMatch(/data length/);
    expect(out.count).toBe(0);
  });
});

describe("decodePackedVoxelGrid", () => {
  // 2 columns x 1 row x 2 slices, one float32 "value" field plus padding
  function makeGrid(values: number[]): VoxelGrid {
    const data = new Uint8Array(values.length * 8);
    const view = new DataView(data.buffer);
    values.forEach((v, i) => {
      view.setFloat32(i * 8, v, true);
    });
    return {
      timestamp: { sec: 0, nsec: 0 },
      frame_id: "map",
      pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      row_count: 1,
      column_count: 2,
      cell_size: { x: 1, y: 2, z: 4 },
      slice_stride: 16,
      row_stride: 16,
      cell_stride: 8,
      fields: [{ name: "value", offset: 0, type: NumericType.FLOAT32 }],
      data,
    };
  }

  it("skips empty cells and walks slices, rows, then columns", () => {
    // Given cells with values 1, 0 (empty), NaN (empty) and 3
    const out = new VoxelBuffer();

    // When decoding with a flat color
    const error = decodePackedVoxelGrid(
      makeGrid([1, 0, NaN, 3]),
      settings({ colorMode: "flat", colorField: "value", flatColor: "#ffffffff" }),
      out,
    );

    // Then only the occupied cells are drawn, at their centers
    expect(error).toBeUndefined();
    expect(voxels(out)).toEqual([
      { pos: [0.5, 1, 2], rgba: [255, 255, 255, 255], cell: 0 },
      { pos: [1.5, 1, 6], rgba: [255, 255, 255, 255], cell: 3 },
    ]);
  });

  it("maps the occupied value range onto the gradient when min/max are auto", () => {
    // Given occupied values 2 and 4
    const out = new VoxelBuffer();

    // When decoding by gradient without a fixed range
    decodePackedVoxelGrid(
      makeGrid([2, 0, 0, 4]),
      settings({
        colorMode: "gradient",
        colorField: "value",
        gradient: ["#000000ff", "#ffffffff"],
      }),
      out,
    );

    // Then the lowest value gets the first color and the highest the second
    const drawn = voxels(out);
    expect(drawn[0]!.rgba).toEqual([0, 0, 0, 255]);
    expect(drawn[1]!.rgba).toEqual([255, 255, 255, 255]);
  });

  it("colors by separate RGBA fields and skips cells with alpha 0", () => {
    // Given uint8 rgba cells, the second one fully transparent
    const grid: VoxelGrid = {
      ...makeGrid([0, 0]),
      slice_stride: 8,
      row_stride: 8,
      cell_stride: 4,
      fields: (["red", "green", "blue", "alpha"] as const).map((name, offset) => ({
        name,
        offset,
        type: NumericType.UINT8,
      })),
      data: new Uint8Array([255, 0, 255, 128, 255, 255, 255, 0]),
    };
    const out = new VoxelBuffer();

    // When decoding by RGBA fields
    decodePackedVoxelGrid(grid, settings({ colorMode: "rgba-fields" }), out);

    // Then the opaque-ish cell keeps its color and alpha, and is flagged transparent
    expect(voxels(out)).toEqual([{ pos: [0.5, 1, 2], rgba: [255, 0, 255, 128], cell: 0 }]);
    expect(out.transparent).toBe(true);
  });

  it("reports strides that do not fit the grid", () => {
    const out = new VoxelBuffer();
    const grid = { ...makeGrid([1, 1, 1, 1]), slice_stride: 8 };
    expect(decodePackedVoxelGrid(grid, settings({ colorField: "value" }), out)).toMatch(
      /slice_stride/,
    );
  });

  it("grows its buffers past the initial capacity", () => {
    // Given more occupied cells than the first allocation holds
    const values = Array.from({ length: 3000 }, () => 1);
    const grid = {
      ...makeGrid(values),
      column_count: 3000,
      row_stride: 3000 * 8,
      slice_stride: 3000 * 8,
    };
    const out = new VoxelBuffer();

    // When decoding
    decodePackedVoxelGrid(grid, settings({ colorMode: "flat", colorField: "value" }), out);

    // Then every cell is kept
    expect(out.count).toBe(3000);
    expect(out.cells[2999]).toBe(2999);
  });

  it("rejects fields at a negative offset", () => {
    const grid = makeGrid([1, 1, 1, 1]);
    const bad = { ...grid, fields: [{ name: "value", offset: -1, type: NumericType.UINT8 }] };
    expect(
      decodePackedVoxelGrid(bad, settings({ colorField: "value" }), new VoxelBuffer()),
    ).toMatch(/does not fit/);
  });

  it("does not normalize a uint8 channel used as the color value", () => {
    // Given a uint8 "red" field colored by gradient over its raw range
    const grid: VoxelGrid = {
      ...makeGrid([0, 0]),
      slice_stride: 2,
      row_stride: 2,
      cell_stride: 1,
      fields: [{ name: "red", offset: 0, type: NumericType.UINT8 }],
      data: new Uint8Array([255, 1]),
    };
    const out = new VoxelBuffer();

    // When decoding with a fixed 0-255 range
    decodePackedVoxelGrid(
      grid,
      settings({
        colorMode: "gradient",
        colorField: "red",
        gradient: ["#000000ff", "#ffffffff"],
        minValue: 0,
        maxValue: 255,
      }),
      out,
    );

    // Then 255 maps to the top of the gradient
    expect(voxels(out)[0]!.rgba).toEqual([255, 255, 255, 255]);
  });
});

describe("packedVoxelGridSettingsNode", () => {
  it("offers only message fields to color by", () => {
    const node = packedVoxelGridSettingsNode({ name: "/voxels" }, { colorMode: "colormap" }, [
      "value",
      "intensity",
    ]);
    const field = node.fields?.colorField;
    expect(field?.input === "select" ? field.options.map((o) => o.value) : []).toEqual([
      "value",
      "intensity",
    ]);
  });
});

describe("Draw behind picking", () => {
  // A stub renderer that runs the picker's passes and records each draw's material state
  function setup() {
    const draws: { material: THREE.Material; depthWrite: boolean }[] = [];
    const scene = new THREE.Scene();
    const gl = {
      domElement: { width: 800, height: 400 },
      getPixelRatio: () => 1,
      getRenderTarget: () => null,
      getClearAlpha: () => 1,
      getClearColor: vi.fn(),
      setRenderTarget: vi.fn(),
      setClearColor: vi.fn(),
      clear: vi.fn(),
      readRenderTargetPixels: vi.fn(),
      render: (target: THREE.Scene, camera: THREE.Camera) => {
        target.onAfterRender(
          gl,
          target,
          camera,
          undefined as never,
          undefined as never,
          undefined as never,
        );
      },
      renderBufferDirect: (
        _camera: THREE.Camera,
        _scene: THREE.Scene,
        _geometry: THREE.BufferGeometry,
        material: THREE.Material,
      ) => {
        draws.push({ material, depthWrite: material.depthWrite });
      },
      renderLists: { get: () => ({ opaque: renderItems, transmissive: [], transparent: [] }) },
    } as unknown as THREE.WebGLRenderer;
    const renderer = {
      settings: { errors: { addToTopic: vi.fn(), removeFromTopic: vi.fn() } },
    } as unknown as Renderer;
    const grid: BitVoxelGrid = {
      header: { seq: 0, stamp: { sec: 0, nsec: 0 }, frame_id: "map" },
      data: new Uint32Array([0x10001]),
      origin: { x: 0, y: 0, z: 0 },
      resolutions: { x: 1, y: 1, z: 1 },
      size_x: 1,
      size_y: 1,
      size_z: 1,
    };
    const renderable = new VoxelGridRenderable("/voxels", renderer, {
      receiveTime: 0n,
      messageTime: 0n,
      frameId: "map",
      pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      settingsPath: ["topics", "/voxels"],
      settings: { ...VOXEL_GRID_DEFAULTS, drawBehind: true },
      topic: "/voxels",
      grid: { kind: "bit", message: grid },
    });
    renderable.update();
    const mesh = renderable.children[0] as THREE.Mesh;
    const renderItems = [
      { id: mesh.id, object: mesh, geometry: mesh.geometry, material: mesh.material },
    ];
    const camera = new THREE.PerspectiveCamera(45, 2, 0.5, 500);
    return { picker: new Picker(gl, scene), draws, mesh, renderable, camera };
  }

  it("lets later objects win the id pass but keeps depth and nearest-voxel picking", () => {
    const { picker, draws, mesh, renderable, camera } = setup();
    const { pickingMaterial, instancePickingMaterial } = mesh.userData as {
      pickingMaterial: THREE.Material;
      instancePickingMaterial: THREE.Material;
    };

    // Object id pass: the grid writes no depth, so foreground objects drawn after it win
    picker.pick(100, 100, camera);
    expect(draws.at(-1)).toEqual({ material: pickingMaterial, depthWrite: false });

    // Depth pass (measuring): the grid's surface is still recorded
    picker.pickDepth(100, 100, camera);
    expect(draws.at(-1)).toEqual({ material: pickingMaterial, depthWrite: true });

    // Instance pass: depth writes stay on, so the nearest voxel wins
    picker.pickInstance(100, 100, camera, renderable);
    expect(draws.at(-1)).toEqual({ material: instancePickingMaterial, depthWrite: true });
  });
});
