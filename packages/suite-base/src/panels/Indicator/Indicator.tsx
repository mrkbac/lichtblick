// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import { Typography } from "@mui/material";
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { Immutable, RenderState, SettingsTreeAction } from "@lichtblick/suite";
import { PanelIconButton } from "@lichtblick/suite-base/components/PanelButton";
import Stack from "@lichtblick/suite-base/components/Stack";
import { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";
import { useStyles } from "@lichtblick/suite-base/panels/Indicator/Indicator.style";
import {
  DEFAULT_CONFIG,
  DEFAULT_FALLBACK_COLOR,
} from "@lichtblick/suite-base/panels/Indicator/constants";
import {
  initialState,
  stateReducer,
} from "@lichtblick/suite-base/panels/shared/gaugeAndIndicatorStateReducer";
import { useReplacePathDrop } from "@lichtblick/suite-base/panels/shared/pathDrop";
import { usePathPanel } from "@lichtblick/suite-base/panels/shared/usePathPanel";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";

import {
  AlertSnapshot,
  getAlertRule,
  getNotificationPermission,
  hasAlert,
  playAlertSound,
  requestNotificationPermission,
  sendTestAlert,
  showAlertNotification,
} from "./alerts";
import { INDICATOR_BUTTONS } from "./buttons";
import { getMatchingRule } from "./getMatchingRule";
import { buildSettingsTree, settingsActionReducer } from "./settings";
import { IndicatorAlertSound, IndicatorConfig, IndicatorProps, RawValueIndicator } from "./types";

export function Indicator({ context }: IndicatorProps): React.JSX.Element {
  const [config, setConfig] = useState(() => ({
    ...DEFAULT_CONFIG,
    ...(context.initialState as Partial<IndicatorConfig>),
  }));

  const { style, rules, fallbackColor, fallbackLabel, alertsMuted = false } = config;
  const [seekCount, setSeekCount] = useState(0);

  const [state, dispatch] = useReducer(stateReducer, config, initialState);

  const { error, latestMatchingQueriedData, parsedPath } = state;

  // Drop a field from the topic list to show it
  useReplacePathDrop(context, setConfig);

  // Global variables can fill in the path; seeks reset the alert baseline
  const onRender = useCallback((renderState: Immutable<RenderState>) => {
    if (renderState.variables) {
      dispatch({
        type: "updateGlobalVariables",
        globalVariables: Object.fromEntries(renderState.variables) as GlobalVariables,
      });
    }
    if (renderState.didSeek === true) {
      setSeekCount((count) => count + 1);
    }
  }, []);
  useEffect(() => {
    context.watch("variables");
  }, [context]);

  // unique across tabs so panels in different tabs don't replace each other's notifications
  const [notificationTag] = useState(randomUUID);

  // Shown in the settings; also follows changes made in the browser's site settings
  const [notificationPermission, setNotificationPermission] = useState(getNotificationPermission);
  useEffect(() => {
    let status: PermissionStatus | undefined;
    let unmounted = false;
    const update = () => {
      setNotificationPermission(getNotificationPermission());
    };
    // Missing in some browsers and test environments
    if ("permissions" in navigator) {
      navigator.permissions
        .query({ name: "notifications" })
        .then((result) => {
          if (!unmounted) {
            status = result;
            status.addEventListener("change", update);
          }
        })
        .catch(() => {});
    }
    return () => {
      unmounted = true;
      status?.removeEventListener("change", update);
    };
  }, []);
  const requestPermission = useCallback(() => {
    void requestNotificationPermission().then(setNotificationPermission);
  }, []);

  const settingsActionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action === "update" && action.payload.path[0] === "rules") {
        const { path, value } = action.payload;
        if (path[2] === "alertSound") {
          playAlertSound(value as IndicatorAlertSound); // preview the selected tone
        } else if (path[2] === "alertNotify" && value === true) {
          requestPermission();
        }
      }
      if (action.action === "perform-node-action") {
        const { id, path } = action.payload;
        if (id === "request-notification-permission") {
          requestPermission();
          return;
        }
        if (id === "test-alert") {
          const rule = config.rules[Number(path[1])];
          if (rule) {
            void sendTestAlert(rule, config.path, notificationTag).then(() => {
              setNotificationPermission(getNotificationPermission());
            });
          }
          return;
        }
      }
      setConfig((prevConfig) => settingsActionReducer(prevConfig, action));
    },
    [config.path, config.rules, notificationTag, requestPermission],
  );

  const settingsTree = useMemo(
    () => buildSettingsTree(config, error?.message, notificationPermission),
    [config, error?.message, notificationPermission],
  );
  const colorScheme = usePathPanel({
    context,
    config,
    dispatch,
    topicName: parsedPath?.topicName,
    actionHandler: settingsActionHandler,
    nodes: settingsTree,
    onRender,
  });

  const rawValue = useMemo((): RawValueIndicator => {
    const value = latestMatchingQueriedData;
    return typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "bigint" ||
      typeof value === "string"
      ? value
      : undefined;
  }, [latestMatchingQueriedData]);

  const matchingRule = useMemo(() => getMatchingRule(rawValue, rules), [rawValue, rules]);

  // Alert only on transitions into a rule; seeks, rule edits and missing data just reset the baseline.
  const prevSnapshot = useRef<AlertSnapshot | undefined>(undefined);
  useEffect(() => {
    const snapshot: AlertSnapshot = {
      ruleIndex:
        rawValue == undefined ? undefined : matchingRule ? rules.indexOf(matchingRule) : -1,
      rules,
      // the reducer's path, which updates together with rawValue (config.path changes a render earlier)
      path: state.path,
      seekCount,
    };
    const alertRule = getAlertRule(prevSnapshot.current, snapshot);
    prevSnapshot.current = snapshot;
    if (alertRule == undefined || alertsMuted) {
      return;
    }
    playAlertSound(alertRule.alertSound);
    if (alertRule.alertNotify === true) {
      showAlertNotification(config.path, alertRule.label, notificationTag);
    }
  }, [
    alertsMuted,
    config.path,
    matchingRule,
    notificationTag,
    rawValue,
    rules,
    seekCount,
    state.path,
  ]);

  const toggleMuted = useCallback(() => {
    setConfig((prev) => ({ ...prev, alertsMuted: prev.alertsMuted !== true }));
  }, []);

  const bulbColor = matchingRule?.color ?? fallbackColor ?? DEFAULT_FALLBACK_COLOR;
  const {
    classes,
    theme: {
      palette: { augmentColor },
    },
  } = useStyles({ style, backgroundColor: bulbColor });

  const label = matchingRule?.label ?? fallbackLabel;
  const textColor = useMemo(() => {
    return style === "background"
      ? augmentColor({ color: { main: bulbColor } }).contrastText
      : bulbColor;
  }, [style, bulbColor, augmentColor]);

  return (
    <ThemeProvider isDark={colorScheme === "dark"}>
      <Stack fullHeight position="relative">
        <Stack className={classes.indicatorStack}>
          {style === "bulb" && <Bulb label={label} bulbColor={bulbColor} />}
          {style === "background" && <Background label={label} textColor={textColor} />}
        </Stack>
        {rules.some(hasAlert) && (
          <PanelIconButton
            button={INDICATOR_BUTTONS.muteAlerts}
            className={classes.muteButton}
            onClick={toggleMuted}
            aria-pressed={alertsMuted}
          >
            {alertsMuted ? <VolumeOffIcon fontSize="small" /> : undefined}
          </PanelIconButton>
        )}
      </Stack>
    </ThemeProvider>
  );
}

const Bulb = memo(({ label, bulbColor }: { label: string; bulbColor: string }) => {
  const { classes } = useStyles({ backgroundColor: bulbColor });

  return (
    <Stack className={classes.stack}>
      <div className={classes.bulb} data-testid="bulb-indicator" />
      <Typography className={classes.typography}>{label}</Typography>
    </Stack>
  );
});
Bulb.displayName = "Bulb";

const Background = memo(({ label, textColor }: { label: string; textColor: string }) => {
  const { classes } = useStyles({});

  return (
    <Stack className={classes.stack} testId="background-indicator">
      <Typography className={classes.typography} style={{ color: textColor }}>
        {label}
      </Typography>
    </Stack>
  );
});
Background.displayName = "Background";
