// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TFunction } from "i18next";

import { PanelInfo } from "@lichtblick/suite-base/context/PanelCatalogContext";

import audioThumbnail from "./Audio/thumbnail.png";
import { CALL_SERVICE_SHORTCUTS } from "./CallService/shortcuts";
import { CAMERA_GRID_SHORTCUTS } from "./CameraGrid/shortcuts";
import cameraGridThumbnail from "./CameraGrid/thumbnail.png";
import dataSourceInfoThumbnail from "./DataSourceInfo/thumbnail.png";
import diagnosticStatusThumbnail from "./DiagnosticStatus/assets/diagnostic-status.png";
import diagnosticSummaryThumbnail from "./DiagnosticSummary/assets/diagnostic-summary.png";
import gaugeThumbnail from "./Gauge/thumbnail.png";
import imageThumbnail from "./Image/thumbnail.png";
import indicatorThumbnail from "./Indicator/thumbnail.png";
import logThumbnail from "./Log/thumbnail.png";
import { MAP_SHORTCUTS } from "./Map/shortcuts";
import mapThumbnail from "./Map/thumbnail.png";
import { NOTES_SHORTCUTS } from "./Notes/shortcuts";
import notesThumbnail from "./Notes/thumbnail.png";
import parametersThumbnail from "./Parameters/thumbnail.png";
import pieChartThumbnail from "./PieChart/thumbnail.png";
import { PLOT_SHORTCUTS } from "./Plot/shortcuts";
import plotThumbnail from "./Plot/thumbnail.png";
import { PUBLISH_SHORTCUTS } from "./Publish/shortcuts";
import publishThumbnail from "./Publish/thumbnail.png";
import rawMessagesThumbnail from "./RawMessages/thumbnail.png";
import { RAW_MESSAGES_SHORTCUTS } from "./RawMessagesVirtual/shortcuts";
import { STATE_TRANSITIONS_SHORTCUTS } from "./StateTransitions/shortcuts";
import stateTransitionsThumbnail from "./StateTransitions/thumbnail.png";
import tabThumbnail from "./Tab/thumbnail.png";
import tableThumbnail from "./Table/thumbnail.png";
import { TELEOP_SHORTCUTS } from "./Teleop/shortcuts";
import teleopThumbnail from "./Teleop/thumbnail.png";
import { THREE_DEE_SHORTCUTS } from "./ThreeDeeRender/shortcuts";
import threeDeeRenderThumbnail from "./ThreeDeeRender/thumbnail.png";
import topicGraphThumbnail from "./TopicGraph/thumbnail.png";
import topicHealthThumbnail from "./TopicHealth/thumbnail.png";
import userScriptEditorThumbnail from "./UserScriptEditor/thumbnail.png";
import variableSliderThumbnail from "./VariableSlider/thumbnail.png";
import watchThumbnail from "./Watch/thumbnail.png";

