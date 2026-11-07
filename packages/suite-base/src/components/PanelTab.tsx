// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import AddIcon from "@mui/icons-material/Add";
import { IconButton, Popover } from "@mui/material";
import {
  DockviewApi,
  DockviewDefaultTab,
  DockviewGroupPanel,
  IDockviewHeaderActionsProps,
  IDockviewPanelHeaderProps,
  getPanelData,
} from "dockview-react";
import { DragEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { PanelCatalog, PanelSelection } from "@lichtblick/suite-base/components/PanelCatalog";
import {
  getPanelDragData,
  isPanelDrag,
} from "@lichtblick/suite-base/components/PanelCatalog/panelDrag";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { PANEL_TITLE_CONFIG_KEY, getPanelIdForType } from "@lichtblick/suite-base/util/layout";

/** How long a drag must rest on a background tab before the tab opens. */
export const TAB_HOVER_ACTIVATE_MS = 500;

/**
 * Drag handlers that call `activate` once a drag has stayed over the element for `delayMs`.
 * Leaving the element (not just moving between its children) or dropping cancels it.
 */
export function useDragHoverActivation(
  activate: () => void,
  delayMs = TAB_HOVER_ACTIVATE_MS,
): {
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: () => void;
} {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activateRef = useRef(activate);
  activateRef.current = activate;

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => cancel, [cancel]);

  const onDragEnter = useCallback(() => {
    timer.current ??= setTimeout(() => {
      timer.current = undefined;
      activateRef.current();
    }, delayMs);
  }, [delayMs]);

  const onDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        cancel();
      }
    },
    [cancel],
  );

  return { onDragEnter, onDragLeave, onDrop: cancel };
}

/** Whether `dataTransfer` carries a panel: one from the catalog, or a panel being moved. */
function isPanelBeingDragged(dataTransfer: DataTransfer | null | undefined, dockId: string) {
  return isPanelDrag(dataTransfer) || getPanelData()?.viewId === dockId;
}

// Whether a panel is being dragged anywhere. Data types are only readable once the drag has
// started, so this follows dragover instead of dragstart.
let panelDragActive = false;
const dragListeners = new Set<() => void>();
function notifyDragListeners() {
  dragListeners.forEach((listener) => {
    listener();
  });
}
function subscribeToPanelDrag(listener: () => void): () => void {
  if (dragListeners.size === 0) {
    document.addEventListener("dragover", onDocumentDragOver, true);
    document.addEventListener("dragend", onDocumentDragEnd, true);
    document.addEventListener("drop", onDocumentDrop, true);
  }
  dragListeners.add(listener);
  return () => {
    dragListeners.delete(listener);
    if (dragListeners.size === 0) {
      document.removeEventListener("dragover", onDocumentDragOver, true);
      document.removeEventListener("dragend", onDocumentDragEnd, true);
      document.removeEventListener("drop", onDocumentDrop, true);
    }
  };
}
function onDocumentDragOver(event: globalThis.DragEvent) {
  const active = isPanelDrag(event.dataTransfer) || getPanelData() != undefined;
  if (active !== panelDragActive) {
    panelDragActive = active;
    notifyDragListeners();
  }
}
// Reset only after the drop has reached its target: re-rendering now would unmount the "+ New tab"
// target before React delivers the drop to it.
function onDocumentDrop() {
  setTimeout(onDocumentDragEnd, 0);
}
function onDocumentDragEnd() {
  if (panelDragActive) {
    panelDragActive = false;
    notifyDragListeners();
  }
}

/** True while a panel (from the catalog or the layout) is being dragged. */
export function usePanelDragActive(): boolean {
  return useSyncExternalStore(subscribeToPanelDrag, () => panelDragActive);
}

/**
 * Drop handlers that put a dragged panel into `group` as a new tab: a panel from the catalog is
 * added, and a panel being moved goes there unless dockview already moved it.
 */
function useDropIntoGroup(
  group: DockviewGroupPanel,
  containerApi: DockviewApi,
): {
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
} {
  const { addPanel } = useCurrentLayoutActions();

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (isPanelBeingDragged(event.dataTransfer, containerApi.id)) {
        event.preventDefault();
      }
    },
    [containerApi],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      const targetPanelId = group.activePanel?.id ?? group.panels[0]?.id;
      const selection = getPanelDragData(event.dataTransfer);
      if (selection != undefined) {
        event.preventDefault();
        addPanel({
          id: getPanelIdForType(selection.type),
          config: selection.config,
          position: "center",
          targetPanelId,
        });
        return;
      }
      const data = getPanelData();
      const movedPanelId = data?.viewId === containerApi.id ? data.panelId : undefined;
      if (movedPanelId != undefined) {
        event.preventDefault();
        // Dockview moves panels dropped on its own header targets in most cases; move the panel
        // only when it didn't.
        setTimeout(() => {
          const panel = containerApi.getPanel(movedPanelId);
          if (panel != undefined && panel.group !== group) {
            panel.api.moveTo({ group, position: "center" });
          }
        }, 0);
      }
    },
    [addPanel, containerApi, group],
  );

  return { onDragOver, onDrop };
}

