// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TFunction } from "i18next";
import * as _ from "lodash-es";
import memoizeWeak from "memoize-weak";

import { SettingsTreeNodeActionItem } from "@lichtblick/suite";
import { parseCondition } from "@lichtblick/suite-base/panels/StateTransitions/condition";
import { DEFAULT_STATE_TRANSITION_PATH } from "@lichtblick/suite-base/panels/StateTransitions/constants";
import { PLOTABLE_ROS_TYPES } from "@lichtblick/suite-base/panels/shared/constants";
import type {
  DocumentedField,
  DocumentedNode,
  DocumentedNodes,
} from "@lichtblick/suite-base/panels/shared/documentedSettings";

import { stateTransitionPathDisplayName } from "./shared";
import {
  AxisTreeField,
  PathState,
  SeriesAction,
  SeriesActionId,
  StateTransitionConfig,
} from "./types";

export const defaultConfig: StateTransitionConfig = {
  paths: [],
  isSynced: true,
};

// Note - we use memoizeWeak here instead of react memoization to allow us to memoize
// at the level of individual nodes in our tree. This keeps our DOM updates small since
// the NodeEditor component is wrapped in a React.memo.

export function setSeriesAction({ label, icon, id }: SeriesAction): SettingsTreeNodeActionItem {
  return {
    display: "inline",
    icon,
    id,
    label,
    type: "action",
  };
}

export const makeSeriesNode = memoizeWeak(
  (
    index: number,
    {
      path,
      canDelete,
      canReorder,
      isArray,
    }: PathState & { canDelete: boolean; canReorder: boolean },
    t: TFunction<"stateTransitions">,
  ): DocumentedNode => {
    const action = setSeriesAction({
      label: t("labels.deleteSeries"),
      id: SeriesActionId.DELETE,
      icon: "Clear",
    });
    return {
      actions: canDelete ? [action] : [],
      label: stateTransitionPathDisplayName(path, index),
      reorderable: canReorder,
      icon: canReorder ? ("DragHandle" as const) : undefined,
      fields: {
        value: {
          ...(isArray ? { error: t("pathErrorMessage") } : {}),
          input: "messagepath",
          supportsMathModifiers: true,
          label: t("labels.messagePath"),
          help: t("labels.messagePathHelp"),
          validTypes: PLOTABLE_ROS_TYPES,
          value: path.value,
        },
        condition: {
          input: "string",
          label: t("labels.condition"),
          help: t("labels.conditionHelp"),
          placeholder: '> 2, == "ERROR"',
          value: path.condition,
          ...(path.condition && !parseCondition(path.condition)
            ? { error: t("conditionErrorMessage") }
            : {}),
        },
        label: {
          input: "string",
          label: t("labels.label"),
          help: t("labels.labelHelp"),
          value: path.label,
        },
        timestampMethod: {
          input: "select",
          label: t("labels.timestamp"),
          help: t("labels.timestampHelp"),
          options: [
            { label: t("labels.timestampReceiveTime"), value: "receiveTime" },
            { label: t("labels.timestampHeaderStamp"), value: "headerStamp" },
          ],
          value: path.timestampMethod,
        },
      },
    };
  },
);

export const makeRootSeriesNode = memoizeWeak(
  (paths: PathState[], t: TFunction<"stateTransitions">): DocumentedNode => {
    const children = Object.fromEntries(
      paths.length === 0
        ? [
            [
              "0",
              makeSeriesNode(
                0,
                {
                  path: DEFAULT_STATE_TRANSITION_PATH,
                  isArray: false,
                  canDelete: false,
                  canReorder: false,
                },
                t,
              ),
            ],
          ]
        : paths.map(({ path, isArray }, index) => [
            `${index}`,
            makeSeriesNode(
              index,
              {
                path,
                isArray,
                canDelete: true,
                canReorder: paths.length > 1,
              },
              t,
            ),
          ]),
    );
    return {
      label: t("labels.series"),
      children,
      actions: [
        setSeriesAction({
          label: t("labels.addSeries"),
          id: SeriesActionId.ADD,
          icon: "Addchart",
        }),
      ],
    };
  },
);

function setAxis({ value, label, help, error }: AxisTreeField): DocumentedField {
  return {
    label,
    help,
    input: "number",
    value,
    placeholder: "auto",
    error,
  };
}

export function buildSettingsTree(
  {
    isSynced,
    xAxisMaxValue,
    xAxisMinValue,
    xAxisRange,
    xAxisLabel,
    showPoints,
  }: StateTransitionConfig,
  paths: PathState[],
  t: TFunction<"stateTransitions">,
): DocumentedNodes {
  const maxXError =
    _.isNumber(xAxisMinValue) && _.isNumber(xAxisMaxValue) && xAxisMinValue >= xAxisMaxValue
      ? t("maxXError")
      : undefined;

  return {
    general: {
      label: t("labels.general"),
      fields: {
        isSynced: {
          label: t("labels.sync"),
          help: t("labels.syncHelp"),
          input: "boolean",
          value: isSynced,
        },
        showPoints: {
          help: t("labels.helpGeneral"),
          input: "boolean",
          label: t("labels.showPoints"),
          value: showPoints,
        },
      },
    },
    xAxis: {
      label: t("xAxis"),
      fields: {
        xAxisLabel: {
          label: t("labels.axisLabel"),
          help: t("labels.axisLabelHelp"),
          input: "string",
          value: xAxisLabel,
        },
        xAxisMaxValue: setAxis({
          label: t("max"),
          help: t("maxHelp"),
          value: xAxisMaxValue,
          error: maxXError,
        }),
        xAxisMinValue: setAxis({ label: t("min"), help: t("minHelp"), value: xAxisMinValue }),
        xAxisRange: setAxis({
          label: t("secondsRange"),
          help: t("secondsRangeHelp"),
          value: xAxisRange,
        }),
      },
    },
    paths: makeRootSeriesNode(paths, t),
  };
}
