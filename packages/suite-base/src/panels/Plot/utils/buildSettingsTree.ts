// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";
import * as _ from "lodash-es";
import memoizeWeak from "memoize-weak";

import { parseMessagePath } from "@lichtblick/message-path";
import { SettingsTreeFields, SettingsTreeNode, SettingsTreeNodes } from "@lichtblick/suite";
import { DEFAULT_SLIDING_WINDOW_SECONDS } from "@lichtblick/suite-base/panels/Plot/PlotCoordinator";
import { DEFAULT_PLOT_PATH } from "@lichtblick/suite-base/panels/Plot/constants";
import { MakeRootSeriesNode, MakeSeriesNode } from "@lichtblick/suite-base/panels/Plot/types";
import {
  getTimeWindow,
  PlotConfig,
  PlotPath,
  plotPathDisplayName,
} from "@lichtblick/suite-base/panels/Plot/utils/config";
import { PLOTABLE_ROS_TYPES } from "@lichtblick/suite-base/panels/shared/constants";
import { lineColors } from "@lichtblick/suite-base/util/plotColors";

const makeSeriesNode = memoizeWeak(
  ({
    canDelete,
    canReorder,
    index,
    path,
    supportsStreamModifiers,
    t,
    xAxisVal,
  }: MakeSeriesNode): SettingsTreeNode => {
    const actions = [];

    if (canDelete) {
      actions.push({
        type: "action" as const,
        id: "delete-series",
        label: t("deleteSeries"),
        display: "inline" as const,
        icon: "Clear" as const,
      });
    }

    return {
      actions,
      label: plotPathDisplayName(path, index),
      visible: path.enabled,
      reorderable: canReorder,
      icon: canReorder ? ("DragHandle" as const) : undefined,
      fields: {
        value: {
          input: "messagepath",
          label: t("messagePath"),
          supportsMathModifiers: true,
          supportsStreamModifiers,
          validTypes: PLOTABLE_ROS_TYPES,
          value: path.value,
        },
        label: {
          input: "string",
          label: t("label"),
          value: path.label,
        },
        color: {
          input: "rgb",
          label: t("color"),
          value: path.color ?? lineColors[index % lineColors.length],
        },
        lineSize: {
          input: "number",
          label: t("lineSize"),
          value: path.lineSize,
          step: 0.2,
          min: 0,
          placeholder: "auto",
        },
        showLine: {
          input: "boolean",
          label: t("showLine"),
          value: path.showLine ?? true,
        },
        interpolation: {
          input: "select",
          label: t("interpolation"),
          options: [
            { label: t("linear"), value: "linear" },
            { label: t("step"), value: "step" },
          ],
          value: path.interpolation ?? "linear",
        },
        axis: {
          input: "select",
          label: t("yAxis"),
          options: [
            { label: t("primary"), value: "primary" },
            { label: t("secondary"), value: "secondary" },
          ],
          value: path.axis ?? "primary",
        },
        timestampMethod: {
          input: "select",
          label: t("timestamp"),
          options: [
            { label: t("receiveTime"), value: "receiveTime" },
            { label: t("headerStamp"), value: "headerStamp" },
            { label: t("customField"), value: "customField" },
          ],
          value: path.timestampMethod,
        },
        ...(path.timestampMethod === "customField" && {
          timestampPath: {
            input: "messagepath",
            label: t("timestampField"),
            validTypes: TIMESTAMP_FIELD_TYPES,
            value: path.timestampPath ?? "",
            error: timestampPathError(path, t),
          },
        }),
        ...(xAxisVal === "timestamp" && {
          smoothing: {
            input: "number",
            label: t("movingAverage"),
            value: path.smoothing,
            min: 0,
            step: 1,
            precision: 0,
            placeholder: t("off"),
          },
        }),
        ...(xAxisVal === "custom" && {
          xValue: {
            input: "messagepath",
            label: t("xValue"),
            supportsMathModifiers: true,
            validTypes: PLOTABLE_ROS_TYPES,
            value: path.xValue ?? "",
            error: xValueError(path, t),
          },
        }),
      },
    };
  },
);

/** Field types a custom timestamp can be read from */
const TIMESTAMP_FIELD_TYPES = [
  "time",
  "duration",
  "float32",
  "float64",
  "int32",
  "int64",
  "uint32",
  "uint64",
];

