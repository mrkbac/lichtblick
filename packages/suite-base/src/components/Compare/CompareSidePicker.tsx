// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import CheckIcon from "@mui/icons-material/Check";
import {
  ButtonBase,
  Divider,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
} from "@mui/material";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { APP_SHORTCUTS } from "@lichtblick/suite-base/components/KeyboardShortcuts/appShortcuts";
import PanelContext from "@lichtblick/suite-base/components/PanelContext";
import { shortcutLabel } from "@lichtblick/suite-base/util/keyboardShortcuts";

import { useCompare } from "./CompareContext";
import {
  COMPARE_VIEW_CONFIG_KEY,
  CompareLayout,
  CompareView,
  compareSupport,
  resolveCompareView,
} from "./compareView";

const useStyles = makeStyles()((theme) => ({
  button: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    height: 20,
    padding: theme.spacing(0, 0.5),
    marginRight: theme.spacing(0.5),
    borderRadius: theme.shape.borderRadius,
    border: `1px solid ${theme.palette.divider}`,
    fontSize: theme.typography.caption.fontSize,
    fontWeight: 600,
    color: theme.palette.text.secondary,
    "&:hover": { backgroundColor: theme.palette.action.hover },
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 2,
    color: "#000",
    fontSize: 8,
    lineHeight: "10px",
    textAlign: "center",
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 3,
    color: "#000",
    fontSize: 10,
    fontWeight: 700,
    lineHeight: "14px",
    textAlign: "center",
  },
}));

const LAYOUTS: readonly CompareLayout[] = ["split", "swipe", "blend", "difference"];

/** Panel toolbar control choosing which compared recording(s) a panel shows */
export function CompareSidePicker(): React.JSX.Element | undefined {
  const { classes } = useStyles();
  const { t } = useTranslation("compare");
  const compare = useCompare();
  const panel = useContext(PanelContext);
  const [anchor, setAnchor] = useState<HTMLElement | undefined>(undefined);

  if (!compare || !panel) {
    return undefined;
  }
  const support = compareSupport(panel.type, panel.config);
  if (support.mode === "none") {
    return undefined;
  }
  const view = panel.config[COMPARE_VIEW_CONFIG_KEY] as CompareView | undefined;
  const resolved = resolveCompareView(view, support, compare);
  const shown = resolved.kind === "side" ? [resolved.side] : compare.sides;
  const choose = (next: CompareView) => {
    panel.saveConfig({ [COMPARE_VIEW_CONFIG_KEY]: { ...view, ...next } });
    setAnchor(undefined);
  };
  const isFollowing = resolved.kind === "side" && resolved.followed;
  const followed = compare.sides.find((side) => side.prefix === compare.activeSide);

  return (
    <>
      <ButtonBase
        className={classes.button}
        title={t("showRecordings")}
        onClick={(event) => {
          setAnchor(event.currentTarget);
        }}
        data-testid="compare-side-picker"
      >
        {shown.map((side) => (
          <span key={side.prefix} className={classes.dot} style={{ backgroundColor: side.color }}>
            {side.label}
          </span>
        ))}
        {isFollowing && <span>{t("followShort")}</span>}
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={anchor != undefined}
        onClose={() => {
          setAnchor(undefined);
        }}
        slotProps={{ list: { dense: true } }}
      >
        <ListSubheader>{t("show")}</ListSubheader>
        <MenuItem
          selected={isFollowing}
          onClick={() => {
            choose({ show: "follow" });
          }}
        >
          <ListItemIcon>{isFollowing && <CheckIcon fontSize="small" />}</ListItemIcon>
          <ListItemText
            primary={t("followLayout", { side: followed?.label ?? "" })}
            secondary={t("followHint", {
              key: shortcutLabel(APP_SHORTCUTS, "app.nextCompareSide"),
            })}
          />
        </MenuItem>
        {compare.sides.map((side) => {
          const selected = resolved.kind === "side" && !resolved.followed && resolved.side === side;
          return (
            <MenuItem
              key={side.prefix}
              selected={selected}
              onClick={() => {
                choose({ show: side.prefix });
              }}
            >
              <ListItemIcon>
                <span className={classes.swatch} style={{ backgroundColor: side.color }}>
                  {side.label}
                </span>
              </ListItemIcon>
              <ListItemText primary={side.name} />
              {selected && <CheckIcon fontSize="small" />}
            </MenuItem>
          );
        })}
        <MenuItem
          selected={resolved.kind === "all" && support.mode === "native"}
          onClick={() => {
            choose({ show: "all" });
          }}
        >
          <ListItemIcon>{resolved.kind === "all" && <CheckIcon fontSize="small" />}</ListItemIcon>
          <ListItemText
            primary={t("allSides")}
            secondary={support.mode === "native" ? t("allSidesNative") : undefined}
          />
        </MenuItem>
        {support.mode === "copies" && [
          <Divider key="divider" />,
          <ListSubheader key="layout">{t("layout")}</ListSubheader>,
          ...LAYOUTS.filter((layout) => layout === "split" || support.overlay).map((layout) => {
            const selected = resolved.kind === "all" && resolved.layout === layout;
            return (
              <MenuItem
                key={layout}
                selected={selected}
                onClick={() => {
                  choose({ show: "all", layout });
                }}
              >
                <ListItemIcon>{selected && <CheckIcon fontSize="small" />}</ListItemIcon>
                <ListItemText
                  primary={t(`layout_${layout}`)}
                  secondary={t(`layoutHint_${layout}`)}
                />
              </MenuItem>
            );
          }),
        ]}
      </Menu>
    </>
  );
}
