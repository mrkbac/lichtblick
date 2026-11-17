// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Braces20Regular,
  BranchFork20Regular,
  Code20Regular,
  Cube20Regular,
  DataLine20Regular,
  DataPie20Regular,
  Database20Regular,
  Eye20Regular,
  Gauge20Regular,
  Grid20Regular,
  HeartPulse20Regular,
  Image20Regular,
  Joystick20Regular,
  Lightbulb20Regular,
  Map20Regular,
  Note20Regular,
  Options20Regular,
  Organization20Regular,
  PlugConnected20Regular,
  Pulse20Regular,
  RowTriple20Regular,
  Send20Regular,
  Speaker220Regular,
  Stethoscope20Regular,
  TabDesktop20Regular,
  Table20Regular,
  TextBulletListLtr20Regular,
  Timeline20Regular,
  ToggleMultiple20Regular,
  TopSpeed20Regular,
} from "@fluentui/react-icons";
import { TFunction } from "i18next";

import { PanelInfo } from "@lichtblick/suite-base/context/PanelCatalogContext";

import { AUDIO_SHORTCUTS } from "./Audio/shortcuts";
import audioThumbnail from "./Audio/thumbnail.png";
import { CALL_SERVICE_SHORTCUTS } from "./CallService/shortcuts";
import { CAMERA_GRID_SHORTCUTS } from "./CameraGrid/shortcuts";
import cameraGridThumbnail from "./CameraGrid/thumbnail.png";
import { SOURCE_INFO_SHORTCUTS } from "./DataSourceInfo/shortcuts";
import dataSourceInfoThumbnail from "./DataSourceInfo/thumbnail.png";
import diagnosticStatusThumbnail from "./DiagnosticStatus/assets/diagnostic-status.png";
import { DIAGNOSTIC_STATUS_SHORTCUTS } from "./DiagnosticStatus/shortcuts";
import diagnosticSummaryThumbnail from "./DiagnosticSummary/assets/diagnostic-summary.png";
import { DIAGNOSTIC_SUMMARY_SHORTCUTS } from "./DiagnosticSummary/shortcuts";
import { GAUGE_SHORTCUTS } from "./Gauge/shortcuts";
import gaugeThumbnail from "./Gauge/thumbnail.png";
import imageThumbnail from "./Image/thumbnail.png";
import { INDICATOR_SHORTCUTS } from "./Indicator/shortcuts";
import indicatorThumbnail from "./Indicator/thumbnail.png";
import { LOG_SHORTCUTS } from "./Log/shortcuts";
import logThumbnail from "./Log/thumbnail.png";
import { MAP_SHORTCUTS } from "./Map/shortcuts";
import mapThumbnail from "./Map/thumbnail.png";
import { NOTES_SHORTCUTS } from "./Notes/shortcuts";
import notesThumbnail from "./Notes/thumbnail.png";
import { PARAMETERS_SHORTCUTS } from "./Parameters/shortcuts";
import parametersThumbnail from "./Parameters/thumbnail.png";
import { PIE_CHART_SHORTCUTS } from "./PieChart/shortcuts";
import pieChartThumbnail from "./PieChart/thumbnail.png";
import { PLOT_SHORTCUTS } from "./Plot/shortcuts";
import plotThumbnail from "./Plot/thumbnail.png";
import { PUBLISH_SHORTCUTS } from "./Publish/shortcuts";
import publishThumbnail from "./Publish/thumbnail.png";
import rawMessagesThumbnail from "./RawMessages/thumbnail.png";
import { RAW_MESSAGES_SHORTCUTS } from "./RawMessagesVirtual/shortcuts";
import stackThumbnail from "./Stack/thumbnail.png";
import { STATE_TRANSITIONS_SHORTCUTS } from "./StateTransitions/shortcuts";
import stateTransitionsThumbnail from "./StateTransitions/thumbnail.png";
import { TAB_SHORTCUTS } from "./Tab/shortcuts";
import tabThumbnail from "./Tab/thumbnail.png";
import { TABLE_SHORTCUTS } from "./Table/shortcuts";
import tableThumbnail from "./Table/thumbnail.png";
import { TELEOP_SHORTCUTS } from "./Teleop/shortcuts";
import teleopThumbnail from "./Teleop/thumbnail.png";
import { IMAGE_SHORTCUTS, THREE_DEE_SHORTCUTS } from "./ThreeDeeRender/shortcuts";
import threeDeeRenderThumbnail from "./ThreeDeeRender/thumbnail.png";
import { TOPIC_GRAPH_SHORTCUTS } from "./TopicGraph/shortcuts";
import topicGraphThumbnail from "./TopicGraph/thumbnail.png";
import { TOPIC_HEALTH_SHORTCUTS } from "./TopicHealth/shortcuts";
import topicHealthThumbnail from "./TopicHealth/thumbnail.png";
import { TRANSFORM_TREE_SHORTCUTS } from "./TransformTree/shortcuts";
import { USER_SCRIPTS_SHORTCUTS } from "./UserScriptEditor/shortcuts";
import userScriptEditorThumbnail from "./UserScriptEditor/thumbnail.png";
import variableSliderThumbnail from "./VariableSlider/thumbnail.png";
import { WATCH_SHORTCUTS } from "./Watch/shortcuts";
import watchThumbnail from "./Watch/thumbnail.png";

