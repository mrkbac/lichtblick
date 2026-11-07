// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { getPanelData } from "dockview-react";
import { DragEvent, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { isPanelDrag } from "@lichtblick/suite-base/components/PanelCatalog/panelDrag";

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

/**
 * Whether `dataTransfer` carries a panel: one from the catalog, or a panel being moved (also one
 * from another layout, such as the root layout and the layout in a tab of a Tab panel).
 */
export function isPanelBeingDragged(dataTransfer: DataTransfer | null | undefined): boolean {
  return isPanelDrag(dataTransfer) || getPanelData()?.panelId != undefined;
}

/** The panel being moved from another dockview (e.g. from the root layout into a tab), if any. */
export function getForeignPanelId(dockId: string): string | undefined {
  const data = getPanelData();
  return data?.viewId !== dockId ? (data?.panelId ?? undefined) : undefined;
}

/**
 * Inline editor for a tab's title. Enter or blur calls `onSave` with the trimmed title when it
 * changed; Escape cancels. `onDone` is called either way.
 */
export function TabTitleInput({
  initialTitle,
  onSave,
  onDone,
}: {
  initialTitle: string;
  onSave: (title: string) => void;
  onDone: () => void;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("panelToolbar");
  const doneRef = useRef(false);

  const finish = (title: string | undefined) => {
    if (doneRef.current) {
      return;
    }
    doneRef.current = true;
    if (title != undefined && title.trim() !== initialTitle) {
      onSave(title.trim());
    }
    onDone();
  };

  // The tab is a drag source; text selection inside the input must not start a tab drag.
  const tabRef = useCallback((input: HTMLInputElement | null) => {
    const tab = input?.closest<HTMLElement>(".dv-tab");
    if (!tab) {
      return undefined;
    }
    tab.draggable = false;
    return () => {
      tab.draggable = true;
    };
  }, []);

  return (
    <input
      ref={tabRef}
      className={classes.titleInput}
      aria-label={t("tabTitle")}
      defaultValue={initialTitle}
      autoFocus
      onFocus={(event) => {
        event.currentTarget.select();
      }}
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

const useStyles = makeStyles()((theme) => ({
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
}));
