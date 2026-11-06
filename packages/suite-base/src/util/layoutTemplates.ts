// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  MessagePathStructureItem,
  quoteFieldNameIfNeeded,
  quoteTopicNameIfNeeded,
} from "@lichtblick/message-path";
import { Immutable } from "@lichtblick/suite";
import { messagePathStructures } from "@lichtblick/suite-base/components/MessagePathSyntax/messagePathsForDatatype";
import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { imageKind } from "@lichtblick/suite-base/panels/CameraGrid/layout";
import { makeTile } from "@lichtblick/suite-base/panels/CameraGrid/types";
import { ALLOWED_DATATYPES as DIAGNOSTIC_DATATYPES } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import { SUPPORTED_DATATYPES as LOG_DATATYPES } from "@lichtblick/suite-base/panels/Log/conversion";
import { isSupportedSchema as isMapSchema } from "@lichtblick/suite-base/panels/Map/support";
import * as foxglove from "@lichtblick/suite-base/panels/ThreeDeeRender/foxglove";
import * as ros from "@lichtblick/suite-base/panels/ThreeDeeRender/ros";
import { newRow } from "@lichtblick/suite-base/panels/Watch/config";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { LayoutNode } from "@lichtblick/suite-base/types/layouts";
import { getPanelIdForType } from "@lichtblick/suite-base/util/layout";

/** The part of a data source topic that templates look at. */
export type TemplateTopic = { name: string; schemaName?: string };

export type LayoutTemplateId = "camera" | "navigation" | "diagnostics" | "signals";

export type LayoutTemplateResult = {
  data: LayoutData;
  /** Topics the layout reads, sorted; empty when nothing in the data source matched. */
  topics: string[];
};

export type LayoutTemplate = {
  /** Also the i18n key of the title in the `layoutTemplates` namespace. */
  id: LayoutTemplateId;
  build: (
    topics: readonly TemplateTopic[],
    datatypes: Immutable<RosDatatypes>,
  ) => LayoutTemplateResult;
};

type Panel = { type: string; config: Record<string, unknown> };

const union = (...sets: ReadonlySet<string>[]) => new Set(sets.flatMap((set) => [...set]));

const SCENE_DATATYPES = union(
  ros.POINTCLOUD_DATATYPES,
  ros.LASERSCAN_DATATYPES,
  ros.VELODYNE_SCAN_DATATYPES,
  ros.OCCUPANCY_GRID_DATATYPES,
  ros.MARKER_DATATYPES,
  ros.MARKER_ARRAY_DATATYPES,
  ros.NAV_PATH_DATATYPES,
  ros.POSE_STAMPED_DATATYPES,
  ros.POSE_WITH_COVARIANCE_STAMPED_DATATYPES,
  ros.POSE_ARRAY_DATATYPES,
  ros.POLYGON_STAMPED_DATATYPES,
  foxglove.POINTCLOUD_DATATYPES,
  foxglove.LASERSCAN_DATATYPES,
  foxglove.GRID_DATATYPES,
  foxglove.SCENE_UPDATE_DATATYPES,
  foxglove.POSE_IN_FRAME_DATATYPES,
  foxglove.POSES_IN_FRAME_DATATYPES,
);
const TF_DATATYPES = union(
  ros.TF_DATATYPES,
  ros.TRANSFORM_STAMPED_DATATYPES,
  foxglove.FRAME_TRANSFORM_DATATYPES,
  foxglove.FRAME_TRANSFORMS_DATATYPES,
);
/** Schemas a dedicated panel shows better than a plot; the signals template leaves them out. */
const NON_SIGNAL_DATATYPES = union(
  SCENE_DATATYPES,
  TF_DATATYPES,
  ros.IMAGE_DATATYPES,
  ros.COMPRESSED_IMAGE_DATATYPES,
  ros.CAMERA_INFO_DATATYPES,
  ros.IMAGE_MARKER_DATATYPES,
  ros.IMAGE_MARKER_ARRAY_DATATYPES,
  foxglove.RAW_IMAGE_DATATYPES,
  foxglove.COMPRESSED_IMAGE_DATATYPES,
  foxglove.COMPRESSED_VIDEO_DATATYPES,
  foxglove.CAMERA_CALIBRATION_DATATYPES,
  foxglove.IMAGE_ANNOTATIONS_DATATYPES,
  LOG_DATATYPES,
  new Set(DIAGNOSTIC_DATATYPES),
);

