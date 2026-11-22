// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CancelIcon from "@mui/icons-material/Cancel";
import SearchIcon from "@mui/icons-material/Search";
import { IconButton, InputAdornment, TextField } from "@mui/material";
import { Fzf } from "fzf";
import * as _ from "lodash-es";
import { Ref, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import Stack from "@lichtblick/suite-base/components/Stack";
import { loadOpenInSchemas } from "@lichtblick/suite-base/components/TopicList/useOpenMessagePathsInPanel";
import { PanelInfo, usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import { Topic } from "@lichtblick/suite-base/players/types";
import { mightActuallyBePartial } from "@lichtblick/suite-base/util/mightActuallyBePartial";

import { PanelGrid } from "./PanelGrid";
import { PanelList } from "./PanelList";
import { PanelSelection } from "./types";

const useStyles = makeStyles()((theme) => {
  const { spacing, palette } = theme;
  return {
    toolbar: {
      position: "sticky",
      top: -0.5, // yep that's a half pixel to avoid a gap between the appbar and panel top
      zIndex: 100,
      display: "flex",
      justifyContent: "stretch",
      padding: theme.spacing(1.5),
      backgroundImage: `linear-gradient(to top, transparent, ${palette.background.paper} ${spacing(
        1.5,
      )}) !important`,
    },
    toolbarMenu: {
      backgroundImage: `linear-gradient(to top, transparent, ${palette.background.menu} ${spacing(
        1.5,
      )}) !important`,
    },
    toolbarGrid: {
      padding: theme.spacing(2),
    },
  };
});

// sanity checks to help panel authors debug issues
function verifyPanels(panels: readonly PanelInfo[]): void {
  const panelTypes = new Map<string, PanelInfo>();
  for (const panel of panels) {
    const { title, type, config } = mightActuallyBePartial(panel);
    const dispName = title ?? type ?? "<unnamed>";
    if (type == undefined || type.length === 0) {
      throw new Error(`Panel component ${title} must declare a unique \`static panelType\``);
    }
    const existingPanel = mightActuallyBePartial(panelTypes.get(type));
    if (existingPanel) {
      const bothHaveEmptyConfigs = _.isEmpty(existingPanel.config) && _.isEmpty(config);
      if (bothHaveEmptyConfigs) {
        const otherDisplayName = existingPanel.title ?? existingPanel.type ?? "<unnamed>";
        throw new Error(
          `Two components have the same panelType ('${type}') and no preset configs: ${otherDisplayName} and ${dispName}`,
        );
      }
    }
    panelTypes.set(type, panel);
  }
}

const MAX_SUGGESTIONS = 8;

/** How many of `topics` each panel can show, by panel type, from the schemas in the panels' docs. */
function useTopicCountsByPanelType(
  topics: readonly Topic[] | undefined,
): ReadonlyMap<string, number> {
  const panelCatalog = usePanelCatalog();
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    if (topics == undefined || topics.length === 0) {
      setCounts(new Map());
      return;
    }
    let cancelled = false;
    void loadOpenInSchemas(panelCatalog.getPanels()).then((schemasByType) => {
      if (cancelled) {
        return;
      }
      const newCounts = new Map<string, number>();
      for (const [type, schemas] of schemasByType) {
        let count = 0;
        for (const topic of topics) {
          if (topic.schemaName != undefined && schemas.has(topic.schemaName)) {
            count++;
          }
        }
        if (count > 0) {
          newCounts.set(type, count);
        }
      }
      setCounts(newCounts);
    });
    return () => {
      cancelled = true;
    };
  }, [panelCatalog, topics]);
  return counts;
}

type Props = {
  onPanelSelect: (arg0: PanelSelection) => void;
  onDragStart?: () => void;
  selectedPanelType?: string;
  mode?: "grid" | "list";
  isMenu?: boolean;
  ref?: Ref<HTMLDivElement>;
  /** Topics of the open data; panels that can show them are suggested first. */
  topics?: readonly Topic[];
};

