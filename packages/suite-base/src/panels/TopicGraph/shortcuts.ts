// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by Cytoscape in Graph. */
export const TOPIC_GRAPH_SHORTCUTS = [
  { id: "topicGraph.pan", titleKey: "topicGraphPan", keys: [], mouse: [{ action: "drag" }] },
  { id: "topicGraph.zoom", titleKey: "topicGraphZoom", keys: [], mouse: [{ action: "scroll" }] },
  {
    id: "topicGraph.moveNode",
    titleKey: "topicGraphMoveNode",
    keys: [],
    mouse: [{ action: "drag" }],
  },
] as const satisfies readonly KeyboardShortcut[];
