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
import { SettingsTreeAction } from "@lichtblick/suite";
import { BuiltinPanelExtensionContext } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { useLegendCount } from "@lichtblick/suite-base/components/SettingsTreeEditor/inputs/useLegendCount";
import { replaceDrop } from "@lichtblick/suite-base/panels/shared/pathDrop";
import { createMuiTheme, fontSansSerif } from "@lichtblick/theme";

import { useStyles } from "./PieChart.style";
import { DEFAULT_CONFIG } from "./constants";
import { isNumericArrayPath } from "./isNumericArrayPath";
import type { PieChartConfig, PieChartDatum, PieChartState } from "./types";
import { useChartData } from "./useChartData";
import { useSettingsTree } from "./useSettingsTree";
import { settingsActionReducer } from "./utils/settingsActionReducer";
import { stateReducer } from "./utils/stateReducer";

type PieChartProps = {
  context: BuiltinPanelExtensionContext;
};

export function formatTooltip(value: unknown, name: string | number | undefined): [string, string] {
  const formattedValue = typeof value === "number" ? value.toFixed(2) : String(value);
  return [`${formattedValue}%`, String(name ?? "")];
}

Chart.register(ArcElement, DoughnutController, Tooltip, Legend);

/** The theme colors and font the canvas needs; chart.js can't read CSS. */
export type ChartTheme = {
  text: string;
  mutedText: string;
  surface: string;
  border: string;
  fontFamily: string;
};

/** Two decimals at most, without trailing zeros. */
const formatSliceValue = (value: number | undefined): string =>
  value == undefined ? "" : String(Number(value.toFixed(2)));

export function buildChartConfig(
  data: readonly PieChartDatum[],
  rawValue: Float32Array,
  theme: ChartTheme,
): ChartConfiguration<"doughnut"> {
  const colors = data.map((entry) => entry.color);
  const font = { family: theme.fontFamily, size: 12 };
  return {
    type: "doughnut",
    data: {
      labels: data.map((entry) => entry.name),
      datasets: [
        {
          data: data.map((entry) => entry.value),
          backgroundColor: colors,
          // Thin gaps between slices in the panel's own background color.
          borderColor: theme.surface,
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    },
    // datalabels is registered per chart so other chart.js users are unaffected
    plugins: [ChartDataLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      radius: "85%",
      // Room around the ring for the value labels.
      layout: { padding: 20 },
      animation: { duration: 300, easing: "easeOutQuad" },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: theme.mutedText,
            usePointStyle: true,
            pointStyle: "circle",
            font: { ...font, size: 11 },
            boxWidth: 7,
            boxHeight: 7,
            padding: 8,
          },
        },
        tooltip: {
          backgroundColor: theme.surface,
          titleColor: theme.text,
          bodyColor: theme.text,
          borderColor: theme.border,
          borderWidth: 1,
          cornerRadius: 6,
          padding: 8,
          titleFont: { ...font, weight: "bold" },
          bodyFont: font,
          usePointStyle: true,
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
          clamp: true,
          // Labels on thin slices collide; the tooltip still has their values.
          display: (ctx) => (data[ctx.dataIndex]?.value ?? 0) >= 6,
          color: (ctx) => colors[ctx.dataIndex] ?? theme.text,
          font: { family: theme.fontFamily, size: 11, weight: "bold" },
          formatter: (_value, ctx) => formatSliceValue(rawValue[ctx.dataIndex]),
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
  // Follow the app's light/dark theme; the canvas needs the colors as values.
  const [colorScheme, setColorScheme] = useState<"dark" | "light">("dark");
  const chartTheme = useMemo((): ChartTheme => {
    const { palette } = createMuiTheme(colorScheme);
    return {
      text: palette.text.primary,
      mutedText: palette.text.secondary,
      surface: palette.background.default,
      border: palette.divider,
      fontFamily: fontSansSerif,
    };
  }, [colorScheme]);

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
    () => state.latestMatchingQueriedData ?? new Float32Array(),
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
    const chartConfig = buildChartConfig(chartData, rawValue, chartTheme);
    if (chartRef.current) {
      chartRef.current.data = chartConfig.data;
      chartRef.current.options = chartConfig.options ?? {};
      chartRef.current.update("none");
    } else {
      chartRef.current = new Chart(canvas, chartConfig);
    }
  }, [chartData, rawValue, chartTheme]);

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

  // Drop a numeric array field from the topic list to chart it
  useEffect(() => {
    context.unstable_setMessagePathDropConfig(
      replaceDrop(
        (item) => isNumericArrayPath(item.path, context.getTopicSchema, context.getSchema),
        (item) => {
          setConfig((prev) => ({ ...prev, path: item.path }));
        },
      ),
    );
  }, [context]);

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

      if (renderState.colorScheme) {
        setColorScheme(renderState.colorScheme);
      }
    };
    context.watch("currentFrame");
    context.watch("didSeek");
    context.watch("colorScheme");

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
    <div className={classes.root} style={{ color: chartTheme.text }}>
      {config.title !== "" && <h1 className={classes.title}>{config.title}</h1>}
      {chartData.length === 0 ? (
        <div className={classes.empty} style={{ color: chartTheme.mutedText }}>
          {state.error?.message ?? "No data available"}
        </div>
      ) : (
        <div className={classes.chart}>
          <canvas ref={canvasRef} />
        </div>
      )}
    </div>
  );
}
