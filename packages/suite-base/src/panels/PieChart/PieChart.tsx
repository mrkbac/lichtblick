// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// SPDX-FileCopyrightText: Copyright (C) 2024-2025 Yukihiro Saito <yukky.saito@gmail.com>
// SPDX-FileCopyrightText: Copyright (C) 2025 Takayuki Honda <takayuki.honda@tier4.jp>
// SPDX-License-Identifier: MPL-2.0

import {
  ArcElement,
  Chart,
  type ChartConfiguration,
  DoughnutController,
  Legend,
  Tooltip,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useMemo,
} from "react";

import { parseMessagePath } from "@lichtblick/message-path";
import { PanelExtensionContext, SettingsTreeAction } from "@lichtblick/suite";
import { useLegendCount } from "@lichtblick/suite-base/components/SettingsTreeEditor/inputs/useLegendCount";

import { useStyles } from "./PieChart.style";
import { DEFAULT_CONFIG } from "./constants";
import type { PieChartConfig, PieChartDatum, PieChartState } from "./types";
import { useChartData } from "./useChartData";
import { useSettingsTree } from "./useSettingsTree";
import { settingsActionReducer } from "./utils/settingsActionReducer";
import { stateReducer } from "./utils/stateReducer";

type PieChartProps = {
  context: PanelExtensionContext;
};

export function formatTooltip(value: unknown, name: string | number | undefined): [string, string] {
  const formattedValue = typeof value === "number" ? value.toFixed(2) : String(value);
  return [`${formattedValue}%`, String(name ?? "")];
}

Chart.register(ArcElement, DoughnutController, Tooltip, Legend);

export function buildChartConfig(
  data: readonly PieChartDatum[],
  rawValue: Float32Array,
): ChartConfiguration<"doughnut"> {
  const colors = data.map((entry) => entry.color);
  return {
    type: "doughnut",
    data: {
      labels: data.map((entry) => entry.name),
      datasets: [{ data: data.map((entry) => entry.value), backgroundColor: colors }],
    },
    // datalabels is registered per chart so other chart.js users are unaffected
    plugins: [ChartDataLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "50%", // innerRadius 40% / outerRadius 80%
      radius: "80%",
      animation: { duration: 1500, easing: "easeInOutQuad" },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          backgroundColor: "rgba(255, 255, 255, 0.8)",
          titleColor: "#333",
          bodyColor: "#333",
          cornerRadius: 10,
          padding: 10,
          bodyFont: { size: 14 },
          callbacks: {
            label: (item) => {
              const [value, name] = formatTooltip(item.raw, item.label);
              return `${name}: ${value}`;
            },
          },
        },
        datalabels: {
          anchor: "end",
          align: "end",
          color: (ctx) => colors[ctx.dataIndex] ?? "#333",
          formatter: (_value, ctx) => rawValue[ctx.dataIndex]?.toFixed(2) ?? "",
        },
      },
    },
  };
}

export function PieChart({ context }: PieChartProps): React.JSX.Element {
  // panel extensions must notify when they've completed rendering
  // onRender will setRenderDone to a done callback which we can invoke after we've rendered
  const { classes } = useStyles();
  const [renderDone, setRenderDone] = useState<() => void>(() => () => {});
  const { legendCount } = useLegendCount();

  const [config, setConfig] = useState<PieChartConfig>(() => ({
    ...DEFAULT_CONFIG,
    ...(context.initialState as Partial<PieChartConfig>),
  }));

  const [state, dispatch] = useReducer(
    stateReducer,
    config,
    ({ path }): PieChartState => ({
      path,
      parsedPath: parseMessagePath(path),
      latestMessage: undefined,
      latestMatchingQueriedData: undefined,
      pathParseError: undefined,
      error: undefined,
    }),
  );

  const settingsActionHandler = useCallback((action: SettingsTreeAction) => {
    setConfig((prevConfig) => settingsActionReducer(prevConfig, action));
  }, []);

  const settingsTree = useSettingsTree({
    config,
    pathParseError: state.pathParseError,
    error: state.error?.message,
    legendCount,
  });

  // Extract raw values from queried message data
  const rawValue = useMemo(
    () =>
      state.latestMatchingQueriedData instanceof Float32Array
        ? state.latestMatchingQueriedData
        : new Float32Array(),
    [state.latestMatchingQueriedData],
  );

  // Normalize values into percentage format from useChartData
  const chartData = useChartData(rawValue, config);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<"doughnut"> | undefined>(undefined);

  // Create the chart once the canvas exists, update it in place on new data,
  // destroy it when the canvas goes away (empty data)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      chartRef.current?.destroy();
      chartRef.current = undefined;
      return;
    }
    const chartConfig = buildChartConfig(chartData, rawValue);
    if (chartRef.current) {
      chartRef.current.data = chartConfig.data;
      chartRef.current.options = chartConfig.options ?? {};
      chartRef.current.update("none");
    } else {
      chartRef.current = new Chart(canvas, chartConfig);
    }
  }, [chartData, rawValue]);

  useEffect(
    () => () => {
      chartRef.current?.destroy();
      chartRef.current = undefined;
    },
    [],
  );

  // Dispatch path change on config.path update
  useLayoutEffect(() => {
    dispatch({ type: "path", path: config.path });
  }, [config.path]);

  // Save panel state and title on config update
  useEffect(() => {
    context.saveState(config);
    context.setDefaultPanelTitle(config.path === "" ? undefined : config.path);
  }, [config, context]);

  // Register frame/seek render handler
  useEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);

      if (renderState.didSeek === true) {
        dispatch({ type: "seek" });
      }

      if (renderState.currentFrame) {
        dispatch({ type: "frame", messages: renderState.currentFrame });
      }
    };
    context.watch("currentFrame");
    context.watch("didSeek");

    return () => {
      context.onRender = undefined;
    };
  }, [context]);

  // Update panel settings editor with latest tree and handler
  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: settingsTree,
    });
  }, [context, settingsActionHandler, settingsTree]);

  // Subscribe/unsubscribe to topic from parsed path
  useEffect(() => {
    if (state.parsedPath?.topicName != undefined) {
      context.subscribe([{ topic: state.parsedPath.topicName, preload: false }]);
    }
    return () => {
      context.unsubscribeAll();
    };
  }, [context, state.parsedPath?.topicName]);

  // Call renderDone after render
  useEffect(() => {
    renderDone();
  }, [renderDone]);

  return (
    <div className={classes.root}>
      <h1 className={classes.title}>{config.title} </h1>
      {rawValue.length === 0 ? (
        <div>No data available</div>
      ) : (
        <div className={classes.chart}>
          <canvas ref={canvasRef} />
        </div>
      )}
    </div>
  );
}