/** The custom time field is read from the series' messages, so it must share the topic. */
function timestampPathError(path: PlotPath, t: MakeSeriesNode["t"]): string | undefined {
  const timestampPath = path.timestampPath?.trim();
  if (!timestampPath) {
    return t("timestampFieldMissing");
  }
  const timeTopic = parseMessagePath(timestampPath)?.topicName;
  const yTopic = parseMessagePath(path.value)?.topicName;
  return timeTopic != undefined && yTopic != undefined && timeTopic !== yTopic
    ? t("timestampFieldTopicError")
    : undefined;
}

/** A series' own x path is read from the same messages as its y path, so it must share the topic. */
function xValueError(path: PlotPath, t: MakeSeriesNode["t"]): string | undefined {
  const xValue = path.xValue?.trim();
  if (!xValue) {
    return undefined;
  }
  const xTopic = parseMessagePath(xValue)?.topicName;
  const yTopic = parseMessagePath(path.value)?.topicName;
  return xTopic != undefined && yTopic != undefined && xTopic !== yTopic
    ? t("xValueTopicError")
    : undefined;
}

const makeRootSeriesNode = memoizeWeak(
  ({ paths, supportsStreamModifiers, t, xAxisVal }: MakeRootSeriesNode): SettingsTreeNode => {
    const children = Object.fromEntries(
      paths.length === 0
        ? [
            [
              "0",
              makeSeriesNode({
                canDelete: false,
                canReorder: false,
                path: DEFAULT_PLOT_PATH,
                index: 0,
                supportsStreamModifiers,
                t,
                xAxisVal,
              }),
            ],
          ]
        : paths.map((path, index) => [
            `${index}`,
            makeSeriesNode({
              canDelete: true,
              canReorder: true,
              index,
              path,
              supportsStreamModifiers,
              t,
              xAxisVal,
            }),
          ]),
    );
    return {
      label: t("series"),
      children,
      actions: [
        {
          type: "action",
          id: "add-series",
          display: "inline",
          icon: "Addchart",
          label: t("addSeries"),
        },
      ],
    };
  },
);

export function buildSettingsTree(config: PlotConfig, t: TFunction<"plot">): SettingsTreeNodes {
  const maxYError =
    _.isNumber(config.minYValue) &&
    _.isNumber(config.maxYValue) &&
    config.minYValue >= config.maxYValue
      ? t("maxYError")
      : undefined;

  const maxY2Error =
    config.minY2Value != undefined &&
    config.maxY2Value != undefined &&
    config.minY2Value >= config.maxY2Value
      ? t("maxYError")
      : undefined;

  const maxXError =
    _.isNumber(config.minXValue) &&
    _.isNumber(config.maxXValue) &&
    config.minXValue >= config.maxXValue
      ? t("maxXError")
      : undefined;

  return {
    general: {
      label: t("general"),
      fields: {
        isSynced: { label: t("syncWithOtherPlots"), input: "boolean", value: config.isSynced },
      },
    },
    legend: {
      label: t("legend"),
      fields: {
        legendDisplay: {
          label: t("position"),
          input: "select",
          value: config.legendDisplay,
          options: [
            { value: "floating", label: t("floating") },
            { value: "left", label: t("left") },
            { value: "top", label: t("top") },
            { value: "none", label: t("hidden") },
          ],
        },
        showPlotValuesInLegend: {
          label: t("showValues"),
          input: "boolean",
          value: config.showPlotValuesInLegend,
        },
      },
    },
    yAxis: {
      label: t("yAxis"),
      defaultExpansionState: "collapsed",
      fields: {
        yAxisLabel: {
          label: t("axisLabel"),
          input: "string",
          value: config.yAxisLabel,
        },
        showYAxisLabels: {
          label: t("showLabels"),
          input: "boolean",
          value: config.showYAxisLabels,
        },
        minYValue: {
          label: t("min"),
          input: "number",
          value: config.minYValue != undefined ? Number(config.minYValue) : undefined,
          placeholder: "auto",
        },
        maxYValue: {
          label: t("max"),
          input: "number",
          error: maxYError,
          value: config.maxYValue != undefined ? Number(config.maxYValue) : undefined,
          placeholder: "auto",
        },
        showYAxisGrid: {
          label: t("showGridLines"),
          input: "boolean",
          value: config.showYAxisGrid ?? true,
        },
      },
    },
    y2Axis: {
      label: t("secondaryYAxis"),
      defaultExpansionState: "collapsed",
      fields: {
        y2AxisLabel: {
          label: t("axisLabel"),
          input: "string",
          value: config.y2AxisLabel,
        },
        showY2AxisLabels: {
          label: t("showLabels"),
          input: "boolean",
          value: config.showY2AxisLabels ?? true,
        },
        minY2Value: {
          label: t("min"),
          input: "number",
          value: config.minY2Value,
          placeholder: "auto",
        },
        maxY2Value: {
          label: t("max"),
          input: "number",
          error: maxY2Error,
          value: config.maxY2Value,
          placeholder: "auto",
        },
        showY2AxisGrid: {
          label: t("showGridLines"),
          input: "boolean",
          value: config.showY2AxisGrid ?? false,
        },
      },
    },
    xAxis: {
      label: t("xAxis"),
      defaultExpansionState: "collapsed",
      fields: {
        xAxisLabel: {
          label: t("axisLabel"),
          input: "string",
          value: config.xAxisLabel,
        },
        xAxisVal: {
          label: t("value"),
          input: "select",
          value: config.xAxisVal,
          options: [
            { label: t("timestamp"), value: "timestamp" },
            { label: t("index"), value: "index" },
            { label: t("currentPath"), value: "currentCustom" },
            { label: t("accumulatedPath"), value: "custom" },
          ],
        },
        xAxisPath:
          config.xAxisVal === "currentCustom" || config.xAxisVal === "custom"
            ? {
                label: t("messagePath"),
                input: "messagepath",
                supportsMathModifiers: true,
                value: config.xAxisPath?.value ?? "",
                validTypes: PLOTABLE_ROS_TYPES,
              }
            : undefined,

        showXAxisLabels: {
          label: t("showLabels"),
          input: "boolean",
          value: config.showXAxisLabels,
        },
        showXAxisGrid: {
          label: t("showGridLines"),
          input: "boolean",
          value: config.showXAxisGrid ?? true,
        },
        ...xRangeFields(config, t, maxXError),
      },
    },
    paths: makeRootSeriesNode({
      paths: config.paths,
      supportsStreamModifiers: config.xAxisVal === "timestamp",
      t,
      xAxisVal: config.xAxisVal,
    }),
  };
}

