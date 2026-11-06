// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ArrowSwap16Regular, Copy16Regular, Dismiss16Regular } from "@fluentui/react-icons";
import {
  Autocomplete,
  IconButton,
  MenuItem,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import clipboard from "@lichtblick/suite-base/util/clipboard";
import { fontMonospace } from "@lichtblick/theme";

import {
  DEFAULT_MEASURE_CONVENTION,
  distance,
  FrameMeasurement,
  formatMeasurementText,
  formatNumber,
  formatRotation,
  MissingLink,
  Pose,
  ROTATION_FORMATS,
  setEnd,
  swapFrames,
} from "./transforms/frameMeasurement";

export const FROM_COLOR = "#2bd47d";
export const TO_COLOR = "#f5a623";

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(0.75),
    padding: theme.spacing(1),
    width: 300,
    pointerEvents: "auto",
  },
  row: { display: "flex", alignItems: "center", gap: theme.spacing(0.5) },
  title: { flex: 1 },
  ends: { flex: 1, display: "flex", flexDirection: "column", gap: theme.spacing(0.5) },
  end: { display: "flex", alignItems: "center", gap: theme.spacing(0.75) },
  dot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  values: {
    display: "grid",
    gridTemplateColumns: "auto repeat(4, 1fr)",
    columnGap: theme.spacing(1),
    rowGap: 2,
    fontFamily: fontMonospace,
    fontSize: theme.typography.caption.fontSize,
    alignItems: "baseline",
  },
  name: { color: theme.palette.text.secondary, fontFamily: theme.typography.fontFamily },
  value: { textAlign: "right", whiteSpace: "nowrap" },
  axis: { textAlign: "right", color: theme.palette.text.secondary },
  message: { color: theme.palette.warning.main },
  select: { fontSize: "inherit" },
  rotationOptions: {
    gridColumn: "1 / -1",
    display: "flex",
    gap: theme.spacing(1.5),
    marginTop: theme.spacing(0.5),
  },
}));

export type FrameMeasureCardProps = {
  frames: readonly string[];
  measurement: FrameMeasurement;
  onChange: (next: FrameMeasurement) => void;
  onClose: () => void;
  /** Pose of To expressed in From; undefined while a frame is unset or a transform is missing */
  pose: Pose | undefined;
  /** Why there is no pose although both frames are set */
  missing: MissingLink | "unavailable" | undefined;
  /** Which end the next click in the 3D view picks, if picking */
  pickingEnd?: "from" | "to";
  className?: string;
};

