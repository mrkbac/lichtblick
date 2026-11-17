// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import ViewAgendaOutlinedIcon from "@mui/icons-material/ViewAgendaOutlined";
import ViewColumnOutlinedIcon from "@mui/icons-material/ViewColumnOutlined";
import ViewModuleOutlinedIcon from "@mui/icons-material/ViewModuleOutlined";
import { ButtonBase, Popover } from "@mui/material";
import { getPanelData } from "dockview-react";
import {
  CSSProperties,
  DragEvent,
  PointerEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { SettingsTreeAction } from "@lichtblick/suite";
import { PanelVisibleContext } from "@lichtblick/suite-base/components/DockPanelContext";
import Panel from "@lichtblick/suite-base/components/Panel";
import { PanelIconButton } from "@lichtblick/suite-base/components/PanelButton";
import { PanelCatalog, PanelSelection } from "@lichtblick/suite-base/components/PanelCatalog";
import { getPanelDragData } from "@lichtblick/suite-base/components/PanelCatalog/panelDrag";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import { UnconnectedPanelLayout } from "@lichtblick/suite-base/components/PanelLayout";
import { isPanelBeingDragged } from "@lichtblick/suite-base/components/PanelTab";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { LayoutNode } from "@lichtblick/suite-base/types/layouts";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { getPanelIdForType } from "@lichtblick/suite-base/util/layout";
import { getPanelIds } from "@lichtblick/suite-base/util/layoutTree";
import { STACK_PANEL_TYPE, TabConfig, getTabs } from "@lichtblick/suite-base/util/tabLayout";

import { STACK_BUTTONS } from "./buttons";
import {
  ARRANGEMENTS,
  Arrangement,
  DEFAULT_STACK_CONFIG,
  MIN_ITEM_SIZE,
  StackPanelConfig,
  buildSettingsTree,
  normalizeStackConfig,
} from "./settings";

const ARRANGEMENT_ICONS = {
  vertical: ViewAgendaOutlinedIcon,
  horizontal: ViewColumnOutlinedIcon,
  grid: ViewModuleOutlinedIcon,
} as const;

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    flex: "auto",
    overflow: "hidden",
  },
  scroller: {
    position: "relative",
    flex: "auto",
    minHeight: 0,
    overflow: "auto",
  },
  track: {
    display: "flex",
    gap: theme.spacing(0.5),
    minWidth: "100%",
    minHeight: "100%",
  },
  horizontal: {
    flexDirection: "row",
    height: "100%",
    minHeight: 0,
  },
  vertical: { flexDirection: "column" },
  grid: {
    display: "grid",
    flex: "1 0 auto",
    gap: theme.spacing(0.5),
  },
  item: {
    position: "relative",
    display: "flex",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  handle: {
    position: "absolute",
    zIndex: 1,
    touchAction: "none",
    "&:hover, &:active": { backgroundColor: theme.palette.primary.main },
  },
  handleY: { left: 0, right: 0, bottom: 0, height: 5, cursor: "row-resize" },
  handleX: { top: 0, bottom: 0, right: 0, width: 5, cursor: "col-resize" },
  dropZone: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    padding: theme.spacing(1),
    border: `1px dashed ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    color: theme.palette.text.secondary,
    fontSize: theme.typography.body2.fontSize,
    textAlign: "center",
    "&:hover": { color: theme.palette.text.primary },
  },
  dropZoneY: { minHeight: 48 },
  dropZoneX: { width: 120 },
  dropZoneEmpty: { flex: "auto" },
  dropOver: {
    borderColor: theme.palette.primary.main,
    backgroundColor: theme.palette.action.hover,
  },
}));

/** Whether `element` is scrolled into view of `root`; true until known. */
function useInView(element: HTMLElement | null, root: HTMLElement | null): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    if (element == undefined || root == undefined) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setInView(entries[entries.length - 1]?.isIntersecting ?? true);
      },
      { root },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element, root]);
  return inView;
}

type ItemProps = {
  stackId: string;
  index: number;
  layout: LayoutNode | undefined;
  style: CSSProperties;
  scroller: HTMLElement | null;
  /** Which edge resizes the item. */
  axis: "x" | "y";
  /** While dragging an edge. */
  onResizing: (index: number, size: number) => void;
  /** When the drag ends. */
  onResized: (index: number, size: number) => void;
};

/** One item: a layout of its own, saved to its entry in the Stack panel's config. */
function StackItem(props: ItemProps): React.JSX.Element {
  const { stackId, index, layout, style, scroller, axis, onResizing, onResized } = props;
  const { classes, cx } = useStyles();
  const { t } = useTranslation("stack");
  const { changePanelLayout } = useCurrentLayoutActions();
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const inView = useInView(element, scroller);
  const visible = useContext(PanelVisibleContext);

  const onChange = useCallback(
    (newLayout: LayoutNode | undefined) => {
      changePanelLayout({ layout: newLayout, tab: { panelId: stackId, index } });
    },
    [changePanelLayout, index, stackId],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (element == undefined || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const rect = element.getBoundingClientRect();
    const startSize = axis === "y" ? rect.height : rect.width;
    const start = axis === "y" ? event.clientY : event.clientX;
    let size = startSize;
    const move = (moveEvent: globalThis.PointerEvent) => {
      const at = axis === "y" ? moveEvent.clientY : moveEvent.clientX;
      size = Math.max(MIN_ITEM_SIZE, Math.round(startSize + at - start));
      onResizing(index, size);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      onResized(index, size);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return (
    <div ref={setElement} className={classes.item} style={style} data-testid="stack-item">
      <PanelVisibleContext.Provider value={visible && inView}>
        <UnconnectedPanelLayout
          layout={layout}
          onChange={onChange}
          tabId={stackId}
          tabIndex={index}
        />
      </PanelVisibleContext.Provider>
      <div
        className={cx(classes.handle, axis === "y" ? classes.handleY : classes.handleX)}
        title={t("resize")}
        onPointerDown={onPointerDown}
      />
    </div>
  );
}

type Props = { config: StackPanelConfig; saveConfig: SaveConfig<StackPanelConfig> };

/**
 * Panels stacked in a scrolling list, row or grid. Each item holds a layout, so it can be split
 * or hold tabs. Items are at least the configured size and grow to fill the panel when they fit.
 */
function StackPanel({ config, saveConfig }: Props): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("stack");
  const { id: panelId } = usePanelContext();
  const { addPanel } = useCurrentLayoutActions();
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const [catalogAnchor, setCatalogAnchor] = useState<HTMLElement | undefined>(undefined);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [isOver, setIsOver] = useState(false);
  // The size being dragged, shown before it is saved.
  const [draft, setDraft] = useState<{ index: number; size: number } | undefined>(undefined);

  const rawTabs = config.tabs;
  const tabs = useMemo(() => getTabs({ tabs: rawTabs }), [rawTabs]);
  const { arrangement, size, columns } = normalizeStackConfig(config);
  const horizontal = arrangement === "horizontal";

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action !== "update") {
        return;
      }
      const { path, value } = action.payload;
      if (path[1] === "arrangement" && ARRANGEMENTS.includes(value as Arrangement)) {
        saveConfig({ arrangement: value as Arrangement });
      } else if (path[1] === "size" && typeof value === "number") {
        saveConfig({ size: Math.max(MIN_ITEM_SIZE, value) });
      } else if (path[1] === "columns" && typeof value === "number") {
        saveConfig({ columns: Math.max(1, Math.floor(value)) });
      }
    },
    [saveConfig],
  );
  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildSettingsTree({ arrangement, size, columns }, t),
    });
  }, [actionHandler, arrangement, columns, size, t, updatePanelSettingsTree]);

  // Show a newly added item.
  const countRef = useRef(tabs.length);
  useEffect(() => {
    if (tabs.length > countRef.current) {
      scroller?.scrollTo({
        top: scroller.scrollHeight,
        left: scroller.scrollWidth,
        behavior: "smooth",
      });
    }
    countRef.current = tabs.length;
  }, [scroller, tabs.length]);

  const onResizing = useCallback((index: number, newSize: number) => {
    setDraft({ index, size: newSize });
  }, []);
  const onResized = useCallback(
    (index: number, newSize: number) => {
      setDraft(undefined);
      if (arrangement === "grid") {
        // A grid's rows share one height.
        saveConfig({ size: newSize });
      } else {
        saveConfig({
          tabs: tabs.map((tab, i): TabConfig => (i === index ? { ...tab, size: newSize } : tab)),
        });
      }
    },
    [arrangement, saveConfig, tabs],
  );

  const append = (id: string, panelConfig?: Record<string, unknown>) => {
    addPanel({ id, config: panelConfig, tabId: panelId, tabIndex: tabs.length });
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    setIsOver(false);
    const selection = getPanelDragData(event.dataTransfer);
    const id = selection ? getPanelIdForType(selection.type) : getPanelData()?.panelId;
    if (id == undefined) {
      return;
    }
    event.preventDefault();
    append(id, selection?.config);
  };

  const addFromCatalog = ({ type, config: panelConfig }: PanelSelection) => {
    setCatalogAnchor(undefined);
    append(getPanelIdForType(type), panelConfig);
  };

  const itemStyle = (tab: TabConfig, index: number): CSSProperties => {
    if (arrangement === "grid") {
      return {};
    }
    const explicit = draft?.index === index ? draft.size : tab.size;
    // Items without a size of their own grow to fill the panel.
    return { flex: explicit != undefined ? `0 0 ${explicit}px` : `1 0 ${size}px` };
  };

  const items = tabs.map((tab, index) => (
    <StackItem
      // Items have no ids; their first panel is stable while items are added or removed.
      key={getPanelIds(tab.layout)[0] ?? index}
      stackId={panelId}
      index={index}
      layout={tab.layout}
      style={itemStyle(tab, index)}
      scroller={scroller}
      axis={horizontal ? "x" : "y"}
      onResizing={onResizing}
      onResized={onResized}
    />
  ));

  const ArrangementIcon = ARRANGEMENT_ICONS[arrangement];
  const rowSize = arrangement === "grid" && draft != undefined ? draft.size : size;

  return (
    <div className={classes.root}>
      <PanelToolbar
        additionalIcons={
          <>
            <PanelIconButton
              button={STACK_BUTTONS.layout}
              data-testid="stack-arrangement"
              onClick={() => {
                const next = ARRANGEMENTS[(ARRANGEMENTS.indexOf(arrangement) + 1) % 3]!;
                saveConfig({ arrangement: next });
              }}
            >
              <ArrangementIcon />
            </PanelIconButton>
            <PanelIconButton
              button={STACK_BUTTONS.add}
              data-testid="stack-add"
              onClick={(event) => {
                setCatalogAnchor(event.currentTarget);
              }}
            />
          </>
        }
      />
      <Popover
        open={catalogAnchor != undefined}
        anchorEl={catalogAnchor}
        onClose={() => {
          setCatalogAnchor(undefined);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <PanelCatalog mode="list" isMenu onPanelSelect={addFromCatalog} />
      </Popover>
      <div ref={setScroller} className={classes.scroller}>
        <div className={cx(classes.track, horizontal ? classes.horizontal : classes.vertical)}>
          {arrangement === "grid"
            ? tabs.length > 0 && (
                <div
                  className={classes.grid}
                  style={{
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gridAutoRows: `minmax(${rowSize}px, 1fr)`,
                  }}
                >
                  {items}
                </div>
              )
            : items}
          <ButtonBase
            // The outer layout leaves drags over this zone to it.
            data-tab-strip
            data-testid="stack-drop-zone"
            className={cx(classes.dropZone, horizontal ? classes.dropZoneX : classes.dropZoneY, {
              [classes.dropZoneEmpty]: tabs.length === 0,
              [classes.dropOver]: isOver,
            })}
            onClick={(event) => {
              setCatalogAnchor(event.currentTarget);
            }}
            onDragEnter={(event) => {
              if (isPanelBeingDragged(event.dataTransfer)) {
                setIsOver(true);
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setIsOver(false);
              }
            }}
            onDragOver={(event) => {
              if (isPanelBeingDragged(event.dataTransfer)) {
                event.preventDefault();
              }
            }}
            onDrop={onDrop}
          >
            {t("dropHere")}
          </ButtonBase>
        </div>
      </div>
    </div>
  );
}

StackPanel.panelType = STACK_PANEL_TYPE;
StackPanel.defaultConfig = DEFAULT_STACK_CONFIG;

export default Panel(StackPanel);