const MAX_PLOTS = 4;
const MAX_SERIES_PER_PLOT = 6;
const MAX_STATE_PATHS = 8;
const MAX_WATCH_ROWS = 12;
/** How deep into nested messages the signals template looks for fields. */
const MAX_FIELD_DEPTH = 3;
/** Header stamps and sequence numbers are bookkeeping, not signals. */
const SKIPPED_FIELD_TYPE = /(^|\/)(Header|Time|Duration|time|duration)$/;
/** Numeric fields with these names are enums worth a state timeline rather than a plot. */
const STATE_FIELD_NAME = /(^|_)(state|mode|status)$/i;

function namesWithSchema(
  topics: readonly TemplateTopic[],
  matches: (schemaName: string) => boolean,
): string[] {
  return topics
    .filter((topic) => topic.schemaName != undefined && matches(topic.schemaName))
    .map((topic) => topic.name)
    .sort();
}

/** Lays out panels with each panel in its own group; empty entries are dropped. */
function split(direction: "row" | "column", nodes: (LayoutNode | undefined)[], sizes?: number[]) {
  const present = nodes.flatMap((node, index) => (node ? [{ node, size: sizes?.[index] }] : []));
  if (present.length <= 1) {
    return present[0]?.node;
  }
  const keepSizes = present.every((entry) => entry.size != undefined);
  return {
    direction,
    children: present.map((entry) => entry.node),
    sizes: keepSizes ? present.map((entry) => entry.size!) : undefined,
  } satisfies LayoutNode;
}

function makeLayout(build: (add: (panel: Panel) => LayoutNode) => LayoutNode | undefined) {
  const configById: LayoutData["configById"] = {};
  const layout = build(({ type, config }) => {
    const id = getPanelIdForType(type);
    configById[id] = config;
    return { panels: [id] };
  });
  return {
    configById,
    layout,
    globalVariables: {},
    userNodes: {},
    playbackConfig: { speed: 1 },
  } satisfies LayoutData;
}

const result = (data: LayoutData, ...topicLists: string[][]): LayoutTemplateResult => ({
  data,
  topics: [...new Set(topicLists.flat())].sort(),
});

const camera: LayoutTemplate = {
  id: "camera",
  build: (topics) => {
    const images = namesWithSchema(topics, (schema) => imageKind(schema) != undefined);
    const data = makeLayout((add) =>
      split(
        "row",
        [
          // One camera needs no grid.
          images.length > 1
            ? add({ type: "CameraGrid", config: { tiles: images.map(makeTile) } })
            : undefined,
          add({ type: "Image", config: images[0] ? { imageMode: { imageTopic: images[0] } } : {} }),
        ],
        [60, 40],
      ),
    );
    return result(data, images);
  },
};

const navigation: LayoutTemplate = {
  id: "navigation",
  build: (topics) => {
    const scene = namesWithSchema(topics, (schema) => SCENE_DATATYPES.has(schema));
    const tf = namesWithSchema(topics, (schema) => TF_DATATYPES.has(schema));
    const gps = namesWithSchema(topics, isMapSchema);
    const data = makeLayout((add) =>
      split(
        "row",
        [
          // The 3D panel reads transforms on its own; only scene topics need switching on.
          add({
            type: "3D",
            config: { topics: Object.fromEntries(scene.map((name) => [name, { visible: true }])) },
          }),
          // The map shows every GPS topic unless the user hides it.
          gps.length > 0 ? add({ type: "map", config: {} }) : undefined,
        ],
        [65, 35],
      ),
    );
    return result(data, scene, tf, gps);
  },
};

