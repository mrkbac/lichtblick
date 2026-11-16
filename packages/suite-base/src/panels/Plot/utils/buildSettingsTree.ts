// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";
import * as _ from "lodash-es";
import memoizeWeak from "memoize-weak";

import { parseMessagePath } from "@lichtblick/message-path";
import {
  DEFAULT_PLOT_PATH,
  DEFAULT_SLIDING_WINDOW_SECONDS,
} from "@lichtblick/suite-base/panels/Plot/constants";
import type { MakeRootSeriesNode, MakeSeriesNode } from "@lichtblick/suite-base/panels/Plot/types";
import {
  getPlotMode,
  getTimeWindow,
  isReferenceLinePlotPathType,
  PlotConfig,
  PlotPath,
  plotPathDisplayName,
  yBound,
} from "@lichtblick/suite-base/panels/Plot/utils/config";
import { PLOTABLE_ROS_TYPES } from "@lichtblick/suite-base/panels/shared/constants";
import type {
  DocumentedFields,
  DocumentedNode,
  DocumentedNodes,
} from "@lichtblick/suite-base/panels/shared/documentedSettings";
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
    shadeSeriesOptions,
  }: MakeSeriesNode): DocumentedNode => {
    const actions = [];
    const isReferenceLine = isReferenceLinePlotPathType(path);

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
          label: isReferenceLine ? t("value") : t("messagePath"),
          help: isReferenceLine ? t("referenceValueHelp") : t("seriesPathHelp"),
          supportsMathModifiers: true,
          supportsStreamModifiers,
          validTypes: PLOTABLE_ROS_TYPES,
          value: path.value,
        },
        label: {
          input: "string",
          label: t("label"),
          help: t("seriesLabelHelp"),
          value: path.label,
        },
        color: {
          input: "rgb",
          label: t("color"),
          help: t("colorHelp"),
          value: path.color ?? lineColors[index % lineColors.length],
        },
        lineSize: {
          input: "number",
          label: t("lineSize"),
          help: t("lineSizeHelp"),
          value: path.lineSize,
          step: 0.2,
          min: 0,
          placeholder: "auto",
        },
        ...(isReferenceLine
          ? referenceLineFields(path, t, shadeSeriesOptions)
          : seriesFields(path, t, xAxisVal)),
      },
    };
  },
);

/** Settings of a series that are not shared with reference lines */
function seriesFields(
  path: PlotPath,
  t: MakeSeriesNode["t"],
  xAxisVal: MakeSeriesNode["xAxisVal"],
): DocumentedFields {
  return {
    showLine: {
      input: "boolean",
      label: t("showLine"),
      help: t("showLineHelp"),
      value: path.showLine ?? true,
    },
    interpolation: {
      input: "select",
      label: t("interpolation"),
      help: t("interpolationHelp"),
      options: [
        { label: t("linear"), value: "linear" },
        { label: t("step"), value: "step" },
      ],
      value: path.interpolation ?? "linear",
    },
    axis: {
      input: "select",
      label: t("yAxis"),
      help: t("seriesAxisHelp"),
      options: [
        { label: t("primary"), value: "primary" },
        { label: t("secondary"), value: "secondary" },
      ],
      value: path.axis ?? "primary",
    },
    timestampMethod: {
      input: "select",
      label: t("timestamp"),
      help: t("timestampMethodHelp"),
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
        help: t("timestampFieldHelp"),
        validTypes: TIMESTAMP_FIELD_TYPES,
        value: path.timestampPath ?? "",
        error: timestampPathError(path, t),
      },
    }),
    ...(xAxisVal === "timestamp" && {
      smoothing: {
        input: "number",
        label: t("movingAverage"),
        help: t("movingAverageHelp"),
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
        help: t("xValueHelp"),
        supportsMathModifiers: true,
        validTypes: PLOTABLE_ROS_TYPES,
        value: path.xValue ?? "",
        error: xValueError(path, t),
      },
    }),
  };
}

/**
 * A reference line is a series whose message path is a number. Horizontal lines belong to a y axis
 * and can shade where series cross them (thresholds); `shadeSeriesOptions` is unset where shading
 * doesn't apply (FFT and histogram).
 */