export const getBuiltin: (t: TFunction<"panels">) => PanelInfo[] = (t) => [
  {
    title: t("3D"),
    type: "3D",
    description: t("3DPanelDescription"),
    thumbnail: threeDeeRenderThumbnail,
    module: async () => await import("./ThreeDeeRender"),
    shortcuts: THREE_DEE_SHORTCUTS,
  },
  {
    title: t("ROSDiagnosticsDetail"),
    type: "DiagnosticStatusPanel",
    description: t("ROSDiagnosticsDetailDescription"),
    thumbnail: diagnosticStatusThumbnail,
    module: async () => await import("./DiagnosticStatus"),
    hasCustomToolbar: true,
  },
  {
    title: t("ROSDiagnosticSummary"),
    type: "DiagnosticSummary",
    description: t("ROSDiagnosticSummaryDescription"),
    thumbnail: diagnosticSummaryThumbnail,
    module: async () => await import("./DiagnosticSummary"),
    hasCustomToolbar: true,
  },
  {
    title: t("image"),
    type: "Image",
    description: t("imageDescription"),
    thumbnail: imageThumbnail,
    module: async () => await import("./Image"),
  },
  {
    title: t("cameraGrid"),
    type: "CameraGrid",
    description: t("cameraGridDescription"),
    thumbnail: cameraGridThumbnail,
    module: async () => await import("./CameraGrid"),
    shortcuts: CAMERA_GRID_SHORTCUTS,
  },
  {
    title: t("indicator"),
    type: "Indicator",
    description: t("indicatorDescription"),
    thumbnail: indicatorThumbnail,
    module: async () => await import("./Indicator"),
  },
  {
    title: t("tab"),
    type: "Tab",
    description: t("tabDescription"),
    thumbnail: tabThumbnail,
    module: async () => await import("./Tab"),
    hasCustomToolbar: true,
    // Created by stacking panels onto each other, not from the panel list.
    hidden: true,
  },
  {
    title: t("gauge"),
    type: "Gauge",
    description: t("gaugeDescription"),
    thumbnail: gaugeThumbnail,
    module: async () => await import("./Gauge"),
  },
  {
    title: t("teleop"),
    type: "Teleop",
    description: t("teleopDescription"),
    thumbnail: teleopThumbnail,
    module: async () => await import("./Teleop"),
    shortcuts: TELEOP_SHORTCUTS,
  },
  {
    title: t("map"),
    type: "map",
    description: t("mapDescription"),
    thumbnail: mapThumbnail,
    module: async () => await import("./Map"),
    shortcuts: MAP_SHORTCUTS,
  },
  {
    title: t("parameters"),
    type: "Parameters",
    description: t("parametersDescription"),
    thumbnail: parametersThumbnail,
    module: async () => await import("./Parameters"),
  },
  {
    title: t("plot"),
    type: "Plot",
    description: t("plotDescription"),
    thumbnail: plotThumbnail,
    module: async () => await import("./Plot"),
    shortcuts: PLOT_SHORTCUTS,
  },
  {
    title: t("pieChart"),
    type: "PieChart",
    description: t("pieChartDescription"),
    thumbnail: pieChartThumbnail,
    module: async () => await import("./PieChart"),
  },
  {
    title: t("publish"),
    type: "Publish",
    description: t("publishDescription"),
    thumbnail: publishThumbnail,
    module: async () => await import("./Publish"),
    shortcuts: PUBLISH_SHORTCUTS,
  },
  {
    title: t("callService"),
    type: "CallService",
    description: t("callServiceDescription"),
    thumbnail: publishThumbnail,
    module: async () => await import("./CallService"),
    shortcuts: CALL_SERVICE_SHORTCUTS,
  },
  {
    title: t("rawMessages"),
    type: "RawMessages",
    description: t("rawMessagesDescription"),
    thumbnail: rawMessagesThumbnail,
    module: async () => await import("./RawMessages"),
    shortcuts: RAW_MESSAGES_SHORTCUTS,
    hasCustomToolbar: true,
  },
  {
    // Alias of Raw Messages for layouts saved with this type; not offered in the panel list.
    title: t("rawMessages"),
    type: "RawMessagesVirtual",
    description: t("rawMessagesDescription"),
    thumbnail: rawMessagesThumbnail,
    module: async () => await import("./RawMessagesVirtual"),
    shortcuts: RAW_MESSAGES_SHORTCUTS,
    hasCustomToolbar: true,
    hidden: true,
  },
  {
    title: t("audio"),
    type: "Audio",
    description: t("audioDescription"),
    thumbnail: audioThumbnail,
    module: async () => await import("./Audio"),
  },
  {
    title: t("log"),
    type: "RosOut",
    description: t("logDescription"),
    thumbnail: logThumbnail,
    module: async () => await import("./Log"),
  },
  {
    title: t("stateTransitions"),
    type: "StateTransitions",
    description: t("stateTransitionsDescription"),
    thumbnail: stateTransitionsThumbnail,
    module: async () => await import("./StateTransitions"),
    shortcuts: STATE_TRANSITIONS_SHORTCUTS,
  },
  {
    title: t("table"),
    type: "Table",
    description: t("tableDescription"),
    thumbnail: tableThumbnail,
    module: async () => await import("./Table"),
    hasCustomToolbar: true,
  },
  {
    title: t("topicGraph"),
    type: "TopicGraph",
    description: t("topicGraphDescription"),
    thumbnail: topicGraphThumbnail,
    module: async () => await import("./TopicGraph"),
  },
  {
    title: t("transformTree"),
    type: "TransformTree",
    description: t("transformTreeDescription"),
    module: async () => await import("./TransformTree"),
  },
  {
    title: t("dataSourceInfo"),
    type: "SourceInfo",
    description: t("dataSourceInfoDescription"),
    thumbnail: dataSourceInfoThumbnail,
    module: async () => await import("./DataSourceInfo"),
  },
  {
    title: t("notes"),
    type: "Notes",
    description: t("notesDescription"),
    thumbnail: notesThumbnail,
    module: async () => await import("./Notes"),
    shortcuts: NOTES_SHORTCUTS,
  },
  {
    title: t("topicHealth"),
    type: "TopicHealth",
    description: t("topicHealthDescription"),
    thumbnail: topicHealthThumbnail,
    module: async () => await import("./TopicHealth"),
  },
  {
    title: t("watch"),
    type: "Watch",
    description: t("watchDescription"),
    thumbnail: watchThumbnail,
    module: async () => await import("./Watch"),
  },
  {
    title: t("variableSlider"),
    type: "GlobalVariableSliderPanel",
    description: t("variableSliderDescription"),
    thumbnail: variableSliderThumbnail,
    module: async () => await import("./VariableSlider"),
  },
  {
    title: t("userScripts"),
    type: "NodePlayground",
    description: t("userScriptsDescription"),
    thumbnail: userScriptEditorThumbnail,
    module: async () => await import("./UserScriptEditor"),
  },
  {
    title: t("studioPlaybackPerformance"),
    type: "PlaybackPerformance",
    description: t("studioPlaybackPerformanceDescription"),
    module: async () => await import("./PlaybackPerformance"),
  },
];