/** Inline editor for a tab's title. Saves on Enter or blur, cancels on Escape. */
function TabTitleInput({
  panelId,
  initialTitle,
  onDone,
}: {
  panelId: string;
  initialTitle: string;
  onDone: () => void;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { savePanelConfigs } = useCurrentLayoutActions();
  const doneRef = useRef(false);

  const finish = (title: string | undefined) => {
    if (doneRef.current) {
      return;
    }
    doneRef.current = true;
    if (title != undefined && title.trim() !== initialTitle) {
      // An empty title falls back to the panel type's title.
      savePanelConfigs({
        configs: [{ id: panelId, config: { [PANEL_TITLE_CONFIG_KEY]: title.trim() } }],
      });
    }
    onDone();
  };

  // The tab is a drag source; text selection inside the input must not start a tab drag.
  const tabRef = useCallback((input: HTMLInputElement | null) => {
    const tab = input?.closest<HTMLElement>(".dv-tab");
    if (!input || !tab) {
      return undefined;
    }
    input.select();
    tab.draggable = false;
    return () => {
      tab.draggable = true;
    };
  }, []);

  return (
    <input
      ref={tabRef}
      className={classes.titleInput}
      aria-label="Tab title"
      defaultValue={initialTitle}
      autoFocus
      size={Math.max(initialTitle.length, 4)}
      onBlur={(event) => {
        finish(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          finish(event.currentTarget.value);
        } else if (event.key === "Escape") {
          finish(undefined);
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    />
  );
}

/**
 * Tab of a panel in a stacked group. Double-click renames it. Resting a dragged panel on a
 * background tab opens it, so the panel can be dropped into that tab's area. Dropping on a tab
 * adds the panel to the tab's group: a panel from the catalog becomes a new tab, and a panel
 * dragged by its toolbar moves here.
 */
export function PanelTab(props: IDockviewPanelHeaderProps): React.JSX.Element {
  const { api, containerApi } = props;
  const [editing, setEditing] = useState(false);
  const activate = useCallback(() => {
    if (!api.isVisible) {
      api.setActive();
    }
  }, [api]);
  const { onDragEnter, onDragLeave, onDrop: cancelActivation } = useDragHoverActivation(activate);
  const { onDragOver, onDrop: dropIntoGroup } = useDropIntoGroup(api.group, containerApi);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      cancelActivation();
      dropIntoGroup(event);
    },
    [cancelActivation, dropIntoGroup],
  );

  if (editing) {
    return (
      <TabTitleInput
        panelId={api.id}
        initialTitle={api.title ?? ""}
        onDone={() => {
          setEditing(false);
        }}
      />
    );
  }
  return (
    <DockviewDefaultTab
      {...props}
      title="Double-click to rename"
      onDoubleClick={() => {
        setEditing(true);
      }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  );
}

const useStyles = makeStyles()((theme) => ({
  newTab: {
    display: "flex",
    alignItems: "center",
    height: "100%",
    padding: theme.spacing(0, 1),
    margin: theme.spacing(0, 0.5),
    border: `1px dashed ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    color: theme.palette.text.secondary,
    fontSize: theme.typography.caption.fontSize,
    whiteSpace: "nowrap",
    boxSizing: "border-box",
  },
  titleInput: {
    alignSelf: "center",
    margin: theme.spacing(0, 1),
    padding: theme.spacing(0, 0.5),
    font: "inherit",
    color: theme.palette.text.primary,
    background: theme.palette.background.paper,
    border: `1px solid ${theme.palette.primary.main}`,
    borderRadius: theme.shape.borderRadius,
    outline: "none",
  },
  newTabButton: {
    alignSelf: "center",
    margin: theme.spacing(0, 0.5),
    fontSize: theme.typography.body2.fontSize,
    color: theme.palette.text.secondary,
  },
  catalogPaper: {
    backgroundColor: theme.palette.background.menu,
    maxHeight: `calc(100vh - ${theme.spacing(12)})`,
  },
  newTabOver: {
    borderColor: theme.palette.primary.main,
    color: theme.palette.primary.main,
    backgroundColor: theme.palette.action.hover,
  },
}));

/** "+" after a group's tabs that opens the panel catalog and adds the chosen panel as a tab. */
function NewTabButton({ group }: { group: DockviewGroupPanel }): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("panelToolbar");
  const { addPanel } = useCurrentLayoutActions();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | undefined>(undefined);

  const onPanelSelect = useCallback(
    ({ type, config }: PanelSelection) => {
      setAnchorEl(undefined);
      addPanel({
        id: getPanelIdForType(type),
        config,
        position: "center",
        targetPanelId: group.activePanel?.id ?? group.panels[0]?.id,
      });
    },
    [addPanel, group],
  );

  return (
    <>
      <IconButton
        size="small"
        className={classes.newTabButton}
        title={t("addTab")}
        aria-label={t("addTab")}
        data-testid="new-tab-button"
        onClick={(event) => {
          setAnchorEl(event.currentTarget);
        }}
      >
        <AddIcon fontSize="inherit" />
      </IconButton>
      <Popover
        open={anchorEl != undefined}
        anchorEl={anchorEl}
        onClose={() => {
          setAnchorEl(undefined);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { className: classes.catalogPaper } }}
      >
        <PanelCatalog mode="list" isMenu onPanelSelect={onPanelSelect} />
      </Popover>
    </>
  );
}

/**
 * Header actions after a group's tabs: a "+" button to add a tab, which becomes a "+ New tab"
 * drop target while a panel is being dragged. Dropping on it adds the panel as a new tab.
 */
export function NewTabDropTarget({
  group,
  containerApi,
}: IDockviewHeaderActionsProps): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("panelToolbar");
  const dragActive = usePanelDragActive();
  const [isOver, setIsOver] = useState(false);
  const { onDragOver, onDrop } = useDropIntoGroup(group, containerApi);

  if (!dragActive) {
    return <NewTabButton group={group} />;
  }
  return (
    <div
      className={cx(classes.newTab, { [classes.newTabOver]: isOver })}
      data-testid="new-tab-drop-target"
      onDragEnter={() => {
        setIsOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOver(false);
        }
      }}
      onDragOver={onDragOver}
      onDrop={(event) => {
        setIsOver(false);
        onDrop(event);
      }}
    >
      {t("newTab")}
    </div>
  );
}
