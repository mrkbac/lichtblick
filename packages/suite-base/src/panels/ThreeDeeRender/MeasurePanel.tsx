// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  ArrowAutofitHeight20Regular,
  Copy16Regular,
  DataLine20Regular,
  Delete16Regular,
  Flowchart20Regular,
  Location20Regular,
  Pentagon20Regular,
  Ruler20Regular,
  Triangle20Regular,
} from "@fluentui/react-icons";
import {
  Button,
  IconButton,
  MenuItem,
  Paper,
  Select,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import clipboard from "@lichtblick/suite-base/util/clipboard";
import { fontMonospace } from "@lichtblick/theme";

import type { IRenderer } from "./IRenderer";
import { measureKindLabel, MeasureKind, MeasurementInfo } from "./renderables/MeasurementTool";
import type { ProfileSeries } from "./renderables/measure/geometry";

const KIND_ICONS: Record<MeasureKind, React.JSX.Element> = {
  point: <Location20Regular />,
  distance: <Ruler20Regular />,
  polyline: <Flowchart20Regular />,
  angle: <Triangle20Regular />,
  area: <Pentagon20Regular />,
  height: <ArrowAutofitHeight20Regular />,
  profile: <DataLine20Regular />,
};

const DISPLAY_FRAME = "";

const useStyles = makeStyles()((theme) => ({
  root: {
    position: "absolute",
    left: theme.spacing(1),
    bottom: theme.spacing(1),
    width: 280,
    maxHeight: "calc(100% - 16px)",
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(0.75),
    padding: theme.spacing(1),
    pointerEvents: "auto",
    overflow: "hidden",
  },
  row: { display: "flex", alignItems: "center", gap: theme.spacing(0.5) },
  list: { overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 },
  item: {
    padding: theme.spacing(0.5),
    borderRadius: theme.shape.borderRadius,
    cursor: "pointer",
    "&:hover": { backgroundColor: theme.palette.action.hover },
  },
  selected: { backgroundColor: theme.palette.action.selected },
  value: { fontFamily: fontMonospace, flex: 1, overflow: "hidden" },
  details: {
    fontFamily: fontMonospace,
    color: theme.palette.text.secondary,
    whiteSpace: "pre",
    overflowX: "auto",
  },
  chart: { width: "100%", height: 64, display: "block" },
}));

function ProfileChart({ profile }: { profile: ProfileSeries }): React.JSX.Element {
  const { classes, theme } = useStyles();
  const width = 260;
  const height = 64;
  const maxX = profile.x.at(-1) ?? 0;
  const minZ = Math.min(...profile.z);
  const maxZ = Math.max(...profile.z);
  const spanZ = maxZ > minZ ? maxZ - minZ : 1;
  const points = profile.x
    .map((x, i) => {
      const px = maxX > 0 ? (x / maxX) * width : 0;
      const py = height - 4 - ((profile.z[i]! - minZ) / spanZ) * (height - 8);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className={classes.chart} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline
        points={`0,${height} ${points} ${width},${height}`}
        fill={theme.palette.warning.main}
        fillOpacity={0.15}
        stroke="none"
      />
      <polyline
        points={points}
        fill="none"
        stroke={theme.palette.warning.main}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Tool picker and result list for the 3D panel's measurement tool */
export function MeasurePanel({ renderer }: { renderer: IRenderer }): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("threeDee");
  const tool = renderer.measurementTool;
  const [, setVersion] = useState(0);
  const [frames, setFrames] = useState(() => renderer.transformTree.frameList());

  useEffect(() => {
    const onChange = () => {
      setVersion((v) => v + 1);
    };
    const onFrames = () => {
      setFrames(renderer.transformTree.frameList());
    };
    tool.addEventListener("foxglove.measure-change", onChange);
    renderer.on("transformTreeUpdated", onFrames);
    return () => {
      tool.removeEventListener("foxglove.measure-change", onChange);
      renderer.off("transformTreeUpdated", onFrames);
    };
  }, [renderer, tool]);

  const copy = (id?: number) => {
    void clipboard.copy(tool.copyText(id));
  };

  return (
    <Paper className={classes.root} elevation={4} data-testid="measure-panel">
      <ToggleButtonGroup
        size="small"
        exclusive
        value={tool.kind}
        onChange={(_event, kind: MeasureKind | null) => {
          if (kind) {
            tool.startMeasuring(kind);
          }
        }}
      >
        {(Object.keys(KIND_ICONS) as MeasureKind[]).map((kind) => (
          <ToggleButton key={kind} value={kind} aria-label={measureKindLabel(kind)}>
            <Tooltip title={measureKindLabel(kind)} placement="top">
              <span style={{ display: "flex" }}>{KIND_ICONS[kind]}</span>
            </Tooltip>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography variant="caption" color="textSecondary">
        {t("measureHelp")}
      </Typography>
      <div className={classes.row}>
        <Typography variant="caption" noWrap color="textSecondary" style={{ flexShrink: 0 }}>
          {t("measureResultsIn")}
        </Typography>
        <Select
          size="small"
          variant="standard"
          fullWidth
          displayEmpty
          value={tool.resultFrameId ?? DISPLAY_FRAME}
          onChange={(event) => {
            const value = event.target.value;
            tool.setResultFrame(value === DISPLAY_FRAME ? undefined : value);
          }}
        >
          <MenuItem value={DISPLAY_FRAME}>{t("measureDisplayFrame")}</MenuItem>
          {frames.map((frame) => (
            <MenuItem key={frame.value} value={frame.value}>
              {frame.label}
            </MenuItem>
          ))}
        </Select>
      </div>
      <div className={classes.list}>
        {tool.measurements.map((info: MeasurementInfo) => {
          const selected = info.id === tool.selectedId;
          return (
            <div
              key={info.id}
              className={cx(classes.item, { [classes.selected]: selected })}
              onClick={() => {
                tool.select(selected ? undefined : info.id);
              }}
            >
              <div className={classes.row}>
                {KIND_ICONS[info.kind]}
                <Typography variant="body2" className={classes.value} noWrap>
                  {info.summary.label}
                </Typography>
                <Tooltip title={t("measureCopy")}>
                  {/* span: a disabled button fires no events, so the tooltip needs a wrapper */}
                  <span>
                    <IconButton
                      size="small"
                      aria-label={t("measureCopy")}
                      disabled={info.unavailable}
                      onClick={(event) => {
                        event.stopPropagation();
                        copy(info.id);
                      }}
                    >
                      <Copy16Regular />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t("measureDelete")}>
                  <IconButton
                    size="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      tool.removeMeasurement(info.id);
                    }}
                  >
                    <Delete16Regular />
                  </IconButton>
                </Tooltip>
              </div>
              {info.summary.profile && <ProfileChart profile={info.summary.profile} />}
              {selected && (
                <Typography variant="caption" component="div" className={classes.details}>
                  {info.summary.details.join("\n")}
                </Typography>
              )}
            </div>
          );
        })}
      </div>
      {tool.measurements.length > 0 && (
        <div className={classes.row}>
          <Button
            size="small"
            startIcon={<Copy16Regular />}
            disabled={tool.measurements.every((info) => info.unavailable)}
            onClick={() => {
              copy();
            }}
          >
            {t("measureCopyAll")}
          </Button>
          <Button
            size="small"
            color="error"
            startIcon={<Delete16Regular />}
            onClick={() => {
              tool.clearAll();
            }}
          >
            {t("measureClearAll")}
          </Button>
        </div>
      )}
    </Paper>
  );
}
