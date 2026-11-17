// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { NumericType, VoxelGrid } from "@foxglove/schemas";
import { StoryObj } from "storybook-react-rsbuild";

import { MessageEvent } from "@lichtblick/suite";
import { Topic } from "@lichtblick/suite-base/players/types";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";

import { QUAT_IDENTITY, rad2deg } from "./common";
import useDelayedFixture from "./useDelayedFixture";
import ThreeDeePanel from "../index";
import type { BitVoxelGrid } from "../renderables/VoxelGrids";
import type { LayerSettingsVoxelGrid } from "../settingsNodes/voxelGrids";

export default {
  title: "panels/ThreeDeeRender",
  component: ThreeDeePanel,
  parameters: { colorScheme: "light" },
};

const SIZE = 40;
const LEVELS = 16;

/** Height of a smooth synthetic terrain at (x, y), in levels */
function terrain(x: number, y: number): number {
  return 3 + 4 * Math.sin(x / 5) * Math.cos(y / 7) + 3 * Math.sin((x + y) / 11);
}

/** A costmap-style column grid: solid terrain marked, a strip of one-bit voxels above it. */
function makeBitGrid(): BitVoxelGrid {
  const data = new Uint32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const top = Math.max(1, Math.min(LEVELS - 2, Math.round(terrain(x, y))));
      let column = 0;
      for (let z = 0; z < top; z++) {
        column |= (1 << z) | (1 << (z + 16));
      }
      // Above the terrain: a present-only voxel, and a marked-only voxel on every other column
      column |= 1 << (top + 16);
      if ((x + y) % 2 === 0) {
        column |= 1 << (top + 1);
      }
      data[y * SIZE + x] = column >>> 0;
    }
  }
  return {
    header: { seq: 0, stamp: { sec: 0, nsec: 0 }, frame_id: "map" },
    data,
    origin: { x: -SIZE * 0.05 - 2.2, y: -SIZE * 0.05, z: 0 },
    resolutions: { x: 0.1, y: 0.1, z: 0.1 },
    size_x: SIZE,
    size_y: SIZE,
    size_z: LEVELS,
  };
}

/** A packed grid with a float "intensity" field: a hollow sphere; 0 marks empty cells. */
function makePackedGrid(): VoxelGrid {
  const cellStride = 4;
  const rowStride = SIZE * cellStride;
  const sliceStride = SIZE * rowStride;
  const data = new Uint8Array(SIZE * sliceStride);
  const view = new DataView(data.buffer);
  const c = (SIZE - 1) / 2;
  for (let z = 0; z < SIZE; z++) {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const r = Math.hypot(x - c, y - c, z - c);
        if (r > SIZE * 0.4 && r < SIZE * 0.47 && x < c + SIZE * 0.2) {
          view.setFloat32(z * sliceStride + y * rowStride + x * cellStride, z / SIZE, true);
        }
      }
    }
  }
  return {
    timestamp: { sec: 0, nsec: 0 },
    frame_id: "map",
    pose: { position: { x: 0.2, y: -SIZE * 0.05, z: 0 }, orientation: QUAT_IDENTITY },
    row_count: SIZE,
    column_count: SIZE,
    cell_size: { x: 0.1, y: 0.1, z: 0.1 },
    slice_stride: sliceStride,
    row_stride: rowStride,
    cell_stride: cellStride,
    fields: [{ name: "intensity", offset: 0, type: NumericType.FLOAT32 }],
    data,
  };
}

function VoxelGridStory({
  bitConfig,
  packedConfig,
}: {
  bitConfig: Partial<LayerSettingsVoxelGrid>;
  packedConfig: Partial<LayerSettingsVoxelGrid>;
}): React.JSX.Element {
  const topics: Topic[] = [
    { name: "/voxels", schemaName: "nav2_msgs/msg/VoxelGrid" },
    { name: "/voxel_grid", schemaName: "foxglove.VoxelGrid" },
  ];
  const bit: MessageEvent<BitVoxelGrid> = {
    topic: "/voxels",
    schemaName: "nav2_msgs/msg/VoxelGrid",
    receiveTime: { sec: 0, nsec: 0 },
    message: makeBitGrid(),
    sizeInBytes: 0,
  };
  const packed: MessageEvent<VoxelGrid> = {
    topic: "/voxel_grid",
    schemaName: "foxglove.VoxelGrid",
    receiveTime: { sec: 0, nsec: 0 },
    message: makePackedGrid(),
    sizeInBytes: 0,
  };
  const fixture = useDelayedFixture({
    topics,
    frame: { "/voxels": [bit], "/voxel_grid": [packed] },
    capabilities: [],
    activeData: { currentTime: { sec: 0, nsec: 0 } },
  });
  return (
    <PanelSetup fixture={fixture}>
      <ThreeDeePanel
        overrideConfig={{
          followTf: "map",
          topics: {
            "/voxels": { visible: true, ...bitConfig },
            "/voxel_grid": { visible: true, ...packedConfig },
          },
          cameraState: {
            distance: 11,
            perspective: true,
            phi: rad2deg(1),
            targetOffset: [0, 0, 0],
            thetaOffset: rad2deg(0.6),
            fovy: rad2deg(0.75),
            near: 0.01,
            far: 5000,
            target: [0, 0, 0],
            targetOrientation: [0, 0, 0, 1],
          },
        }}
      />
    </PanelSetup>
  );
}

export const VoxelGrid_ByType: StoryObj = {
  render: () => (
    <VoxelGridStory
      bitConfig={{ presentColor: "#8080804d", markedColor: "#ffbf40ff" }}
      packedConfig={{ colorMode: "colormap", colorField: "intensity", colorMap: "turbo" }}
    />
  ),
};

export const VoxelGrid_Height: StoryObj = {
  render: () => (
    <VoxelGridStory
      bitConfig={{ bitColorMode: "rainbow", useLighting: false }}
      packedConfig={{ colorMode: "gradient", colorField: "intensity" }}
    />
  ),
};
