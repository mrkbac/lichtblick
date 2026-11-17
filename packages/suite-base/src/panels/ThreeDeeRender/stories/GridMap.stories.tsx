// SPDX-License-Identifier: MPL-2.0

import { StoryObj } from "storybook-react-rsbuild";

import { MessageEvent } from "@lichtblick/suite";
import { LayerSettingsGridMap } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/GridMaps";
import { Topic } from "@lichtblick/suite-base/players/types";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";

import { QUAT_IDENTITY, rad2deg } from "./common";
import useDelayedFixture from "./useDelayedFixture";
import ThreeDeePanel from "../index";
import { Float32MultiArray, GridMap } from "../ros";

export default {
  title: "panels/ThreeDeeRender",
  component: ThreeDeePanel,
  parameters: { colorScheme: "light" },
};

const RESOLUTION = 0.05;
const SIZE_X = 120;
const SIZE_Y = 80;
// Stored in a wrapped circular buffer to exercise the start indices
const START_X = 30;
const START_Y = 17;

/** Column-major layer in a circular buffer; `value(x, y)` gets map-frame cell centers. */
function makeLayer(value: (x: number, y: number) => number): Float32MultiArray {
  const data = new Float32Array(SIZE_X * SIZE_Y);
  for (let bj = 0; bj < SIZE_Y; bj++) {
    for (let bi = 0; bi < SIZE_X; bi++) {
      const i = (bi - START_X + SIZE_X) % SIZE_X;
      const j = (bj - START_Y + SIZE_Y) % SIZE_Y;
      // Index (0, 0) is the cell at the max x/y corner
      const x = (SIZE_X / 2 - 0.5 - i) * RESOLUTION;
      const y = (SIZE_Y / 2 - 0.5 - j) * RESOLUTION;
      data[bj * SIZE_X + bi] = value(x, y);
    }
  }
  return {
    layout: {
      dim: [
        { label: "column_index", size: SIZE_Y, stride: SIZE_X * SIZE_Y },
        { label: "row_index", size: SIZE_X, stride: SIZE_X },
      ],
      data_offset: 0,
    },
    data,
  };
}

function elevation(x: number, y: number): number {
  // A hole in the map, e.g. an unobserved area
  if (Math.hypot(x - 1.2, y + 0.8) < 0.4) {
    return NaN;
  }
  return 0.4 * Math.sin(x * 2) * Math.cos(y * 2.5) + 0.25 * Math.exp(-((x + 1) ** 2 + y ** 2));
}

function makeGridMap({ ros2, offsetY }: { ros2: boolean; offsetY: number }): GridMap {
  const header = { seq: 0, stamp: { sec: 0, nsec: 0 }, frame_id: "map" };
  return {
    ...(ros2 ? { header } : {}),
    info: {
      ...(ros2 ? {} : { header }),
      resolution: RESOLUTION,
      length_x: SIZE_X * RESOLUTION,
      length_y: SIZE_Y * RESOLUTION,
      pose: { position: { x: 0, y: offsetY, z: 0 }, orientation: QUAT_IDENTITY },
    },
    layers: ["elevation", "slope"],
    basic_layers: ["elevation"],
    data: [
      makeLayer(elevation),
      makeLayer((x, y) => Math.abs(Math.cos(x * 2) * Math.cos(y * 2.5))),
    ],
    outer_start_index: START_X,
    inner_start_index: START_Y,
  };
}

function GridMapStory(): React.JSX.Element {
  const topics: Topic[] = [
    { name: "/terrain", schemaName: "grid_map_msgs/GridMap" },
    { name: "/terrain_flat", schemaName: "grid_map_msgs/msg/GridMap" },
  ];
  const event = (topic: Topic, message: GridMap): MessageEvent<GridMap> => ({
    topic: topic.name,
    schemaName: topic.schemaName ?? "",
    receiveTime: { sec: 0, nsec: 0 },
    message,
    sizeInBytes: 0,
  });
  const fixture = useDelayedFixture({
    topics,
    frame: {
      "/terrain": [event(topics[0]!, makeGridMap({ ros2: false, offsetY: 2.2 }))],
      "/terrain_flat": [event(topics[1]!, makeGridMap({ ros2: true, offsetY: -2.2 }))],
    },
    capabilities: [],
    activeData: { currentTime: { sec: 0, nsec: 0 } },
  });

  return (
    <div style={{ width: 1000, height: 800 }}>
      <PanelSetup fixture={fixture}>
        <ThreeDeePanel
          overrideConfig={{
            followTf: "map",
            topics: {
              "/terrain": { visible: true } as Partial<LayerSettingsGridMap>,
              "/terrain_flat": {
                visible: true,
                colorLayer: "slope",
                elevationLayer: "",
                colorMode: "gradient",
                interpolation: "nearest",
              } as Partial<LayerSettingsGridMap>,
            },
            cameraState: {
              distance: 11,
              perspective: true,
              phi: rad2deg(0.9),
              targetOffset: [0, 0, 0],
              thetaOffset: rad2deg(-0.4),
              fovy: rad2deg(0.75),
              near: 0.01,
              far: 5000,
              target: [0, 0, 0],
              targetOrientation: [0, 0, 0, 1],
            },
          }}
        />
      </PanelSetup>
    </div>
  );
}

export const GridMapElevationAndFlat: StoryObj = {
  render: () => <GridMapStory />,
};