export const getBuiltin: (t: TFunction<"panels">) => PanelInfo[] = (t) => [
  {
    title: t("3D"),
    type: "3D",
    icon: Cube20Regular,
    keywords: ["scene", "pointcloud", "lidar", "markers", "rviz"],
    description: t("3DPanelDescription"),
    thumbnail: threeDeeRenderThumbnail,
    module: async () => await import("./ThreeDeeRender"),
    docs: async () => await import("./ThreeDeeRender/docs"),
    shortcuts: THREE_DEE_SHORTCUTS,
  },
  {
    title: t("ROSDiagnosticsDetail"),
    type: "DiagnosticStatusPanel",
    icon: HeartPulse20Regular,
    description: t("ROSDiagnosticsDetailDescription"),
    thumbnail: diagnosticStatusThumbnail,
    module: async () => await import("./DiagnosticStatus"),
    docs: async () => await import("./DiagnosticStatus/docs"),
    shortcuts: DIAGNOSTIC_STATUS_SHORTCUTS,
    hasCustomToolbar: true,
  },
  {
    title: t("ROSDiagnosticSummary"),
    type: "DiagnosticSummary",
    icon: Stethoscope20Regular,
    description: t("ROSDiagnosticSummaryDescription"),
    thumbnail: diagnosticSummaryThumbnail,
    module: async () => await import("./DiagnosticSummary"),
    docs: async () => await import("./DiagnosticSummary/docs"),
    shortcuts: DIAGNOSTIC_SUMMARY_SHORTCUTS,
    hasCustomToolbar: true,
  },
  {
    title: t("image"),
    type: "Image",
    icon: Image20Regular,
    keywords: ["camera", "video", "picture"],
    description: t("imageDescription"),
    thumbnail: imageThumbnail,
    module: async () => await import("./Image"),
    docs: async () => await import("./Image/docs"),
    shortcuts: IMAGE_SHORTCUTS,
  },
  {
    title: t("cameraGrid"),
    type: "CameraGrid",
    icon: Grid20Regular,
    keywords: ["cameras", "images", "multi camera"],
    description: t("cameraGridDescription"),
    thumbnail: cameraGridThumbnail,
    module: async () => await import("./CameraGrid"),
    docs: async () => await import("./CameraGrid/docs"),
    shortcuts: CAMERA_GRID_SHORTCUTS,
  },
  {
    title: t("indicator"),
    type: "Indicator",
    icon: Lightbulb20Regular,
    description: t("indicatorDescription"),
    thumbnail: indicatorThumbnail,
    module: async () => await import("./Indicator"),
    docs: async () => await import("./Indicator/docs"),
    shortcuts: INDICATOR_SHORTCUTS,
  },
  {
    title: t("stack"),
    type: "Stack",
    icon: RowTriple20Regular,
    keywords: ["layout", "scroll", "list", "grid", "vstack", "hstack", "container"],
    description: t("stackDescription"),
    thumbnail: stackThumbnail,
    module: async () => await import("./Stack"),
    docs: async () => await import("./Stack/docs"),
  },
  {
    title: t("tab"),
    type: "Tab",
    icon: TabDesktop20Regular,
    description: t("tabDescription"),
    thumbnail: tabThumbnail,
    module: async () => await import("./Tab"),
    docs: async () => await import("./Tab/docs"),
    shortcuts: TAB_SHORTCUTS,
    hasCustomToolbar: true,
    // Created by stacking panels onto each other, not from the panel list.
    hidden: true,
  },
  {
    title: t("gauge"),
    type: "Gauge",
    icon: Gauge20Regular,
    description: t("gaugeDescription"),
    thumbnail: gaugeThumbnail,
    module: async () => await import("./Gauge"),
    docs: async () => await import("./Gauge/docs"),
    shortcuts: GAUGE_SHORTCUTS,
  },
  {
    title: t("teleop"),
    type: "Teleop",
    icon: Joystick20Regular,
    keywords: ["joystick", "cmd_vel", "drive"],
    description: t("teleopDescription"),
    thumbnail: teleopThumbnail,
    module: async () => await import("./Teleop"),
    docs: async () => await import("./Teleop/docs"),
    shortcuts: TELEOP_SHORTCUTS,
  },
  {
    title: t("map"),
    type: "map",
    icon: Map20Regular,
    keywords: ["gps", "navsat", "geo"],
    description: t("mapDescription"),
    thumbnail: mapThumbnail,
    module: async () => await import("./Map"),
    docs: async () => await import("./Map/docs"),
    shortcuts: MAP_SHORTCUTS,
  },
  {
    title: t("parameters"),
    type: "Parameters",
    icon: Options20Regular,
    description: t("parametersDescription"),
    thumbnail: parametersThumbnail,
    module: async () => await import("./Parameters"),
    docs: async () => await import("./Parameters/docs"),
    shortcuts: PARAMETERS_SHORTCUTS,
  },
  {
    title: t("plot"),
    type: "Plot",
    icon: DataLine20Regular,
    keywords: ["chart", "graph", "timeseries", "line"],
    description: t("plotDescription"),
    thumbnail: plotThumbnail,
    module: async () => await import("./Plot"),
    docs: async () => await import("./Plot/docs"),
    shortcuts: PLOT_SHORTCUTS,
  },
  {
    title: t("pieChart"),
    type: "PieChart",
    icon: DataPie20Regular,
    description: t("pieChartDescription"),
    thumbnail: pieChartThumbnail,
    module: async () => await import("./PieChart"),
    docs: async () => await import("./PieChart/docs"),
    shortcuts: PIE_CHART_SHORTCUTS,
  },
  {
    title: t("publish"),
    type: "Publish",
    icon: Send20Regular,
    keywords: ["send", "rostopic pub"],
    description: t("publishDescription"),
    thumbnail: publishThumbnail,
    module: async () => await import("./Publish"),
    docs: async () => await import("./Publish/docs"),
    shortcuts: PUBLISH_SHORTCUTS,
  },
  {
    title: t("callService"),
    type: "CallService",
    icon: PlugConnected20Regular,
    keywords: ["rosservice", "srv"],
    description: t("callServiceDescription"),
    thumbnail: publishThumbnail,
    module: async () => await import("./CallService"),
    docs: async () => await import("./CallService/docs"),
    shortcuts: CALL_SERVICE_SHORTCUTS,
  },
  {
    title: t("rawMessages"),
    type: "RawMessages",
    icon: Braces20Regular,
    keywords: ["json", "inspect", "echo"],
    description: t("rawMessagesDescription"),
    thumbnail: rawMessagesThumbnail,
    module: async () => await import("./RawMessages"),
    docs: async () => await import("./RawMessages/docs"),
    shortcuts: RAW_MESSAGES_SHORTCUTS,
    hasCustomToolbar: true,
  },
  {
    // Alias of Raw Messages for layouts saved with this type; not offered in the panel list.
    title: t("rawMessages"),
    type: "RawMessagesVirtual",
    icon: Braces20Regular,
    description: t("rawMessagesDescription"),
    thumbnail: rawMessagesThumbnail,
    module: async () => await import("./RawMessagesVirtual"),
    docs: async () => await import("./RawMessages/docs"),
    shortcuts: RAW_MESSAGES_SHORTCUTS,
    hasCustomToolbar: true,
    hidden: true,
  },
  {
    title: t("audio"),
    type: "Audio",
    icon: Speaker220Regular,
    description: t("audioDescription"),
    thumbnail: audioThumbnail,
    module: async () => await import("./Audio"),
    docs: async () => await import("./Audio/docs"),
    shortcuts: AUDIO_SHORTCUTS,
  },
  {
    title: t("log"),
    type: "RosOut",
    icon: TextBulletListLtr20Regular,
    keywords: ["rosout", "console", "logs"],
    description: t("logDescription"),
    thumbnail: logThumbnail,
    module: async () => await import("./Log"),
    docs: async () => await import("./Log/docs"),
    shortcuts: LOG_SHORTCUTS,
  },
  {
    title: t("stateTransitions"),
    type: "StateTransitions",
    icon: Timeline20Regular,
    keywords: ["enum", "states", "timeline"],
    description: t("stateTransitionsDescription"),
    thumbnail: stateTransitionsThumbnail,
    module: async () => await import("./StateTransitions"),
    docs: async () => await import("./StateTransitions/docs"),
    shortcuts: STATE_TRANSITIONS_SHORTCUTS,
  },
  {
    title: t("table"),
    type: "Table",
    icon: Table20Regular,
    description: t("tableDescription"),
    thumbnail: tableThumbnail,
    module: async () => await import("./Table"),
    docs: async () => await import("./Table/docs"),
    shortcuts: TABLE_SHORTCUTS,
    hasCustomToolbar: true,
  },
  {
    title: t("topicGraph"),
    type: "TopicGraph",
    icon: Organization20Regular,
    keywords: ["rqt_graph", "nodes", "computation graph"],
    description: t("topicGraphDescription"),
    thumbnail: topicGraphThumbnail,
    module: async () => await import("./TopicGraph"),
    docs: async () => await import("./TopicGraph/docs"),
    shortcuts: TOPIC_GRAPH_SHORTCUTS,
  },
  {
    title: t("transformTree"),
    type: "TransformTree",
    icon: BranchFork20Regular,
    keywords: ["tf", "tf_static", "frames", "transforms"],
    description: t("transformTreeDescription"),
    module: async () => await import("./TransformTree"),
    docs: async () => await import("./TransformTree/docs"),
    shortcuts: TRANSFORM_TREE_SHORTCUTS,
  },
  {
    title: t("dataSourceInfo"),
    type: "SourceInfo",
    icon: Database20Regular,
    keywords: ["topics", "metadata", "info"],
    description: t("dataSourceInfoDescription"),
    thumbnail: dataSourceInfoThumbnail,
    module: async () => await import("./DataSourceInfo"),
    docs: async () => await import("./DataSourceInfo/docs"),
    shortcuts: SOURCE_INFO_SHORTCUTS,
  },
  {
    title: t("notes"),
    type: "Notes",
    icon: Note20Regular,
    description: t("notesDescription"),
    thumbnail: notesThumbnail,
    module: async () => await import("./Notes"),
    docs: async () => await import("./Notes/docs"),
    shortcuts: NOTES_SHORTCUTS,
  },
  {
    title: t("topicHealth"),
    type: "TopicHealth",
    icon: Pulse20Regular,
    keywords: ["hz", "frequency", "rate", "stats"],
    description: t("topicHealthDescription"),
    thumbnail: topicHealthThumbnail,
    module: async () => await import("./TopicHealth"),
    docs: async () => await import("./TopicHealth/docs"),
    shortcuts: TOPIC_HEALTH_SHORTCUTS,
  },
  {
    title: t("watch"),
    type: "Watch",
    icon: Eye20Regular,
    description: t("watchDescription"),
    thumbnail: watchThumbnail,
    module: async () => await import("./Watch"),
    docs: async () => await import("./Watch/docs"),
    shortcuts: WATCH_SHORTCUTS,
  },
  {
    title: t("variableSlider"),
    type: "GlobalVariableSliderPanel",
    icon: ToggleMultiple20Regular,
    description: t("variableSliderDescription"),
    thumbnail: variableSliderThumbnail,
    module: async () => await import("./VariableSlider"),
    docs: async () => await import("./VariableSlider/docs"),
  },
  {
    title: t("userScripts"),
    type: "NodePlayground",
    icon: Code20Regular,
    keywords: ["code", "script", "typescript"],
    description: t("userScriptsDescription"),
    thumbnail: userScriptEditorThumbnail,
    module: async () => await import("./UserScriptEditor"),
    docs: async () => await import("./UserScriptEditor/docs"),
    shortcuts: USER_SCRIPTS_SHORTCUTS,
  },
  {
    title: t("studioPlaybackPerformance"),
    type: "PlaybackPerformance",
    icon: TopSpeed20Regular,
    description: t("studioPlaybackPerformanceDescription"),
    module: async () => await import("./PlaybackPerformance"),
    docs: async () => await import("./PlaybackPerformance/docs"),
  },
];
