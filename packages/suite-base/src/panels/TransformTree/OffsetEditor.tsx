// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Dismiss12Regular, Info16Regular } from "@fluentui/react-icons";
import {
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { NumberInput } from "@lichtblick/suite-base/components/SettingsTreeEditor/inputs/NumberInput";
import {
  ADJUST_STEPS,
  AdjustStep,
  applyOffset,
  FrameOffset,
  formatStaticTransformPublisher,
  formatUrdfJoint,
  formatYaml,
  offsetForResult,
  Quat,
  quatToRosRpyDegrees,
  quatToRpyDegrees,
  rosRpyDegreesToQuat,
  Vec3,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms/transformOffsets";
import clipboard from "@lichtblick/suite-base/util/clipboard";

import { useStyles } from "./TransformTree.style";

const PRECISION_METERS = 3;
const PRECISION_DEGREES = 3;
const ZERO: Vec3 = [0, 0, 0];
const STEPS: readonly AdjustStep[] = ["fine", "medium", "coarse"];
const COLUMNS = { xyz: ["x", "y", "z"], rpy: ["roll", "pitch", "yaw"] } as const;

type Part = "xyz" | "rpy";

/** Shown values are rounded so a focused input never shows float noise; edits use exact values */
const roundTo = (values: Readonly<Vec3>, digits: number): Vec3 =>
  values.map((value) => Number(value.toFixed(digits))) as Vec3;

/** ⓘ that explains which roll/pitch/yaw convention a set of angles uses */
export function RotationConventionInfo({ text }: { text: string }): React.JSX.Element {
  const { classes } = useStyles();
  return (
    <Tooltip title={<span style={{ whiteSpace: "pre-line" }}>{text}</span>}>
      <span className={classes.infoIcon} role="img" aria-label={text}>
        <Info16Regular />
      </span>
    </Tooltip>
  );
}

type Props = {
  frame: string;
  parent: string;
  recorded: { position: Vec3; rotation: Quat };
  offset: FrameOffset | undefined;
  showOriginal: boolean;
  step: AdjustStep;
  onChange: (offset: FrameOffset | undefined) => void;
  onShowOriginalChange: (change: { showOriginal: boolean }) => void;
  onStepChange: (step: AdjustStep) => void;
  onClose: () => void;
};

/**
 * Edits the layout-wide offset of one frame, the same values the 3D and Image panels apply.
 * Either the offset or the result can be typed; the other follows.
 */
export function OffsetEditor({
  frame,
  parent,
  recorded,
  offset,
  showOriginal,
  step,
  onChange,
  onShowOriginalChange,
  onStepChange,
  onClose,
}: Props): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("transformTree");
  const [copyAnchor, setCopyAnchor] = useState<HTMLElement | undefined>();

  const current = offset ?? { xyz: ZERO, rpy: ZERO };
  const result = applyOffset(recorded.position, recorded.rotation, offset);
  // Same convention as the table: ROS roll/pitch/yaw around the parent's fixed axes
  const resultRpy = quatToRosRpyDegrees(result.rotation);
  const { meters, degrees } = ADJUST_STEPS[step];

  const setOffsetPart = (part: Part, index: number, value: number | undefined) => {
    const next: FrameOffset = { xyz: [...current.xyz], rpy: [...current.rpy] };
    next[part][index] = value ?? 0;
    onChange(next);
  };
  const setResultPart = (part: Part, index: number, value: number | undefined) => {
    const xyz: Vec3 = [...result.position];
    const rpy: Vec3 = [...resultRpy];
    (part === "xyz" ? xyz : rpy)[index] = value ?? 0;
    // offsetForResult takes the offsets' own convention (intrinsic XYZ)
    const intrinsicRpy = quatToRpyDegrees(rosRpyDegreesToQuat(rpy));
    const next = offsetForResult(recorded.position, recorded.rotation, xyz, intrinsicRpy);
    // Keep the untouched half exactly as it was instead of a recomputed approximation
    onChange(part === "xyz" ? { ...current, xyz: next.xyz } : { ...current, rpy: next.rpy });
  };

  const inputs = (
    part: Part,
    label: string,
    help: string,
    values: Readonly<Vec3>,
    onValue: (part: Part, index: number, value: number | undefined) => void,
  ) => (
    <>
      <span className={classes.editorLabel} title={help}>
        {label}
      </span>
      {values.map((value, index) => (
        <NumberInput
          key={COLUMNS[part][index]}
          inputAriaLabel={`${label} ${t(`columns.${COLUMNS[part][index]!}`)}`}
          size="small"
          variant="filled"
          fullWidth
          precision={part === "xyz" ? PRECISION_METERS : PRECISION_DEGREES}
          step={part === "xyz" ? meters : degrees}
          value={value}
          onChange={(next) => {
            onValue(part, index, next);
          }}
        />
      ))}
    </>
  );

  // Translation and rotation in separate blocks so each input is wide enough for its value
  const block = (part: Part, offsetValues: Readonly<Vec3>, resultValues: Readonly<Vec3>) => (
    <>
      {part === "rpy" ? <RotationConventionInfo text={t("editor.rotationConvention")} /> : <span />}
      {COLUMNS[part].map((column) => (
        <span key={column} className={classes.editorColumn}>
          {t(`columns.${column}`)}
        </span>
      ))}
      {inputs(part, t("editor.offset"), t("editor.offsetHelp"), offsetValues, setOffsetPart)}
      {inputs(part, t("editor.result"), t("editor.resultHelp"), resultValues, setResultPart)}
    </>
  );

  const copy = (format: typeof formatYaml) => {
    void clipboard.copy(format(parent, frame, result.position, result.rotation));
    setCopyAnchor(undefined);
  };

  return (
    <div className={classes.editor} data-testid="offset-editor">
      <div className={classes.editorHeader}>
        <span className={classes.editorTitle} title={`${parent} → ${frame}`}>
          {t("editor.title", { frame })}
        </span>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={step}
          aria-label={t("editor.stepLabel")}
          onChange={(_event, value: AdjustStep | null) => {
            if (value != undefined) {
              onStepChange(value);
            }
          }}
        >
          {STEPS.map((value) => (
            <ToggleButton key={value} value={value} className={classes.stepButton}>
              {t(`editor.step.${value}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <IconButton size="small" aria-label={t("editor.close")} onClick={onClose}>
          <Dismiss12Regular />
        </IconButton>
      </div>
      <div className={classes.editorGrid}>
        {block("xyz", current.xyz, roundTo(result.position, PRECISION_METERS))}
        {block("rpy", current.rpy, roundTo(resultRpy, PRECISION_DEGREES))}
      </div>
      <div className={classes.editorActions}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={showOriginal}
              onChange={(_event, checked) => {
                onShowOriginalChange({ showOriginal: checked });
              }}
            />
          }
          label={t("editor.showOriginal")}
          title={t("editor.showOriginalHelp")}
        />
        <span className={classes.spacer} />
        <Button
          size="small"
          disabled={offset == undefined}
          onClick={() => {
            onChange(undefined);
          }}
        >
          {t("editor.reset")}
        </Button>
        <Button
          size="small"
          onClick={(event) => {
            setCopyAnchor(event.currentTarget);
          }}
        >
          {t("editor.copy")}
        </Button>
        <Menu
          anchorEl={copyAnchor}
          open={copyAnchor != undefined}
          onClose={() => {
            setCopyAnchor(undefined);
          }}
        >
          <MenuItem
            onClick={() => {
              copy(formatUrdfJoint);
            }}
          >
            {t("editor.copyUrdf")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              copy(formatStaticTransformPublisher);
            }}
          >
            {t("editor.copyStaticTransformPublisher")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              copy(formatYaml);
            }}
          >
            {t("editor.copyYaml")}
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
}
