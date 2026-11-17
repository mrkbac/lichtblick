// SPDX-License-Identifier: MPL-2.0

import { decodeGridMapLayer } from "./GridMaps";
import { Float32MultiArray } from "../ros";
import { resolveGridMapLayers } from "../settingsNodes/topics";

const sizeX = 3; // matrix rows, along -x
const sizeY = 2; // matrix columns, along -y
// Logical cell (i, j) holds 10 * i + j
const cell = (i: number, j: number) => 10 * i + j;
// Unwrapped output, x fastest, growing along +x and +y: tx = sizeX - 1 - i, ty = sizeY - 1 - j
const expected = [21, 11, 1, 20, 10, 0];

/** A layer stored in a circular buffer starting at (startX, startY). */
function layer({
  rowMajor,
  startX,
  startY,
}: {
  rowMajor: boolean;
  startX: number;
  startY: number;
}): Float32MultiArray {
  const data: number[] = [];
  const logical = (b: number, start: number, size: number) => (b - start + size) % size;
  if (rowMajor) {
    for (let bi = 0; bi < sizeX; bi++) {
      for (let bj = 0; bj < sizeY; bj++) {
        data.push(cell(logical(bi, startX, sizeX), logical(bj, startY, sizeY)));
      }
    }
  } else {
    for (let bj = 0; bj < sizeY; bj++) {
      for (let bi = 0; bi < sizeX; bi++) {
        data.push(cell(logical(bi, startX, sizeX), logical(bj, startY, sizeY)));
      }
    }
  }
  const dim = rowMajor
    ? [
        { label: "row_index", size: sizeX, stride: sizeX * sizeY },
        { label: "column_index", size: sizeY, stride: sizeY },
      ]
    : [
        { label: "column_index", size: sizeY, stride: sizeX * sizeY },
        { label: "row_index", size: sizeX, stride: sizeX },
      ];
  return { layout: { dim, data_offset: 0 }, data };
}

describe("decodeGridMapLayer", () => {
  it.each([
    ["column-major", false, 0, 0],
    ["column-major, wrapped", false, 1, 1],
    ["column-major, wrapped x only", false, 2, 0],
    ["row-major", true, 0, 0],
    ["row-major, wrapped", true, 2, 1],
  ])("unwraps %s storage", (_name, rowMajor, startX, startY) => {
    const out = new Float32Array(sizeX * sizeY);
    expect(
      decodeGridMapLayer(
        layer({ rowMajor, startX, startY }),
        { sizeX, sizeY },
        startX,
        startY,
        out,
      ),
    ).toBeUndefined();
    expect(Array.from(out)).toEqual(expected);
  });

  it("reads the default column-major layout when dims are missing", () => {
    const out = new Float32Array(sizeX * sizeY);
    const { data } = layer({ rowMajor: false, startX: 0, startY: 0 });
    decodeGridMapLayer({ layout: { dim: [], data_offset: 0 }, data }, { sizeX, sizeY }, 0, 0, out);
    expect(Array.from(out)).toEqual(expected);
  });

  it("honors data_offset", () => {
    const out = new Float32Array(sizeX * sizeY);
    const array = layer({ rowMajor: false, startX: 0, startY: 0 });
    array.layout.data_offset = 2;
    array.data = [99, 99, ...array.data];
    decodeGridMapLayer(array, { sizeX, sizeY }, 0, 0, out);
    expect(Array.from(out)).toEqual(expected);
  });

  it("rejects a layer with too few values", () => {
    const out = new Float32Array(sizeX * sizeY);
    const array = layer({ rowMajor: false, startX: 0, startY: 0 });
    array.data = array.data.slice(1);
    expect(decodeGridMapLayer(array, { sizeX, sizeY }, 0, 0, out)).toMatch(/expected 6/);
  });
});

describe("resolveGridMapLayers", () => {
  it("defaults to a layer named elevation for both roles", () => {
    expect(resolveGridMapLayers({}, ["color", "elevation"])).toEqual({
      colorLayer: "elevation",
      elevationLayer: "elevation",
    });
  });

  it("uses no elevation and the first layer without an elevation layer", () => {
    expect(resolveGridMapLayers({}, ["traversability", "variance"])).toEqual({
      colorLayer: "traversability",
      elevationLayer: undefined,
    });
  });

  it("keeps the user's picks, including an explicit none", () => {
    expect(
      resolveGridMapLayers({ colorLayer: "variance", elevationLayer: "" }, [
        "elevation",
        "variance",
      ]),
    ).toEqual({ colorLayer: "variance", elevationLayer: undefined });
  });
});
