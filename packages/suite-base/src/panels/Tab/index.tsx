// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import { ButtonBase } from "@mui/material";
import { getPanelData } from "dockview-react";
import { DragEvent, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import Panel from "@lichtblick/suite-base/components/Panel";
import { getPanelDragData } from "@lichtblick/suite-base/components/PanelCatalog/panelDrag";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import { UnconnectedPanelLayout } from "@lichtblick/suite-base/components/PanelLayout";
import {
  TabTitleInput,
  isPanelBeingDragged,
  useDragHoverActivation,
} from "@lichtblick/suite-base/components/PanelTab";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import ToolbarIconButton from "@lichtblick/suite-base/components/PanelToolbar/ToolbarIconButton";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { LayoutNode } from "@lichtblick/suite-base/types/layouts";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { getPanelIdForType } from "@lichtblick/suite-base/util/layout";
import {
  DEFAULT_TAB_PANEL_CONFIG,
  TAB_PANEL_TYPE,
  TabPanelConfig,
  getActiveTabIndex,
  getTabs,
} from "@lichtblick/suite-base/util/tabLayout";

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    flex: "auto",
    overflow: "hidden",
  },
  strip: {
    display: "flex",
    alignItems: "stretch",
    alignSelf: "stretch",
    flex: "auto",
    minWidth: 0,
    overflowX: "auto",
    scrollbarWidth: "none",
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
    padding: theme.spacing(0, 1),
    flex: "none",
    // Room for the title beside the close button, so clicking a short tab doesn't close it.
    minWidth: theme.spacing(8),
    maxWidth: 200,
    fontSize: theme.typography.body2.fontSize,
    color: theme.palette.text.secondary,
    borderBottom: "2px solid transparent",
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",

    "&:hover": { color: theme.palette.text.primary },
    "&:hover .close": { visibility: "visible" },
  },
  active: {
    color: theme.palette.text.primary,
    borderBottomColor: theme.palette.primary.main,
  },
  dropOver: {
    backgroundColor: theme.palette.action.hover,
  },
  title: {
    flex: "auto",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  close: {
    visibility: "hidden",
    borderRadius: theme.shape.borderRadius,
    fontSize: theme.typography.body2.fontSize,

    "&:hover": { backgroundColor: theme.palette.action.hover },
  },
  content: {
    position: "relative",
    flex: "auto",
    minHeight: 0,
    display: "flex",
  },
}));

type TabButtonProps = {
  title: string;
  isActive: boolean;
  closable: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onClose: () => void;
  onDropPanel: (event: DragEvent<HTMLElement>) => void;
};

/**
 * One tab of the Tab panel. Click shows it, double-click renames it. Resting a dragged panel on it
 * shows it, so the panel can be dropped into its layout; dropping on the tab itself adds the panel.
 */
function TabButton(props: TabButtonProps): React.JSX.Element {
  const { title, isActive, closable, onSelect, onRename, onClose, onDropPanel } = props;
  const { classes, cx } = useStyles();
  const [editing, setEditing] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const hover = useDragHoverActivation(onSelect);

  if (editing) {
    return (
      <TabTitleInput
        initialTitle={title}
        onSave={onRename}
        onDone={() => {
          setEditing(false);
        }}
      />
    );
  }
  return (
    <div
      role="tab"
      aria-selected={isActive}
      title="Double-click to rename"
      data-testid="tab-panel-tab"
      className={cx(classes.tab, { [classes.active]: isActive, [classes.dropOver]: isOver })}
      onClick={onSelect}
      onDoubleClick={() => {
        setEditing(true);
      }}
      onDragEnter={(event) => {
        setIsOver(true);
        hover.onDragEnter(event);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOver(false);
        }
        hover.onDragLeave(event);
      }}
      onDragOver={(event) => {
        if (isPanelBeingDragged(event.dataTransfer)) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        setIsOver(false);
        hover.onDrop();
        onDropPanel(event);
      }}
    >
      <span className={classes.title}>{title}</span>
      {closable && (
        <ButtonBase
          className={cx(classes.close, "close")}
          aria-label={`Close ${title}`}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <CloseIcon fontSize="inherit" />
        </ButtonBase>
      )}
    </div>
  );
}

type Props = { config: TabPanelConfig; saveConfig: SaveConfig<TabPanelConfig> };

/** Tabs that each hold a whole panel layout, which can be split like the root layout. */
function TabPanel({ config, saveConfig }: Props): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("panelToolbar");
  const { id: panelId } = usePanelContext();
  const { addPanel, changePanelLayout } = useCurrentLayoutActions();
  const tabs = getTabs(config);
  const activeIdx = getActiveTabIndex(config);
  const layout = tabs[activeIdx]?.layout;

  const select = useCallback(
    (index: number) => {
      if (index !== activeIdx) {
        saveConfig({ activeTabIdx: index });
      }
    },
    [activeIdx, saveConfig],
  );

  const rename = (index: number, title: string) => {
    saveConfig({ tabs: tabs.map((tab, i) => (i === index ? { ...tab, title } : tab)) });
  };

  const close = (index: number) => {
    // Closing a tab removes its panels; their configs go with it.
    saveConfig({
      tabs: tabs.filter((_tab, i) => i !== index),
      activeTabIdx: index < activeIdx || activeIdx === tabs.length - 1 ? activeIdx - 1 : activeIdx,
    });
  };

  const addTab = () => {
    saveConfig({ tabs: [...tabs, { title: `${tabs.length + 1}` }], activeTabIdx: tabs.length });
  };

  const dropPanel = (index: number, event: DragEvent<HTMLElement>) => {
    const selection = getPanelDragData(event.dataTransfer);
    const movedId = getPanelData()?.panelId ?? undefined;
    if (selection == undefined && movedId == undefined) {
      return;
    }
    event.preventDefault();
    // Show the tab first: panels without a target go into the shown tab.
    select(index);
    addPanel({
      id: selection ? getPanelIdForType(selection.type) : movedId!,
      config: selection?.config,
      position: "right",
      tabId: panelId,
    });
  };

  const onChange = useCallback(
    (newLayout: LayoutNode | undefined) => {
      changePanelLayout({ layout: newLayout, tab: { panelId, index: activeIdx } });
    },
    [activeIdx, changePanelLayout, panelId],
  );

  return (
    <div className={classes.root}>
      <PanelToolbar
        additionalIcons={
          <ToolbarIconButton title={t("addTab")} data-testid="add-tab" onClick={addTab}>
            <AddIcon />
          </ToolbarIconButton>
        }
      >
        <div className={classes.strip} role="tablist">
          {tabs.map((tab, index) => (
            <TabButton
              // Tabs have no ids; the index is their identity.
              key={index}
              title={tab.title}
              isActive={index === activeIdx}
              closable={tabs.length > 1}
              onSelect={() => {
                select(index);
              }}
              onRename={(title) => {
                rename(index, title);
              }}
              onClose={() => {
                close(index);
              }}
              onDropPanel={(event) => {
                dropPanel(index, event);
              }}
            />
          ))}
        </div>
      </PanelToolbar>
      <div className={classes.content}>
        {/* A fresh layout per tab, so a change can't land in the tab switched to meanwhile. */}
        <UnconnectedPanelLayout
          key={activeIdx}
          layout={layout}
          onChange={onChange}
          tabId={panelId}
        />
      </div>
    </div>
  );
}

TabPanel.panelType = TAB_PANEL_TYPE;
TabPanel.defaultConfig = DEFAULT_TAB_PANEL_CONFIG;

export default Panel(TabPanel);