export function PanelCatalog(props: Props): React.JSX.Element {
  const {
    isMenu = false,
    onDragStart,
    onPanelSelect,
    selectedPanelType,
    mode = "list",
    ref,
    topics,
  } = props;
  const { classes, cx } = useStyles();
  const { t } = useTranslation("addPanel");

  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedPanelIdx, setHighlightedPanelIdx] = useState<number | undefined>();

  // Not `autoFocus`: a surrounding MUI Menu focuses its list in a layout effect right after mount,
  // which takes focus back from the field. A passive effect runs after that.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const query = event.target.value;
    setSearchQuery(query);

    // When there is a search query, automatically highlight the first (0th) item.
    // When the user erases the query, remove the highlight.
    setHighlightedPanelIdx(query ? 0 : undefined);
  }, []);

  const panelCatalog = usePanelCatalog();

  const namespacedPanels = useMemo(() => {
    // Remove namespace if panel title is unique.
    const panels = panelCatalog.getPanels().filter((panel) => panel.hidden !== true);
    const countByTitle = _.countBy(panels, (panel) => panel.title);
    return panels.map((panel) => {
      if ((countByTitle[panel.title] ?? 0) > 1) {
        return panel;
      } else {
        return { ...panel, namespace: undefined };
      }
    });
  }, [panelCatalog]);

  // The list shows thumbnails only in a hover tooltip; fetch them now so the first hover isn't blank.
  useEffect(() => {
    for (const panel of namespacedPanels) {
      if (panel.thumbnail != undefined) {
        new Image().src = panel.thumbnail;
      }
    }
  }, [namespacedPanels]);

  const { allRegularPanels, allPreconfiguredPanels } = useMemo(() => {
    const panels = namespacedPanels;
    const regular = panels.filter((panel) => !panel.config);
    const preconfigured = panels.filter((panel) => panel.config);
    const sortByTitle = (a: PanelInfo, b: PanelInfo) =>
      a.title.localeCompare(b.title, undefined, { ignorePunctuation: true, sensitivity: "base" });

    return {
      allRegularPanels: [...regular].sort(sortByTitle),
      allPreconfiguredPanels: [...preconfigured].sort(sortByTitle),
    };
  }, [namespacedPanels]);

  useEffect(() => {
    verifyPanels([...allRegularPanels, ...allPreconfiguredPanels]);
  }, [allRegularPanels, allPreconfiguredPanels]);

  const getFilteredPanels = useCallback(
    (panels: PanelInfo[]) => {
      if (searchQuery.length === 0) {
        return panels;
      }
      // Title matches rank above description-only matches
      const byTitle = new Fzf(panels, {
        selector: (panel) => panel.title,
        casing: "case-insensitive",
      }).find(searchQuery);
      const byDescription = new Fzf(panels, {
        selector: (panel) => panel.description ?? "",
        casing: "case-insensitive",
      }).find(searchQuery);
      return [...new Set([...byTitle, ...byDescription].map((result) => result.item))];
    },
    [searchQuery],
  );

  const { filteredRegularPanels, filteredPreconfiguredPanels } = useMemo(
    () => ({
      filteredRegularPanels: getFilteredPanels(allRegularPanels),
      filteredPreconfiguredPanels: getFilteredPanels(allPreconfiguredPanels),
    }),
    [getFilteredPanels, allRegularPanels, allPreconfiguredPanels],
  );

  // Without a search, panels for the open data's schemas come first, most topics first
  const topicCountsByPanelType = useTopicCountsByPanelType(topics);
  const suggestedPanels = useMemo(
    () =>
      searchQuery.length > 0
        ? []
        : _.sortBy(
            allRegularPanels.filter((panel) => topicCountsByPanelType.has(panel.type)),
            (panel) => -(topicCountsByPanelType.get(panel.type) ?? 0),
          ).slice(0, MAX_SUGGESTIONS),
    [allRegularPanels, searchQuery, topicCountsByPanelType],
  );

  const allFilteredPanels = useMemo(
    () => [
      ...suggestedPanels,
      ...filteredPreconfiguredPanels,
      ...filteredRegularPanels.filter((panel) => !suggestedPanels.includes(panel)),
    ],
    [filteredPreconfiguredPanels, filteredRegularPanels, suggestedPanels],
  );

  const highlightedPanel = useMemo(() => {
    return highlightedPanelIdx != undefined ? allFilteredPanels[highlightedPanelIdx] : undefined;
  }, [allFilteredPanels, highlightedPanelIdx]);

  const noResults = allFilteredPanels.length === 0;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Prevent key down events from triggering the parent menu, if any.
      if (e.key !== "Escape") {
        e.stopPropagation();
      }

      if (mode === "grid") {
        return;
      }

      if (e.key === "ArrowDown") {
        setHighlightedPanelIdx((existing) => {
          if (existing == undefined) {
            return 0;
          }
          return (existing + 1) % allFilteredPanels.length;
        });
      } else if (e.key === "ArrowUp") {
        setHighlightedPanelIdx((existing) => {
          // nothing to highlight if there are no entries
          if (allFilteredPanels.length <= 0) {
            return undefined;
          }

          if (existing == undefined) {
            return allFilteredPanels.length - 1;
          }
          return (existing - 1 + allFilteredPanels.length) % allFilteredPanels.length;
        });
      } else if (e.key === "Enter" && highlightedPanel) {
        onPanelSelect({
          type: highlightedPanel.type,
          config: highlightedPanel.config,
        });
      }
    },
    [allFilteredPanels.length, highlightedPanel, mode, onPanelSelect],
  );

  return (
    <Stack fullHeight ref={ref}>
      <div
        className={cx(classes.toolbar, {
          [classes.toolbarMenu]: isMenu,
          [classes.toolbarGrid]: mode === "grid",
        })}
      >
        <TextField
          fullWidth
          variant="filled"
          placeholder={t("searchPanels")}
          value={searchQuery}
          onChange={handleSearchChange}
          onKeyDown={onKeyDown}
          inputRef={searchInputRef}
          data-testid="panel-list-textfield"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: searchQuery && (
                <IconButton
                  size="small"
                  edge="end"
                  onClick={() => {
                    setSearchQuery("");
                  }}
                >
                  <CancelIcon fontSize="small" />
                </IconButton>
              ),
            },
          }}
        />
      </div>
      {mode === "grid" ? (
        <PanelGrid
          searchQuery={searchQuery}
          filteredPanels={allFilteredPanels}
          onPanelSelect={onPanelSelect}
        />
      ) : (
        <PanelList
          searchQuery={searchQuery}
          filteredPanels={allFilteredPanels}
          selectedPanelType={selectedPanelType}
          highlightedPanelIdx={highlightedPanelIdx}
          suggestedCount={suggestedPanels.length}
          topicCountsByPanelType={topicCountsByPanelType}
          onDragStart={onDragStart}
          onPanelSelect={onPanelSelect}
        />
      )}
      {noResults && (
        <Stack padding={2}>
          <EmptyState>{t("noPanelsMatchSearchCriteria")}</EmptyState>
        </Stack>
      )}
    </Stack>
  );
}
