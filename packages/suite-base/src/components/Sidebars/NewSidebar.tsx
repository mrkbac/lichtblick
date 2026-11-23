// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import { Badge, Divider, IconButton, Tab, Tabs } from "@mui/material";
import { Suspense, lazy, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useStyles } from "@lichtblick/suite-base/components/Sidebars/NewSidebar.style";
import { NewSidebarProps } from "@lichtblick/suite-base/components/Sidebars/types";
import Stack from "@lichtblick/suite-base/components/Stack";

// Only shows when the tabs overflow: kept out of the startup bundle
const TabOverflowMenu = lazy(async () => ({
  default: (await import("@lichtblick/suite-base/components/TabOverflowMenu")).TabOverflowMenu,
}));

export function NewSidebar<K extends string>({
  items,
  anchor,
  onClose,
  activeTab,
  setActiveTab,
}: NewSidebarProps<K>): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("general");
  const tabsRef = useRef<HTMLDivElement>(null);

  const handleTabChange = useCallback(
    (_ev: React.SyntheticEvent, newValue: K) => {
      if (newValue !== activeTab) {
        setActiveTab(newValue);
      }
    },
    [activeTab, setActiveTab],
  );

  const Selected = activeTab != undefined ? items.get(activeTab)?.component : undefined;

  const memoizedTabs = useMemo(() => {
    return Array.from(items.entries(), ([key, item]) => (
      <Tab
        key={key}
        label={
          <Badge
            invisible={!item.badge}
            badgeContent={item.badge?.count}
            color={item.badge?.color}
            classes={{
              root: classes.badgeRoot,
              badge: classes.badge,
              invisible: classes.badgeInvisible,
            }}
          >
            {item.title}
          </Badge>
        }
        value={key}
        // The badge count is not part of the name
        aria-label={item.title}
        data-testid={`${key}-${anchor}`}
      />
    ));
  }, [items, classes.badgeRoot, classes.badge, classes.badgeInvisible, anchor]);

  return (
    <Stack
      className={cx(classes.root, {
        [classes.anchorLeft]: anchor === "left",
        [classes.anchorRight]: anchor === "right",
      })}
      flexShrink={0}
      overflow="hidden"
      data-tourid={`sidebar-${anchor}`}
      data-testid={`sidebar-${anchor}`}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Tabs
          slotProps={{ scroller: { ref: tabsRef } }}
          className={classes.tabs}
          textColor="inherit"
          // A narrow sidebar scrolls its tabs instead of cutting the last one off.
          variant="scrollable"
          scrollButtons={false}
          value={activeTab ?? false}
          onChange={handleTabChange}
        >
          {memoizedTabs}
        </Tabs>
        <Suspense fallback={undefined}>
          <TabOverflowMenu stripRef={tabsRef} className={classes.iconButton} />
        </Suspense>
        <IconButton
          className={classes.iconButton}
          aria-label={t("closeSidebar")}
          onClick={onClose}
          size="small"
          data-testid={`sidebar-close-${anchor}`}
        >
          <CloseIcon fontSize="inherit" />
        </IconButton>
      </Stack>
      <Divider />
      {activeTab != undefined && (
        <div className={classes.tabContent}>{Selected && <Selected />}</div>
      )}
    </Stack>
  );
}
