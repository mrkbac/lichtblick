// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import AddIcon from "@mui/icons-material/Add";
import ViewAgendaOutlinedIcon from "@mui/icons-material/ViewAgendaOutlined";
import ViewColumnOutlinedIcon from "@mui/icons-material/ViewColumnOutlined";
import ViewModuleOutlinedIcon from "@mui/icons-material/ViewModuleOutlined";
import WebAssetIcon from "@mui/icons-material/WebAsset";
import WebAssetOffIcon from "@mui/icons-material/WebAssetOff";
import { Button, Popover, Typography } from "@mui/material";
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
import { getDroppedPanel } from "@lichtblick/suite-base/components/PanelCatalog/panelDrag";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import { UnconnectedPanelLayout } from "@lichtblick/suite-base/components/PanelLayout";
import { isPanelBeingDragged } from "@lichtblick/suite-base/components/PanelTab";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import {
  FLOATING_TOOLBARS_ATTRIBUTE,
  FLOATING_TOOLBARS_STYLE,
} from "@lichtblick/suite-base/components/PanelToolbar/constants";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { LayoutNode } from "@lichtblick/suite-base/types/layouts";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { getPanelIdForType, getPanelTypeFromId } from "@lichtblick/suite-base/util/layout";
import { getPanelIds } from "@lichtblick/suite-base/util/layoutTree";
import { STACK_PANEL_TYPE, TabConfig, getTabs } from "@lichtblick/suite-base/util/tabLayout";