function referenceLineFields(
  path: PlotPath,
  t: MakeSeriesNode["t"],
  shadeSeriesOptions: MakeSeriesNode["shadeSeriesOptions"],
): DocumentedFields {
  const horizontal = path.referenceLineAxis !== "x";
  const shade = path.referenceLineShade ?? "none";
  const shadeSeries = path.referenceLineShadeSeries ?? "";
  return {
    referenceLineAxis: {
      input: "select",
      label: t("orientation"),
      help: t("orientationHelp"),
      options: [
        { label: t("horizontal"), value: "y" },
        { label: t("vertical"), value: "x" },
      ],
      value: path.referenceLineAxis ?? "y",
    },
    ...(horizontal && {
      axis: {
        input: "select",
        label: t("yAxis"),
        help: t("seriesAxisHelp"),
        options: [
          { label: t("primary"), value: "primary" },
          { label: t("secondary"), value: "secondary" },
        ],
        value: path.axis ?? "primary",
      },
    }),
    referenceLineDashed: {
      input: "boolean",
      label: t("dashed"),
      help: t("dashedHelp"),
      value: path.referenceLineDashed ?? true,
    },
    ...(horizontal &&
      shadeSeriesOptions && {
        referenceLineShade: {
          input: "select",
          label: t("shade"),
          help: t("shadeHelp"),
          options: [
            { label: t("none"), value: "none" },
            { label: t("shadeAbove"), value: "above" },
            { label: t("shadeBelow"), value: "below" },
          ],
          value: shade,
        },
      }),
    ...(horizontal &&
      shadeSeriesOptions &&
      shade !== "none" && {
        referenceLineShadeSeries: {
          input: "select",
          label: t("shadeSeries"),
          help: t("shadeSeriesHelp"),
          options: [{ label: t("allSeriesOnAxis"), value: "" }, ...shadeSeriesOptions],
          value: shadeSeries,
          error:
            shadeSeries !== "" && !shadeSeriesOptions.some((option) => option.value === shadeSeries)
              ? t("shadeSeriesMissing")
              : undefined,
        },
      }),
  };
}

/** Field types a custom timestamp can be read from */
const TIMESTAMP_FIELD_TYPES = [
  "time",
  "duration",
  "float32",
  "float64",
  "int8",
  "int16",
  "int32",
  "int64",
  "uint8",
  "uint16",
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
  ({
    paths,
    supportsStreamModifiers,
    t,
    xAxisVal,
    canShade,
  }: MakeRootSeriesNode): DocumentedNode => {
    const shadeSeriesOptions = canShade === true ? makeShadeSeriesOptions(paths) : undefined;
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
                shadeSeriesOptions,
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
              shadeSeriesOptions,
            }),
          ]),
    );
    return {
      label: t("series"),
      help: t("seriesHelp"),
      children,
      actions: [
        {
          type: "action",
          id: "add-series",
          display: "inline",
          icon: "Addchart",
          label: t("addSeries"),
        },
        {
          type: "action",
          id: "add-reference-line",
          display: "menu",
          label: t("addReferenceLine"),
        },
      ],
    };
  },
);

/** Series a threshold can shade, by message path (stable when series are reordered or removed) */
function makeShadeSeriesOptions(paths: PlotPath[]): { label: string; value: string }[] {
  const options = new Map<string, string>();
  paths.forEach((path, index) => {
    if (path.value !== "" && !isReferenceLinePlotPathType(path) && !options.has(path.value)) {
      options.set(path.value, plotPathDisplayName(path, index));
    }
  });
  return Array.from(options, ([value, label]) => ({ label, value }));
}

