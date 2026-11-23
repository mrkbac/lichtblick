// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import CodeIcon from "@mui/icons-material/Code";
import DataObjectIcon from "@mui/icons-material/DataObject";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";
import MedicalServicesOutlinedIcon from "@mui/icons-material/MedicalServicesOutlined";
import MonitorHeartOutlinedIcon from "@mui/icons-material/MonitorHeartOutlined";
import PieChartOutlineOutlinedIcon from "@mui/icons-material/PieChartOutlineOutlined";
import PowerOutlinedIcon from "@mui/icons-material/PowerOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import SpeedOutlinedIcon from "@mui/icons-material/SpeedOutlined";
import SportsEsportsOutlinedIcon from "@mui/icons-material/SportsEsportsOutlined";
import StickyNote2OutlinedIcon from "@mui/icons-material/StickyNote2Outlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import TabOutlinedIcon from "@mui/icons-material/TabOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import TableRowsOutlinedIcon from "@mui/icons-material/TableRowsOutlined";
import TuneIcon from "@mui/icons-material/Tune";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import ViewTimelineOutlinedIcon from "@mui/icons-material/ViewTimelineOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VolumeUpOutlinedIcon from "@mui/icons-material/VolumeUpOutlined";
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

const visibleTopics = (topics: readonly string[]) =>
  Object.fromEntries(topics.map((topic) => [topic, { visible: true }]));

export const getBuiltin: (t: TFunction<"panels">) => PanelInfo[] = (t) => [
  {
    title: t("3D"),
    type: "3D",
    // The scene only knows which topics it can draw once it has subscribed, so not via a drop
    openIn: {
      kind: "topic",
      multiple: true,
      config: (topics) => ({ topics: visibleTopics(topics) }),
    },
    icon: ViewInArOutlinedIcon,
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
    icon: MonitorHeartOutlinedIcon,
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
    icon: MedicalServicesOutlinedIcon,
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
    openIn: { kind: "topic" },
    icon: ImageOutlinedIcon,
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
    openIn: { kind: "topic", multiple: true },
    icon: GridViewOutlinedIcon,
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
    openIn: { kind: "field" },
    icon: LightbulbOutlinedIcon,
    description: t("indicatorDescription"),
    thumbnail: indicatorThumbnail,
    module: async () => await import("./Indicator"),
    docs: async () => await import("./Indicator/docs"),
    shortcuts: INDICATOR_SHORTCUTS,
  },
  {
    title: t("stack"),
    type: "Stack",
    icon: TableRowsOutlinedIcon,
    keywords: ["layout", "scroll", "list", "grid", "vstack", "hstack", "container"],
    description: t("stackDescription"),
    thumbnail: stackThumbnail,
    module: async () => await import("./Stack"),
    docs: async () => await import("./Stack/docs"),
  },
  {
    title: t("tab"),
    type: "Tab",
    icon: TabOutlinedIcon,
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
    icon: SpeedOutlinedIcon,
    description: t("gaugeDescription"),
    thumbnail: gaugeThumbnail,
    module: async () => await import("./Gauge"),
    docs: async () => await import("./Gauge/docs"),
    shortcuts: GAUGE_SHORTCUTS,
  },
  {
    title: t("teleop"),
    type: "Teleop",
    icon: SportsEsportsOutlinedIcon,
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
    icon: MapOutlinedIcon,
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
    icon: TuneIcon,
    description: t("parametersDescription"),
    thumbnail: parametersThumbnail,
    module: async () => await import("./Parameters"),
    docs: async () => await import("./Parameters/docs"),
    shortcuts: PARAMETERS_SHORTCUTS,
  },
  {
    title: t("plot"),
    type: "Plot",
    openIn: { kind: "field", multiple: true },
    icon: ShowChartIcon,
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
    icon: PieChartOutlineOutlinedIcon,
    description: t("pieChartDescription"),
    thumbnail: pieChartThumbnail,
    module: async () => await import("./PieChart"),
    docs: async () => await import("./PieChart/docs"),
    shortcuts: PIE_CHART_SHORTCUTS,
  },
  {
    title: t("publish"),
    type: "Publish",
    icon: SendOutlinedIcon,
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
    icon: PowerOutlinedIcon,
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
    openIn: { kind: "path" },
    icon: DataObjectIcon,
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
    icon: DataObjectIcon,
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
    openIn: { kind: "topic" },
    icon: VolumeUpOutlinedIcon,
    description: t("audioDescription"),
    thumbnail: audioThumbnail,
    module: async () => await import("./Audio"),
    docs: async () => await import("./Audio/docs"),
    shortcuts: AUDIO_SHORTCUTS,
  },
  {
    title: t("log"),
    type: "RosOut",
    openIn: { kind: "topic", config: ([topic]) => ({ topicToRender: topic }) },
    icon: FormatListBulletedIcon,
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
    openIn: { kind: "field", multiple: true },
    icon: ViewTimelineOutlinedIcon,
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
    openIn: { kind: "path" },
    icon: TableChartOutlinedIcon,
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
    icon: HubOutlinedIcon,
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
    icon: AccountTreeOutlinedIcon,
    keywords: ["tf", "tf_static", "frames", "transforms"],
    description: t("transformTreeDescription"),
    module: async () => await import("./TransformTree"),
    docs: async () => await import("./TransformTree/docs"),
    shortcuts: TRANSFORM_TREE_SHORTCUTS,
  },
  {
    title: t("dataSourceInfo"),
    type: "SourceInfo",
    icon: StorageOutlinedIcon,
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
    icon: StickyNote2OutlinedIcon,
    description: t("notesDescription"),
    thumbnail: notesThumbnail,
    module: async () => await import("./Notes"),
    docs: async () => await import("./Notes/docs"),
    shortcuts: NOTES_SHORTCUTS,
  },
  {
    title: t("topicHealth"),
    type: "TopicHealth",
    icon: MonitorHeartOutlinedIcon,
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
    icon: VisibilityOutlinedIcon,
    description: t("watchDescription"),
    thumbnail: watchThumbnail,
    module: async () => await import("./Watch"),
    docs: async () => await import("./Watch/docs"),
    shortcuts: WATCH_SHORTCUTS,
  },
  {
    title: t("variableSlider"),
    type: "GlobalVariableSliderPanel",
    icon: TuneOutlinedIcon,
    description: t("variableSliderDescription"),
    thumbnail: variableSliderThumbnail,
    module: async () => await import("./VariableSlider"),
    docs: async () => await import("./VariableSlider/docs"),
  },
  {
    title: t("userScripts"),
    type: "NodePlayground",
    icon: CodeIcon,
    keywords: ["code", "script", "typescript"],
    description: t("userScriptsDescription"),
    thumbnail: userScriptEditorThumbnail,
    module: async () => await import("./UserScriptEditor"),
    docs: async () => await import("./UserScriptEditor/docs"),
    shortcuts: USER_SCRIPTS_SHORTCUTS,
  },
  {
    title: t("playbackPerformance"),
    type: "PlaybackPerformance",
    icon: SpeedOutlinedIcon,
    description: t("playbackPerformanceDescription"),
    module: async () => await import("./PlaybackPerformance"),
    docs: async () => await import("./PlaybackPerformance/docs"),
  },
];
