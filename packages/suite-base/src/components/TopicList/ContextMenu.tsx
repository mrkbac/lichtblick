// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Divider,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  MenuItemProps,
  MenuProps,
  Typography,
} from "@mui/material";
import * as _ from "lodash-es";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import Log from "@lichtblick/log";
import { DraggedMessagePath } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { useSelectedPanels } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { PanelInfo, usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import { anyPanelAccepts } from "@lichtblick/suite-base/services/messagePathDragging/panelDropRegistry";
import clipboard from "@lichtblick/suite-base/util/clipboard";

import {
  getDefaultPanelType,
  getOpenInPanels,
  loadOpenInSchemas,
  useOpenMessagePathsInPanel,
} from "./useOpenMessagePathsInPanel";

const log = Log.getLogger(__filename);

const useStyles = makeStyles()((theme) => ({
  subheader: { lineHeight: 2.5, backgroundColor: "transparent" },
  hint: { marginLeft: theme.spacing(2) },
}));

export function ContextMenu(props: {
  messagePaths: DraggedMessagePath[];
  anchorPosition: NonNullable<MenuProps["anchorPosition"]>;
  onClose: () => void;
  /** Double-clicking the item opens the first "Open in" panel, so label it. */
  doubleClickOpens?: boolean;
}): React.JSX.Element {
  const { messagePaths, anchorPosition, onClose, doubleClickOpens = false } = props;
  const { t } = useTranslation("topicList");
  const { classes } = useStyles();
  const panelCatalog = usePanelCatalog();
  // Undefined until loaded; the menu opens then so focus starts on its first item
  const [openIn, setOpenIn] = useState<{ panels: readonly PanelInfo[]; defaultType: string }>();
  const openInPanel = useOpenMessagePathsInPanel();
  const { getSelectedPanelIds } = useSelectedPanels();
  // A double-click adds to the selected panel when it accepts the paths, not to a new one
  const [doubleClickTarget] = useState(
    () => doubleClickOpens && !anyPanelAccepts(getSelectedPanelIds(), messagePaths),
  );

  useEffect(() => {
    let cancelled = false;
    const panels = panelCatalog.getPanels();
    void loadOpenInSchemas(panels).then((schemas) => {
      if (!cancelled) {
        const offered = getOpenInPanels(panels, schemas, messagePaths);
        // The double-click default goes first
        const defaultType = getDefaultPanelType(offered);
        setOpenIn({
          panels: _.sortBy(offered, (panel) => (panel.type === defaultType ? 0 : 1)),
          defaultType,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [messagePaths, panelCatalog]);

  const menuItems = useMemo(() => {
    const hasNonTopicItems = messagePaths.some((item) => !item.isTopic);
    const items: MenuItemProps[] = [
      {
        children: hasNonTopicItems
          ? messagePaths.length === 1
            ? t("copyMessagePath")
            : t("copyMessagePaths")
          : messagePaths.length === 1
            ? t("copyTopicName")
            : t("copyTopicNames"),
        onClick: () => {
          onClose();
          clipboard
            .copy(messagePaths.map((item) => item.path).join("\n"))
            .catch((error: unknown) => {
              log.error("Failed to copy to clipboard", error);
            });
        },
      },
    ];
    if (messagePaths.length === 1 && messagePaths[0]?.isTopic === true) {
      items.push({
        children: t("copySchemaName"),
        onClick: () => {
          const schemaName = messagePaths[0]?.rootSchemaName;
          if (schemaName != undefined) {
            onClose();
            clipboard.copy(schemaName).catch((error: unknown) => {
              log.error("Failed to copy to clipboard", error);
            });
          }
        },
      });
    }
    return items;
  }, [t, onClose, messagePaths]);

  return (
    <Menu
      open={openIn != undefined}
      onClose={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        const root = event.currentTarget;
        const paper = root.querySelector(".MuiPaper-root");
        if (paper?.contains(event.target as Node) === true) {
          return;
        }
        // The backdrop covers the page: close, then hand the right-click to what is under it
        onClose();
        const target = document
          .elementsFromPoint(event.clientX, event.clientY)
          .find((element) => !root.contains(element));
        target?.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: event.clientX,
            clientY: event.clientY,
          }),
        );
      }}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition}
      slotProps={{
        list: {
          dense: true,
        },
      }}
    >
      {openIn != undefined &&
        openIn.panels.length > 0 && [
          <ListSubheader key="open-in-header" className={classes.subheader}>
            {t("openIn")}
          </ListSubheader>,
          ...openIn.panels.map((panel) => (
            <MenuItem
              key={panel.type}
              onClick={() => {
                onClose();
                void openInPanel(messagePaths, panel.type);
              }}
            >
              {panel.icon && (
                <ListItemIcon>
                  <panel.icon fontSize="small" />
                </ListItemIcon>
              )}
              <ListItemText>{panel.title}</ListItemText>
              {doubleClickTarget && panel.type === openIn.defaultType && (
                <Typography variant="caption" color="text.secondary" className={classes.hint}>
                  {t("doubleClick")}
                </Typography>
              )}
            </MenuItem>
          )),
          <Divider key="open-in-divider" />,
        ]}
      {menuItems.map((item, index) => (
        <MenuItem key={index} {...item} />
      ))}
    </Menu>
  );
}