const diagnostics: LayoutTemplate = {
  id: "diagnostics",
  build: (topics) => {
    const diag = namesWithSchema(topics, (schema) => DIAGNOSTIC_DATATYPES.includes(schema));
    const logs = namesWithSchema(topics, (schema) => LOG_DATATYPES.has(schema));
    // Diagnostics and log panels read every matching topic until the user picks some, so new
    // topics on a live source show up too.
    const data = makeLayout((add) =>
      split("column", [
        diag.length > 0
          ? split("row", [
              add({ type: "DiagnosticSummary", config: {} }),
              add({ type: "DiagnosticStatusPanel", config: {} }),
            ])
          : undefined,
        split("row", [
          logs.length > 0 ? add({ type: "RosOut", config: {} }) : undefined,
          add({ type: "TopicHealth", config: {} }),
        ]),
      ]),
    );
    return result(data, diag, logs);
  },
};

type Signal = { path: string; isState: boolean };

/** Scalar fields of a topic as message paths, skipping arrays, headers and timestamps. */
function topicSignals(topic: string, structure: MessagePathStructureItem): Signal[] {
  const signals: Signal[] = [];
  const visit = (item: MessagePathStructureItem, path: string, name: string, depth: number) => {
    if (item.structureType === "primitive") {
      const isNumber = item.primitiveType !== "string" && item.primitiveType !== "bool";
      signals.push({ path, isState: !isNumber || STATE_FIELD_NAME.test(name) });
    } else if (
      item.structureType === "message" &&
      depth < MAX_FIELD_DEPTH &&
      !SKIPPED_FIELD_TYPE.test(item.datatype)
    ) {
      for (const [field, next] of Object.entries(item.nextByName)) {
        visit(next, `${path}.${quoteFieldNameIfNeeded(field)}`, field, depth + 1);
      }
    }
  };
  visit(structure, quoteTopicNameIfNeeded(topic), "", 0);
  return signals;
}

const signals: LayoutTemplate = {
  id: "signals",
  build: (topics, datatypes) => {
    let structures: ReturnType<typeof messagePathStructures> = {};
    try {
      structures = messagePathStructures(datatypes);
    } catch {
      // A definition refers to a missing nested type: offer the empty signals layout.
    }
    const byTopic = topics
      .filter(
        (topic) => topic.schemaName != undefined && !NON_SIGNAL_DATATYPES.has(topic.schemaName),
      )
      .map((topic) => {
        const structure = structures[topic.schemaName!];
        return { topic: topic.name, signals: structure ? topicSignals(topic.name, structure) : [] };
      })
      .filter((entry) => entry.signals.length > 0)
      .sort((a, b) => (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));

    const plotted = byTopic
      .map((entry) => ({
        topic: entry.topic,
        paths: entry.signals.filter((s) => !s.isState).map((s) => s.path),
      }))
      .filter((entry) => entry.paths.length > 0)
      .slice(0, MAX_PLOTS);
    const states = byTopic
      .flatMap((entry) => entry.signals.filter((s) => s.isState).map((s) => s.path))
      .slice(0, MAX_STATE_PATHS);
    const watched = [...states, ...plotted.flatMap((entry) => entry.paths)].slice(
      0,
      MAX_WATCH_ROWS,
    );
    const used = byTopic
      .filter(
        (entry) =>
          entry.signals.some((s) => states.includes(s.path) || watched.includes(s.path)) ||
          plotted.some((plot) => plot.topic === entry.topic),
      )
      .map((entry) => entry.topic);

    const plotPanel = (paths: string[]): Panel => ({
      type: "Plot",
      config: {
        paths: paths.map((value) => ({ value, enabled: true, timestampMethod: "receiveTime" })),
      },
    });
    const data = makeLayout((add) =>
      split(
        "row",
        [
          // Leave one empty plot when nothing matched, so the layout isn't blank.
          plotted.length > 0
            ? split(
                "column",
                plotted.map((entry) => add(plotPanel(entry.paths.slice(0, MAX_SERIES_PER_PLOT)))),
              )
            : add(plotPanel([])),
          split("column", [
            watched.length > 0
              ? add({ type: "Watch", config: { rows: watched.map((path) => newRow(path)) } })
              : undefined,
            states.length > 0
              ? add({
                  type: "StateTransitions",
                  config: {
                    paths: states.map((value) => ({ value, timestampMethod: "receiveTime" })),
                  },
                })
              : undefined,
          ]),
        ],
        [60, 40],
      ),
    );
    return result(data, used);
  },
};

export const LAYOUT_TEMPLATES: readonly LayoutTemplate[] = [
  camera,
  navigation,
  diagnostics,
  signals,
];