/** From/To pickers and the pose of To in From, shared by the 3D and Transform Tree panels */
export function FrameMeasureCard({
  frames,
  measurement,
  onChange,
  onClose,
  pose,
  missing,
  pickingEnd,
  className,
}: FrameMeasureCardProps): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("threeDee");
  const { from, to } = measurement;
  const format = measurement.rotationFormat ?? "degrees";
  const convention = measurement.convention ?? DEFAULT_MEASURE_CONVENTION;
  const complete = from != undefined && to != undefined;
  const shown = complete && missing == undefined ? pose : undefined;
  const rotation = shown && formatRotation(shown.rotation, format, convention);

  const endInput = (end: "from" | "to") => (
    <div className={classes.end}>
      <span
        className={classes.dot}
        style={{ backgroundColor: end === "from" ? FROM_COLOR : TO_COLOR }}
      />
      <Autocomplete
        size="small"
        fullWidth
        autoHighlight
        options={frames}
        value={measurement[end] ?? null}
        onChange={(_event, frame) => {
          onChange(setEnd(measurement, end, frame ?? undefined));
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            variant="standard"
            placeholder={end === "from" ? t("frameMeasureFrom") : t("frameMeasureTo")}
            slotProps={{
              ...params.slotProps,
              htmlInput: {
                ...params.slotProps.htmlInput,
                "aria-label": end === "from" ? t("frameMeasureFrom") : t("frameMeasureTo"),
              },
            }}
            focused={pickingEnd === end ? true : undefined}
          />
        )}
      />
    </div>
  );

  let message: string | undefined;
  if (!complete) {
    message =
      pickingEnd != undefined
        ? t("frameMeasurePickHelp", {
            end: pickingEnd === "from" ? t("frameMeasureFrom") : t("frameMeasureTo"),
          })
        : t("frameMeasureChooseHelp");
  } else if (missing === "unavailable") {
    message = t("frameMeasureUnavailable");
  } else if (missing && "frame" in missing) {
    message = t("frameMeasureMissingFrame", { frame: missing.frame });
  } else if (missing) {
    message = t("frameMeasureNotConnected", { a: missing.between[0], b: missing.between[1] });
  }

  return (
    <Paper className={cx(classes.root, className)} elevation={4} data-testid="frame-measure">
      <div className={classes.row}>
        <Typography variant="subtitle2" className={classes.title}>
          {t("frameMeasureTitle")}
        </Typography>
        <Tooltip title={t("frameMeasureCopy")}>
          {/* span: a disabled button fires no events, so the tooltip needs a wrapper */}
          <span>
            <IconButton
              size="small"
              aria-label={t("frameMeasureCopy")}
              disabled={!shown}
              onClick={() => {
                if (shown && from != undefined && to != undefined) {
                  void clipboard.copy(formatMeasurementText(from, to, shown, format, convention));
                }
              }}
            >
              <Copy16Regular />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("frameMeasureClose")}>
          <IconButton size="small" aria-label={t("frameMeasureClose")} onClick={onClose}>
            <Dismiss16Regular />
          </IconButton>
        </Tooltip>
      </div>
      <div className={classes.row}>
        <div className={classes.ends}>
          {endInput("from")}
          {endInput("to")}
        </div>
        <Tooltip title={t("frameMeasureSwap")}>
          <IconButton
            size="small"
            aria-label={t("frameMeasureSwap")}
            onClick={() => {
              onChange(swapFrames(measurement));
            }}
          >
            <ArrowSwap16Regular style={{ transform: "rotate(90deg)" }} />
          </IconButton>
        </Tooltip>
      </div>
      {message != undefined && (
        <Typography
          variant="caption"
          className={cx({ [classes.message]: complete })}
          color={complete ? undefined : "textSecondary"}
          role={complete ? "status" : undefined}
        >
          {message}
        </Typography>
      )}
      {shown && rotation && (
        <div className={classes.values} data-testid="frame-measure-values">
          <span className={classes.name}>{t("frameMeasureDistance")}</span>
          <span className={classes.value} style={{ gridColumn: "2 / span 2" }}>
            {formatNumber(distance(shown), 3)} m
          </span>
          <span style={{ gridColumn: "4 / span 2" }} />

          <span />
          {["x", "y", "z"].map((axis) => (
            <span key={axis} className={classes.axis}>
              {axis}
            </span>
          ))}
          <span />
          <span className={classes.name}>{t("frameMeasureTranslation")}</span>
          {shown.position.map((value, i) => (
            <span key={i} className={classes.value}>
              {formatNumber(value, 3)}
            </span>
          ))}
          <span />

          <span className={classes.rotationOptions}>
            <Select
              size="small"
              variant="standard"
              value={format}
              inputProps={{ "aria-label": t("frameMeasureRotationFormat") }}
              onChange={(event) => {
                onChange({ ...measurement, rotationFormat: event.target.value });
              }}
              className={classes.select}
            >
              {ROTATION_FORMATS.map((option) => (
                <MenuItem key={option} value={option}>
                  {t(
                    option === "degrees"
                      ? "frameMeasureDegrees"
                      : option === "radians"
                        ? "frameMeasureRadians"
                        : "frameMeasureQuaternion",
                  )}
                </MenuItem>
              ))}
            </Select>
            {format !== "quaternion" && (
              <Tooltip
                placement="top"
                title={t(
                  convention === "extrinsic"
                    ? "frameMeasureConventionExtrinsic"
                    : "frameMeasureConventionIntrinsic",
                )}
              >
                <Select
                  size="small"
                  variant="standard"
                  value={convention}
                  inputProps={{ "aria-label": t("frameMeasureConvention") }}
                  onChange={(event) => {
                    onChange({
                      ...measurement,
                      convention: event.target.value,
                    });
                  }}
                  className={classes.select}
                >
                  <MenuItem value="extrinsic">{t("frameMeasureExtrinsic")}</MenuItem>
                  <MenuItem value="intrinsic">{t("frameMeasureIntrinsic")}</MenuItem>
                </Select>
              </Tooltip>
            )}
          </span>

          <span />
          {rotation.labels.map((label) => (
            <span key={label} className={classes.axis}>
              {label}
            </span>
          ))}
          {rotation.labels.length === 3 && <span />}
          <span className={classes.name}>{t("frameMeasureRotation")}</span>
          {rotation.values.map((value, i) => (
            <span key={i} className={classes.value}>
              {value}
              {rotation.unit === "°" ? "°" : ""}
            </span>
          ))}
          {rotation.values.length === 3 && <span />}
        </div>
      )}
    </Paper>
  );
}