export function buildSettingsTree(config: PlotConfig, t: TFunction<"plot">): DocumentedNodes {
  const minY = yBound(config.minYValue);
  const maxY = yBound(config.maxYValue);
  const maxYError =
    minY != undefined && maxY != undefined && minY >= maxY ? t("maxYError") : undefined;

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
        isSynced: {
          label: t("syncWithOtherPlots"),
          help: t("syncWithOtherPlotsHelp"),
          input: "boolean",
          value: config.isSynced,
        },
        ...plotModeFields(config, t),
      },
    },
    legend: {
      label: t("legend"),
      fields: {
        legendDisplay: {
          label: t("position"),
          help: t("legendPositionHelp"),
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
          help: t("showValuesHelp"),
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
          help: t("axisLabelHelp"),
          input: "string",
          value: config.yAxisLabel,
        },
        showYAxisLabels: {
          label: t("showLabels"),
          help: t("showLabelsHelp"),
          input: "boolean",
          value: config.showYAxisLabels,
        },
        yRangeMode: {
          label: t("yRange"),
          help: t("yRangeHelp"),
          input: "select",
          value: config.yRangeMode ?? "auto",
          options: [
            { value: "auto", label: t("yRangeAuto") },
            { value: "hold", label: t("yRangeHold") },
          ],
        },
        minYValue: {
          label: t("min"),
          help: t("minHelp"),
          input: "number",
          value: minY,
          placeholder: "auto",
        },
        maxYValue: {
          label: t("max"),
          help: t("maxHelp"),
          input: "number",
          error: maxYError,
          value: maxY,
          placeholder: "auto",
        },
        showYAxisGrid: {
          label: t("showGridLines"),
          help: t("showGridLinesHelp"),
          input: "boolean",
          value: config.showYAxisGrid ?? true,
        },
        yAxisLogScale: {
          label: t("logScale"),
          help: t("logScaleHelp"),
          input: "boolean",
          value: config.yAxisLogScale ?? false,
        },
      },
    },
    y2Axis: {
      label: t("secondaryYAxis"),
      defaultExpansionState: "collapsed",
      fields: {
        y2AxisLabel: {
          label: t("axisLabel"),
          help: t("axisLabelHelp"),
          input: "string",
          value: config.y2AxisLabel,
        },
        showY2AxisLabels: {
          label: t("showLabels"),
          help: t("showLabelsHelp"),
          input: "boolean",
          value: config.showY2AxisLabels ?? true,
        },
        minY2Value: {
          label: t("min"),
          help: t("minHelp"),
          input: "number",
          value: config.minY2Value,
          placeholder: "auto",
        },
        maxY2Value: {
          label: t("max"),
          help: t("maxHelp"),
          input: "number",
          error: maxY2Error,
          value: config.maxY2Value,
          placeholder: "auto",
        },
        showY2AxisGrid: {
          label: t("showGridLines"),
          help: t("showGridLinesHelp"),
          input: "boolean",
          value: config.showY2AxisGrid ?? false,
        },
        y2AxisLogScale: {
          label: t("logScale"),
          help: t("logScaleHelp"),
          input: "boolean",
          value: config.y2AxisLogScale ?? false,
        },
      },
    },
    xAxis: {
      label: t("xAxis"),
      defaultExpansionState: "collapsed",
      fields: {
        xAxisLabel: {
          label: t("axisLabel"),
          help: t("axisLabelHelp"),
          input: "string",
          value: config.xAxisLabel,
        },
        xAxisVal: {
          label: t("value"),
          help: t("xAxisValueHelp"),
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
                help: t("xAxisPathHelp"),
                input: "messagepath",
                supportsMathModifiers: true,
                value: config.xAxisPath?.value ?? "",
                validTypes: PLOTABLE_ROS_TYPES,
              }
            : undefined,

        showXAxisLabels: {
          label: t("showLabels"),
          help: t("showLabelsHelp"),
          input: "boolean",
          value: config.showXAxisLabels,
        },
        showXAxisGrid: {
          label: t("showGridLines"),
          help: t("showGridLinesHelp"),
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
      canShade: getPlotMode(config) === "time",
    }),
  };
}

/** Time plots can show each series' frequency spectrum or value histogram instead */
function plotModeFields(config: PlotConfig, t: MakeSeriesNode["t"]): DocumentedFields {
  if (config.xAxisVal !== "timestamp") {
    return {};
  }
  const plotMode = getPlotMode(config);
  return {
    plotMode: {
      label: t("display"),
      help: t("displayHelp"),
      input: "select",
      value: plotMode,
      options: [
        { label: t("timeSeries"), value: "time" },
        { label: t("frequencySpectrum"), value: "fft" },
        { label: t("histogram"), value: "histogram" },
      ],
    },
    ...(plotMode !== "time" && {
      analysisRange: {
        label: t("analyzedData"),
        help: t("analyzedDataHelp"),
        input: "select",
        value: config.analysisRange ?? "visible",
        options: [
          { label: t("visibleTimeWindow"), value: "visible" },
          { label: t("allLoadedData"), value: "all" },
        ],
      },
    }),
    ...(plotMode === "histogram" && {
      histogramBins: {
        label: t("histogramBins"),
        help: t("histogramBinsHelp"),
        input: "number",
        value: config.histogramBins,
        min: 1,
        max: 10_000,
        step: 1,
        precision: 0,
        placeholder: "auto",
      },
    }),
  };
}

/** X range fields: a time window for timestamp plots, bounds (and 1:1 scaling) for path plots */
function xRangeFields(
  config: PlotConfig,
  t: MakeSeriesNode["t"],
  maxXError: string | undefined,
): DocumentedFields {
  const minMax: DocumentedFields = {
    minXValue: {
      label: t("min"),
      help: t("minHelp"),
      input: "number",
      value: _.isNumber(config.minXValue) ? config.minXValue : undefined,
      placeholder: "auto",
    },
    maxXValue: {
      label: t("max"),
      help: t("maxHelp"),
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
          help: t("axisScalesHelp"),
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
      help: t("timestampFormatHelp"),
      input: "select",
      value: config.timestampFormat ?? "relative",
      options: [
        { label: t("relative"), value: "relative" },
        { label: t("absolute"), value: "absolute" },
        { label: t("relativeToNow"), value: "relativeToNow" },
      ],
    },
    timeWindow: {
      label: t("timeWindow"),
      help: t("timeWindowHelp"),
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
        help: t("windowSizeHelp"),
        input: "number",
        min: 0,
        placeholder: String(DEFAULT_SLIDING_WINDOW_SECONDS),
        value: config.followingViewWidth,
      },
      playheadPosition: {
        label: t("playheadPosition"),
        help: t("playheadPositionHelp"),
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