/** X range fields: a time window for timestamp plots, bounds (and 1:1 scaling) for path plots */
function xRangeFields(
  config: PlotConfig,
  t: MakeSeriesNode["t"],
  maxXError: string | undefined,
): SettingsTreeFields {
  const minMax: SettingsTreeFields = {
    minXValue: {
      label: t("min"),
      input: "number",
      value: _.isNumber(config.minXValue) ? config.minXValue : undefined,
      placeholder: "auto",
    },
    maxXValue: {
      label: t("max"),
      input: "number",
      error: maxXError,
      value: _.isNumber(config.maxXValue) ? config.maxXValue : undefined,
      placeholder: "auto",
    },
  };

  if (config.xAxisVal !== "timestamp") {
    const isPathXAxis = config.xAxisVal === "custom" || config.xAxisVal === "currentCustom";
    return {
      ...minMax,
      ...(isPathXAxis && {
        axisScales: {
          label: t("axisScales"),
          input: "select",
          value: config.axisScales ?? "independent",
          options: [
            { label: t("independent"), value: "independent" },
            { label: t("equalScales"), value: "equal" },
          ],
        },
      }),
    };
  }

  const timeWindow = getTimeWindow(config);
  return {
    timestampFormat: {
      label: t("timestampFormat"),
      input: "select",
      value: config.timestampFormat ?? "relative",
      options: [
        { label: t("relative"), value: "relative" },
        { label: t("absolute"), value: "absolute" },
      ],
    },
    timeWindow: {
      label: t("timeWindow"),
      input: "select",
      value: timeWindow,
      options: [
        { label: t("automatic"), value: "automatic" },
        { label: t("sliding"), value: "sliding" },
        { label: t("fixed"), value: "fixed" },
      ],
    },
    ...(timeWindow === "sliding" && {
      followingViewWidth: {
        label: t("windowSize"),
        input: "number",
        min: 0,
        placeholder: String(DEFAULT_SLIDING_WINDOW_SECONDS),
        value: config.followingViewWidth,
      },
      playheadPosition: {
        label: t("playheadPosition"),
        input: "select",
        value: config.playheadPosition ?? "right",
        options: [
          { label: t("rightEdge"), value: "right" },
          { label: t("center"), value: "center" },
        ],
      },
    }),
    ...(timeWindow === "fixed" && minMax),
  };
}
