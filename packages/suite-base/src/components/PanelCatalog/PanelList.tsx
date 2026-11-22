// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { List, ListSubheader } from "@mui/material";
import { Fragment, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { PanelInfo } from "@lichtblick/suite-base/context/PanelCatalogContext";

import { PanelListItem } from "./PanelListItem";
import { PanelSelection } from "./types";

type Props = {
  filteredPanels: PanelInfo[];
  onPanelSelect: (arg0: PanelSelection) => void;
  onDragStart?: () => void;
  selectedPanelType?: string;
  highlightedPanelIdx?: number;
  searchQuery?: string;
  /** The first panels are suggested for the open data */
  suggestedCount?: number;
  topicCountsByPanelType?: ReadonlyMap<string, number>;
};

const useStyles = makeStyles()((theme) => ({
  subheader: {
    lineHeight: 2.5,
    backgroundColor: theme.palette.background.menu,
  },
}));

function blurActiveElement() {
  // Clear focus from the panel menu button so that spacebar doesn't trigger
  // more panel additions.
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

export function PanelList(props: Props): React.JSX.Element {
  const {
    filteredPanels,
    highlightedPanelIdx,
    onDragStart,
    onPanelSelect,
    selectedPanelType,
    searchQuery = "",
    suggestedCount = 0,
    topicCountsByPanelType,
  } = props;
  const { t } = useTranslation("addPanel");
  const { classes } = useStyles();

  const highlightedPanel = useMemo(() => {
    return highlightedPanelIdx != undefined ? filteredPanels[highlightedPanelIdx] : undefined;
  }, [filteredPanels, highlightedPanelIdx]);

  const displayPanelListItem = useCallback(
    (panelInfo: PanelInfo) => {
      const { title, type, config } = panelInfo;
      return (
        <PanelListItem
          key={`${type}-${title}`}
          panel={panelInfo}
          onDragStart={onDragStart}
          onClick={() => {
            onPanelSelect({ type, config });
            blurActiveElement();
          }}
          checked={type === selectedPanelType}
          highlighted={highlightedPanel?.title === title}
          searchQuery={searchQuery}
          topicCount={topicCountsByPanelType?.get(type)}
        />
      );
    },
    [
      highlightedPanel?.title,
      onDragStart,
      onPanelSelect,
      searchQuery,
      selectedPanelType,
      topicCountsByPanelType,
    ],
  );

  return (
    <List dense disablePadding>
      {filteredPanels.map((panel, index) => (
        <Fragment key={`${panel.type}-${panel.title}`}>
          {suggestedCount > 0 && index === 0 && (
            <ListSubheader className={classes.subheader}>{t("suggestedForThisData")}</ListSubheader>
          )}
          {suggestedCount > 0 && index === suggestedCount && (
            <ListSubheader className={classes.subheader}>{t("allPanels")}</ListSubheader>
          )}
          {displayPanelListItem(panel)}
        </Fragment>
      ))}
    </List>
  );
}
