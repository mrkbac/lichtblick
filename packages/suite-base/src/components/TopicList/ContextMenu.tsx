// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Menu, MenuItem, MenuItemProps, MenuProps } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Log from "@lichtblick/log";
import { DraggedMessagePath } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import clipboard from "@lichtblick/suite-base/util/clipboard";

const log = Log.getLogger(__filename);

export function ContextMenu(props: {
  messagePaths: DraggedMessagePath[];
  anchorPosition: NonNullable<MenuProps["anchorPosition"]>;
  onClose: () => void;
}): React.JSX.Element {
  const { messagePaths, anchorPosition, onClose } = props;
  const { t } = useTranslation("topicList");

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
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition}
      slotProps={{
        list: {
          dense: true,
        },
      }}
    >
      {menuItems.map((item, index) => (
        <MenuItem key={index} {...item} />
      ))}
    </Menu>
  );
}