import { ScrollRail, STACK_ITEM_ATTRIBUTE } from "./ScrollRail";
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
  body: {
    position: "relative",
    display: "flex",
    flex: "auto",
    minHeight: 0,
  },
  bodyX: { flexDirection: "column" },
  hideTitleBars: FLOATING_TOOLBARS_STYLE,
  scroller: {
    position: "relative",
    flex: "auto",
    minHeight: 0,
    minWidth: 0,
    overflow: "auto",
    // The rail beside it scrolls instead.
    scrollbarWidth: "none",
  },
  // The gaps show the divider color between items, like the splits of a layout.
  track: {
    display: "flex",
    gap: 2,
    backgroundColor: theme.palette.divider,
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
    gap: 2,
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
  // Shown over the end of the stack while a panel is dragged over it.
  dropBar: {
    position: "absolute",
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing(1),
    border: `1px dashed ${theme.palette.primary.main}`,
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.secondary,
    fontSize: theme.typography.body2.fontSize,
    textAlign: "center",
    boxShadow: theme.shadows[4],
  },
  dropBarY: {
    left: theme.spacing(1),
    right: theme.spacing(2),
    bottom: theme.spacing(1),
    height: 40,
  },
  dropBarX: { top: theme.spacing(1), bottom: theme.spacing(2), right: theme.spacing(1), width: 96 },
  dropOver: {
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.action.selected,
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(1),
    flex: "auto",
    padding: theme.spacing(2),
    color: theme.palette.text.secondary,
    textAlign: "center",
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
    <div
      ref={setElement}
      className={classes.item}
      style={style}
      data-testid="stack-item"
      {...{ [STACK_ITEM_ATTRIBUTE]: index }}
    >
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
  // A panel is being dragged over the stack: show where to drop it to add it at the end.
  const [dragging, setDragging] = useState(false);
  const panelCatalog = usePanelCatalog();
  // The size being dragged, shown before it is saved.
  const [draft, setDraft] = useState<{ index: number; size: number } | undefined>(undefined);

  const rawTabs = config.tabs;
  const tabs = useMemo(() => getTabs({ tabs: rawTabs }), [rawTabs]);
  const { arrangement, size, columns, titleBars } = normalizeStackConfig(config);
  const horizontal = arrangement === "horizontal";
  const titles = useMemo(
    () =>
      tabs.map((tab) =>
        getPanelIds(tab.layout)
          .map((id) => {
            const type = getPanelTypeFromId(id);
            return panelCatalog.getPanelByType(type)?.title ?? type;
          })
          .join(" + "),
      ),
    [panelCatalog, tabs],
  );

  // A drag ends somewhere else, or is dropped into an item, without leaving the stack.
  useEffect(() => {
    if (!dragging) {
      return undefined;
    }
    const stop = () => {
      setDragging(false);
      setIsOver(false);
    };
    window.addEventListener("dragend", stop, true);
    window.addEventListener("drop", stop, true);
    return () => {
      window.removeEventListener("dragend", stop, true);
      window.removeEventListener("drop", stop, true);
    };
  }, [dragging]);

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
      } else if (path[1] === "titleBars" && typeof value === "boolean") {
        saveConfig({ titleBars: value });
      } else if (path[1] === "columns" && typeof value === "number") {
        saveConfig({ columns: Math.max(1, Math.floor(value)) });
      }
    },
    [saveConfig],
  );
  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildSettingsTree({ arrangement, size, columns, titleBars }, t),
    });
  }, [actionHandler, arrangement, columns, size, t, titleBars, updatePanelSettingsTree]);

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
    setDragging(false);
    const dropped = getDroppedPanel(event.dataTransfer);
    if (!dropped) {
      return;
    }
    event.preventDefault();
    append(dropped.id, dropped.config);
  };

  const dropTarget = {
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      if (isPanelBeingDragged(event.dataTransfer)) {
        setIsOver(true);
      }
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setIsOver(false);
      }
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (isPanelBeingDragged(event.dataTransfer)) {
        event.preventDefault();
      }
    },
    onDrop,
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
              button={STACK_BUTTONS.titleBars}
              data-testid="stack-title-bars"
              aria-pressed={titleBars}
              color={titleBars ? "default" : "primary"}
              onClick={() => {
                saveConfig({ titleBars: !titleBars });
              }}
            >
              {titleBars ? <WebAssetIcon /> : <WebAssetOffIcon />}
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
      <div
        className={cx(classes.body, { [classes.bodyX]: horizontal })}
        onDragEnterCapture={(event) => {
          if (isPanelBeingDragged(event.dataTransfer)) {
            setDragging(true);
          }
        }}
        onDragLeaveCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false);
            setIsOver(false);
          }
        }}
      >
        <div
          ref={setScroller}
          className={cx(classes.scroller, { [classes.hideTitleBars]: !titleBars })}
          {...(titleBars ? {} : { [FLOATING_TOOLBARS_ATTRIBUTE]: "" })}
        >
          {tabs.length === 0 ? (
            <div
              className={cx(classes.empty, { [classes.dropOver]: isOver })}
              style={{ height: "100%" }}
              // The layouts leave drags over this to it.
              data-drop-target
              data-testid="stack-empty"
              {...dropTarget}
            >
              <Typography variant="body2">{t("empty")}</Typography>
              <Button
                variant="outlined"
                size="small"
                startIcon={<AddIcon />}
                onClick={(event) => {
                  setCatalogAnchor(event.currentTarget);
                }}
              >
                {t("addPanel")}
              </Button>
            </div>
          ) : (
            <div className={cx(classes.track, horizontal ? classes.horizontal : classes.vertical)}>
              {arrangement === "grid" ? (
                <div
                  className={classes.grid}
                  style={{
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gridAutoRows: `minmax(${rowSize}px, 1fr)`,
                  }}
                >
                  {items}
                </div>
              ) : (
                items
              )}
            </div>
          )}
        </div>
        <ScrollRail scroller={scroller} horizontal={horizontal} titles={titles} />
        {dragging && tabs.length > 0 && (
          <div
            // The layouts leave drags over this to it.
            data-drop-target
            data-testid="stack-drop-bar"
            className={cx(classes.dropBar, horizontal ? classes.dropBarX : classes.dropBarY, {
              [classes.dropOver]: isOver,
            })}
            {...dropTarget}
          >
            {t("dropToAppend")}
          </div>
        )}
      </div>
    </div>
  );
}

StackPanel.panelType = STACK_PANEL_TYPE;
StackPanel.defaultConfig = DEFAULT_STACK_CONFIG;

export default Panel(StackPanel);
