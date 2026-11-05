// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { List } from "@mui/material";
import { useCallback, useMemo } from "react";

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
};

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
  } = props;

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
        />
      );
    },
    [highlightedPanel?.title, onDragStart, onPanelSelect, searchQuery, selectedPanelType],
  );

  return (
    <List dense disablePadding>
      {filteredPanels.map(displayPanelListItem)}
    </List>
  );
}
