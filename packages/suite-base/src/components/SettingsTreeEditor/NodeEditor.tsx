// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ArrowDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import ErrorIcon from "@mui/icons-material/Error";
import ViewListIcon from "@mui/icons-material/ViewList";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import WarningIcon from "@mui/icons-material/Warning";
import {
  Button,
  Chip,
  Divider,
  IconButton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { TFunction } from "i18next";
import { produce } from "immer";
import * as _ from "lodash-es";
import memoizeWeak from "memoize-weak";
import React, {
  ChangeEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { filterMap } from "@lichtblick/den/collection";
import { parseMessagePath, quoteTopicNameIfNeeded } from "@lichtblick/message-path";
import { Immutable } from "@lichtblick/suite";
import {
  HighlightChars,
  substringPositions,
} from "@lichtblick/suite-base/components/HighlightChars";
import { ContextInternal as MessagePipelineContextInternal } from "@lichtblick/suite-base/components/MessagePipeline";
import { DraggedMessagePath } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { useStyles } from "@lichtblick/suite-base/components/SettingsTreeEditor/NodeEditor.style";
import {
  SETTINGS_CHILD_DRAG_TYPE,
  SETTINGS_NODE_DRAG_TYPE,
} from "@lichtblick/suite-base/components/SettingsTreeEditor/constants";
import {
  ChildReorderContext,
  DragItem,
  EditorSettingsTreeAction,
  EditorSettingsTreeField,
  EditorSettingsTreeNode,
  EditorSettingsTreeNodeAction,
  EditorSettingsTreeNodeActionItem,
  EditorSettingsTreeNodes,
  NodeEditorProps,
  NodeEditorState,
  SelectVisibilityFilterValue,
} from "@lichtblick/suite-base/components/SettingsTreeEditor/types";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useMessagePathDrag } from "@lichtblick/suite-base/services/messagePathDragging";

import { FieldEditor } from "./FieldEditor";
import { NodeActionsMenu } from "./NodeActionsMenu";
import { VisibilityToggle } from "./VisibilityToggle";
import { icons } from "./icons";
import { buildTopicNameTree, TopicNameTreeEntry } from "./topicNameTree";
import { filterTreeNodes, prepareSettingsNodes } from "./utils";

function ExpansionArrow({ expanded }: Readonly<{ expanded: boolean }>): React.JSX.Element {
  const { classes } = useStyles();

  const Component = expanded ? ArrowDownIcon : ArrowRightIcon;
  return (
    <div className={classes.iconWrapper}>
      <Component />
    </div>
  );
}

const makeStablePath = memoizeWeak((path: readonly string[], key: string) => [...path, key]);

const SelectVisibilityFilterOptions: (t: TFunction<"settingsEditor">) => {
  label: string;
  value: SelectVisibilityFilterValue;
}[] = (t) => [
  { label: t("listAll"), value: "all" },
  { label: t("listVisible"), value: "visible" },
  { label: t("listInvisible"), value: "invisible" },
];
function showVisibleFilter(child: Immutable<EditorSettingsTreeNode>): boolean {
  // want to show children with undefined visibility
  return child.visible !== false;
}
function showInvisibleFilter(child: Immutable<EditorSettingsTreeNode>): boolean {
  // want to show children with undefined visibility
  return child.visible !== true;
}
const getSelectVisibilityFilterField = (t: TFunction<"settingsEditor">) =>
  ({
    input: "select",
    label: t("filterList"),
    help: t("filterListHelp"),
    options: SelectVisibilityFilterOptions(t),
  }) as const;

export const handleDropNode = (
  item: DragItem,
  targetPath: readonly string[],
  actionHandler: (action: EditorSettingsTreeAction) => void,
): void => {
  actionHandler({
    action: "reorder-node",
    payload: {
      path: item.path,
      targetPath,
    },
  });
};

type ChildDragData = {
  type: typeof SETTINGS_CHILD_DRAG_TYPE;
  parentPath: readonly string[];
  key: string;
  group: string | undefined;
};

/** The half of `element` that `clientY` is over: a drop there lands before or after the node. */
export function dropEdgeAt(element: Element, clientY: number): "before" | "after" {
  const rect = element.getBoundingClientRect();
  return clientY < rect.top + rect.height / 2 ? "before" : "after";
}

/** Builds the Foxglove `reorder-children` action; `sourcePath` is only set for cross-parent moves. */
export function reorderChildrenAction(args: {
  path: readonly string[];
  sourcePath: readonly string[];
  fromKey: string;
  toKey: string;
  position: "before" | "after";
}): EditorSettingsTreeAction {
  const { path, sourcePath, fromKey, toKey, position } = args;
  return {
    action: "reorder-children",
    payload: _.isEqual(path, sourcePath)
      ? { path, fromKey, toKey, position }
      : { path, sourcePath, fromKey, toKey, position },
  };
}

const MOVE_UP_ACTION_ID = "lichtblick:reorder-move-up";
const MOVE_DOWN_ACTION_ID = "lichtblick:reorder-move-down";

/** The drag payload for a node's `drag` setting, in the shape panels accept from the topic list. */
function nodeDragItem(
  drag: Immutable<EditorSettingsTreeNode>["drag"],
  schemaNameOf: (topicName: string) => string | undefined,
): DraggedMessagePath | undefined {
  if (drag == undefined) {
    return undefined;
  }
  if (drag.type === "topic") {
    return {
      path: quoteTopicNameIfNeeded(drag.topicName),
      rootSchemaName: schemaNameOf(drag.topicName),
      isTopic: true,
      isLeaf: false,
      topicName: drag.topicName,
    };
  }
  const parsed = parseMessagePath(drag.value);
  const topicName = parsed?.topicName ?? drag.value;
  return {
    path: drag.value,
    rootSchemaName: schemaNameOf(topicName),
    isTopic: parsed?.messagePath.length === 0,
    isLeaf: drag.isLeaf === true,
    topicName,
  };
}

function NodeEditorComponent(props: Readonly<NodeEditorProps>): React.JSX.Element {
  const {
    actionHandler,
    defaultOpen = true,
    filter,
    focusedPath,
    reorderContext,
    settings = {},
    topicNamespace,
    unfilteredSettings,
  } = props;
  const [state, setState] = useState<NodeEditorState>({
    editing: false,
    focusedPath: undefined,
    open: defaultOpen,
    textFilter: "",
    visibilityFilter: "all",
    topicTree: false,
  });
  const { t } = useTranslation("settingsEditor");
  const { classes, cx, theme } = useStyles();

  const indent = props.indent ?? props.path.length;
  const label = props.displayLabel ?? settings.label ?? t("general");
  const ownKey = props.path.at(-1) ?? "";
  const allowVisibilityToggle = props.settings?.visible != undefined;
  const visible = props.settings?.visible !== false;
  const selectVisibilityFilterEnabled = props.settings?.enableVisibilityFilter === true;
  const topicTreeEnabled = selectVisibilityFilterEnabled && settings.enableTopicNameTree === true;
  const mixedVisibility = visible && topicNamespace?.topics.some(([, shown]) => !shown) === true;
  const namespaceVisibilityLabel = topicNamespace
    ? t(visible ? "hideNamespace" : "showNamespace", { namespace: label })
    : undefined;
  // Lichtblick API: `reorderable: true` dispatches "reorder-node". Children of a Foxglove
  // `childrenReorderable` parent use `reorderContext` and dispatch "reorder-children" instead.
  const isReorderable = reorderContext == undefined && settings.reorderable === true;
  const childDragEnabled = reorderContext?.dragEnabled === true;

  // Drag and drop for reorderable nodes: a node can be dropped onto a sibling to reorder it.
  const [isDragging, setIsDragging] = useState(false);
  // Which edge of this node a dragged node would land on; shown as a line on that edge.
  const [dropEdge, setDropEdge] = useState<"before" | "after" | undefined>();
  const latest = useRef({ path: props.path, actionHandler, reorderContext });
  latest.current = { path: props.path, actionHandler, reorderContext };

  const connectReorder = useCallback((element: HTMLElement) => {
    const sourcePath = (data: Record<string | symbol, unknown>) =>
      data.type === SETTINGS_NODE_DRAG_TYPE ? (data as DragItem).path : undefined;
    const canDropOnThis = (path: readonly string[] | undefined) => {
      const ownPath = latest.current.path;
      return (
        path?.length === ownPath.length &&
        path.length >= 2 &&
        path[0] === ownPath[0] &&
        !_.isEqual(path, ownPath)
      );
    };
    return combine(
      draggable({
        element,
        getInitialData: () => ({ type: SETTINGS_NODE_DRAG_TYPE, path: latest.current.path }),
        onDragStart: () => {
          setIsDragging(true);
        },
        onDrop: () => {
          setIsDragging(false);
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => canDropOnThis(sourcePath(source.data)),
        onDragEnter: () => {
          setDropEdge("before");
        },
        onDragLeave: () => {
          setDropEdge(undefined);
        },
        onDrop: ({ source }) => {
          setDropEdge(undefined);
          const path = sourcePath(source.data);
          if (path != undefined) {
            handleDropNode({ path }, latest.current.path, latest.current.actionHandler);
          }
        },
      }),
    );
  }, []);

  const connectChildReorder = useCallback((element: HTMLElement) => {
    const childData = (data: Record<string | symbol, unknown>) =>
      data.type === SETTINGS_CHILD_DRAG_TYPE ? (data as ChildDragData) : undefined;
    const latestKey = () => latest.current.path[latest.current.path.length - 1] ?? "";
    return combine(
      draggable({
        element,
        canDrag: () => latest.current.reorderContext?.dragEnabled === true,
        getInitialData: (): ChildDragData => ({
          type: SETTINGS_CHILD_DRAG_TYPE,
          parentPath: latest.current.reorderContext?.parentPath ?? [],
          key: latestKey(),
          group: latest.current.reorderContext?.group,
        }),
        onDragStart: () => {
          setIsDragging(true);
        },
        onDrop: () => {
          setIsDragging(false);
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => {
          const from = childData(source.data);
          const context = latest.current.reorderContext;
          if (from == undefined || context?.dragEnabled !== true) {
            return false;
          }
          if (_.isEqual(from.parentPath, context.parentPath)) {
            return from.key !== latestKey();
          }
          return context.group != undefined && from.group === context.group;
        },
        onDrag: ({ location, self }) => {
          setDropEdge(dropEdgeAt(self.element, location.current.input.clientY));
        },
        onDragLeave: () => {
          setDropEdge(undefined);
        },
        onDrop: ({ source, location, self }) => {
          setDropEdge(undefined);
          const from = childData(source.data);
          const context = latest.current.reorderContext;
          if (from == undefined || context == undefined) {
            return;
          }
          latest.current.actionHandler(
            reorderChildrenAction({
              path: context.parentPath,
              sourcePath: from.parentPath,
              fromKey: from.key,
              toKey: latestKey(),
              position: dropEdgeAt(self.element, location.current.input.clientY),
            }),
          );
        },
      }),
    );
  }, []);

  const isChildReorderable = reorderContext != undefined;
  const headerRef = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      if (el == undefined) {
        return undefined;
      }
      if (isChildReorderable) {
        return connectChildReorder(el);
      }
      return isReorderable ? connectReorder(el) : undefined;
    },
    [connectChildReorder, connectReorder, isChildReorderable, isReorderable],
  );

  // Foxglove `drag`: the label can be dragged onto panels like a topic list row.
  const pipelineStore = useContext(MessagePipelineContextInternal);
  const dragItem = nodeDragItem(
    settings.drag,
    (topicName) =>
      pipelineStore?.getState().public.sortedTopics.find((topic) => topic.name === topicName)
        ?.schemaName,
  );
  const { dragRef: nodeDragRef } = useMessagePathDrag({
    item: dragItem ?? {
      path: "",
      rootSchemaName: undefined,
      isTopic: false,
      isLeaf: false,
      topicName: "",
    },
    selected: false,
  });

  const selectVisibilityFilter = (action: EditorSettingsTreeAction) => {
    if (action.action === "update" && action.payload.input === "select") {
      setState(
        produce((draft) => {
          draft.visibilityFilter = action.payload.value as SelectVisibilityFilterValue;
        }),
      );
    }
  };

  const textFilterHandler = (action: EditorSettingsTreeAction) => {
    if (action.action === "update" && action.payload.input === "string") {
      setState(
        produce((draft) => {
          draft.textFilter = action.payload.value as string;
        }),
      );
    }
  };

  const toggleVisibility = () => {
    if (topicNamespace) {
      const parentPath = props.path.slice(0, -1);
      for (const [topic, shown] of topicNamespace.topics) {
        if (shown === visible) {
          actionHandler({
            action: "update",
            payload: { input: "boolean", path: [...parentPath, topic, "visible"], value: !visible },
          });
        }
      }
      return;
    }
    actionHandler({
      action: "update",
      payload: { input: "boolean", path: [...props.path, "visible"], value: !visible },
    });
  };

  const handleNodeAction = (actionId: string) => {
    if (reorderContext && (actionId === MOVE_UP_ACTION_ID || actionId === MOVE_DOWN_ACTION_ID)) {
      const index = reorderContext.siblingKeys.indexOf(ownKey);
      const up = actionId === MOVE_UP_ACTION_ID;
      const toKey = reorderContext.siblingKeys[up ? index - 1 : index + 1];
      if (index !== -1 && toKey != undefined) {
        actionHandler(
          reorderChildrenAction({
            path: reorderContext.parentPath,
            sourcePath: reorderContext.parentPath,
            fromKey: ownKey,
            toKey,
            position: up ? "before" : "after",
          }),
        );
      }
      return;
    }
    actionHandler({ action: "perform-node-action", payload: { id: actionId, path: props.path } });
  };

  const isFocused = _.isEqual(focusedPath, props.path);

  useEffect(() => {
    const isOnFocusedPath =
      focusedPath != undefined && _.isEqual(props.path, focusedPath.slice(0, props.path.length));

    if (isOnFocusedPath) {
      setState(
        produce((draft) => {
          draft.open = true;
        }),
      );
    }

    if (isFocused) {
      rootRef.current?.scrollIntoView();
    }
  }, [focusedPath, isFocused, props.path, setState]);

  const { fields, children } = settings;
  const hasChildren = children != undefined && Object.keys(children).length > 0;
  const hasProperties = fields != undefined || hasChildren || topicNamespace != undefined;

  const rootRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => Object.entries(fields ?? {}), [fields]);

  const renderFieldEditor = useCallback(
    (key: string, field: Immutable<EditorSettingsTreeField>) => (
      <FieldEditor
        key={key}
        field={field}
        path={makeStablePath(props.path, key)}
        indent={indent + 1}
        actionHandler={actionHandler}
      />
    ),
    [props.path, actionHandler, indent],
  );

  const fieldEditors = useMemo(
    () =>
      entries.filter(([, field]) => field).map(([key, field]) => renderFieldEditor(key, field!)),
    [entries, renderFieldEditor],
  );

  const filterFn = useMemo(() => {
    if (state.visibilityFilter === "visible") {
      return showVisibleFilter;
    }
    if (state.visibilityFilter === "invisible") {
      return showInvisibleFilter;
    }
    return undefined;
  }, [state.visibilityFilter]);

  const childrenReorderable = settings.childrenReorderable;
  // With `childrenReorderable`, the entry order of `children` is the display order.
  const preparedNodes = useMemo(
    () =>
      childrenReorderable != undefined && childrenReorderable !== false
        ? Object.entries(children ?? {}).filter(
            (entry): entry is [string, Immutable<EditorSettingsTreeNode>] => entry[1] != undefined,
          )
        : prepareSettingsNodes(children ?? {}),
    [children, childrenReorderable],
  );

  const visibilityFilteredNodes = useMemo(() => {
    if (!filterFn) {
      return preparedNodes;
    }
    return preparedNodes.filter(([, child]) => filterFn(child));
  }, [preparedNodes, filterFn]);

  const quickFilterTopics = useMemo(() => {
    const quickFilter = settings.topicQuickFilters?.find(({ id }) => id === state.topicQuickFilter);
    return quickFilter ? new Set(quickFilter.topics) : undefined;
  }, [settings.topicQuickFilters, state.topicQuickFilter]);

  const filteredNodes = useMemo(() => {
    const matchingNodes = quickFilterTopics
      ? visibilityFilteredNodes.filter(([key]) => quickFilterTopics.has(key))
      : visibilityFilteredNodes;
    if (state.textFilter.length === 0) {
      return matchingNodes;
    }
    const nodesRecord: Immutable<EditorSettingsTreeNodes> = Object.fromEntries(matchingNodes);
    return prepareSettingsNodes(filterTreeNodes(nodesRecord, state.textFilter));
  }, [quickFilterTopics, visibilityFilteredNodes, state.textFilter]);

  const topicTree = useMemo(() => {
    if (!topicTreeEnabled || !state.topicTree) {
      return undefined;
    }
    const allTopics = prepareSettingsNodes(unfilteredSettings?.children ?? children ?? {});
    return buildTopicNameTree(allTopics, filteredNodes);
  }, [topicTreeEnabled, state.topicTree, unfilteredSettings?.children, children, filteredNodes]);

  const childReorderContext = useMemo((): ChildReorderContext | undefined => {
    if (childrenReorderable == undefined || childrenReorderable === false) {
      return undefined;
    }
    const siblingKeys = preparedNodes
      .filter(([, child]) => child.reorderable !== false)
      .map(([key]) => key);
    if (siblingKeys.length < 2 && typeof childrenReorderable !== "object") {
      return undefined;
    }
    return {
      parentPath: props.path,
      group: typeof childrenReorderable === "object" ? childrenReorderable.group : undefined,
      siblingKeys,
      // Never drag against a partial list: a tree-wide filter may have hidden some children.
      dragEnabled: (filter ?? "").length === 0 && filteredNodes.length === preparedNodes.length,
    };
  }, [childrenReorderable, preparedNodes, filteredNodes.length, filter, props.path]);

  const childNodes = useMemo(() => {
    if (topicTree) {
      const expandMatches =
        (filter ?? "").length > 0 ||
        state.textFilter.length > 0 ||
        state.visibilityFilter !== "all" ||
        quickFilterTopics != undefined;
      // A new filter reopens matching namespaces; an unchanged one keeps manual collapses.
      const filterKey = expandMatches
        ? JSON.stringify([filter, state.textFilter, state.visibilityFilter, state.topicQuickFilter])
        : undefined;
      const focusedTopic = focusedPath?.[props.path.length];
      const focusInList =
        focusedTopic != undefined &&
        _.isEqual(props.path, focusedPath?.slice(0, props.path.length));
      const renderEntry = (entry: TopicNameTreeEntry, depth: number): React.JSX.Element => {
        if (entry.type === "topic") {
          return (
            <NodeEditor
              key={`topic:${entry.key}`}
              actionHandler={actionHandler}
              defaultOpen={entry.settings.defaultExpansionState !== "collapsed"}
              displayLabel={entry.label}
              filter={filter}
              focusedPath={focusedPath}
              indent={depth}
              path={makeStablePath(props.path, entry.key)}
              settings={entry.settings}
              unfilteredSettings={unfilteredSettings?.children?.[entry.key]}
            />
          );
        }
        return (
          <NodeEditor
            key={`namespace:${entry.key}`}
            actionHandler={actionHandler}
            defaultOpen={false}
            indent={depth}
            path={makeStablePath(props.path, `namespace:${entry.key}`)}
            settings={{
              label: entry.label,
              icon: "Folder",
              visible:
                entry.topics.length > 0 ? entry.topics.some(([, shown]) => shown) : undefined,
            }}
            topicNamespace={{
              topics: entry.topics,
              children: entry.children.map((child) => renderEntry(child, depth + 1)),
              expandKey:
                filterKey ??
                (focusInList && focusedTopic.startsWith(entry.key + "/")
                  ? `focus:${focusedTopic}`
                  : undefined),
            }}
          />
        );
      };
      return topicTree.map((entry) => renderEntry(entry, indent + 1));
    }
    return filterMap(filteredNodes, ([key, child]) => (
      <NodeEditor
        actionHandler={actionHandler}
        defaultOpen={child.defaultExpansionState !== "collapsed"}
        filter={filter}
        focusedPath={focusedPath}
        key={key}
        settings={child}
        unfilteredSettings={unfilteredSettings?.children?.[key]}
        path={makeStablePath(props.path, key)}
        indent={indent + 1}
        reorderContext={child.reorderable === false ? undefined : childReorderContext}
      />
    ));
  }, [
    topicTree,
    filteredNodes,
    actionHandler,
    filter,
    focusedPath,
    props.path,
    childReorderContext,
    indent,
    state.textFilter,
    state.visibilityFilter,
    state.topicQuickFilter,
    quickFilterTopics,
    unfilteredSettings?.children,
  ]);

  const IconComponent = settings.icon ? icons[settings.icon] : undefined;

  const onEditLabel = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (settings.renamable === true) {
        actionHandler({
          action: "update",
          payload: { path: [...props.path, "label"], input: "string", value: event.target.value },
        });
      }
    },
    [actionHandler, props.path, settings.renamable],
  );

  const toggleEditing = useCallback(() => {
    setState(
      produce((draft) => {
        draft.editing = !draft.editing;
      }),
    );
  }, [setState]);

  const toggleOpen = useCallback(() => {
    setState(
      produce((draft) => {
        if (!draft.editing) {
          draft.open = !draft.open;
        }
      }),
    );
  }, [setState]);

  useEffect(() => {
    if (topicNamespace?.expandKey != undefined) {
      setState(
        produce((draft) => {
          draft.open = true;
        }),
      );
    }
  }, [setState, topicNamespace?.expandKey]);

  const onLabelKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === "Escape") {
        toggleEditing();
      }
    },
    [toggleEditing],
  );

  const [inlineActions, menuActions] = useMemo(() => {
    const [inline, menuOnly] = _.partition(
      settings.actions,
      (action): action is EditorSettingsTreeNodeActionItem =>
        action.type === "action" && action.display === "inline",
    );
    const menu: Immutable<EditorSettingsTreeNodeAction>[] = [...menuOnly];
    // Foxglove `childrenReorderable`: default "Move up" / "Move down" items once 2+ children can move.
    if (reorderContext != undefined && reorderContext.siblingKeys.length >= 2) {
      const index = reorderContext.siblingKeys.indexOf(ownKey);
      menu.push(
        {
          type: "action",
          id: MOVE_UP_ACTION_ID,
          label: t("moveUp"),
          icon: "MoveUp",
          disabled: index <= 0,
        },
        {
          type: "action",
          id: MOVE_DOWN_ACTION_ID,
          label: t("moveDown"),
          icon: "MoveDown",
          disabled: index === -1 || index >= reorderContext.siblingKeys.length - 1,
        },
      );
    }
    return [inline, menu];
  }, [settings.actions, reorderContext, ownKey, t]);

  const isDragHandleIcon = settings.icon === "DragHandle" && isReorderable;
  const nodeColor = settings.color;

  const iconItem = useMemo(() => {
    if (props.settings?.error) {
      return (
        <Tooltip
          arrow
          title={
            <Typography variant="subtitle2" className={classes.errorTooltip}>
              {props.settings.error}
            </Typography>
          }
        >
          <ErrorIcon
            fontSize="small"
            color="error"
            style={{
              marginRight: theme.spacing(0.5),
            }}
          />
        </Tooltip>
      );
    }

    if (props.settings?.warning) {
      return (
        <Tooltip
          arrow
          title={<Typography variant="subtitle2">{props.settings.warning}</Typography>}
        >
          <WarningIcon
            fontSize="small"
            color="warning"
            data-testid="node-warning-icon"
            style={{ marginRight: theme.spacing(0.5) }}
          />
        </Tooltip>
      );
    }

    if (IconComponent && !isDragHandleIcon) {
      return (
        <IconComponent
          fontSize="small"
          color="inherit"
          style={{
            marginRight: theme.spacing(0.5),
            opacity: nodeColor ? 1 : 0.8,
            color: nodeColor,
          }}
        />
      );
    }

    if (nodeColor) {
      return (
        <span
          data-testid="node-color-swatch"
          style={{
            width: 10,
            height: 10,
            flex: "none",
            borderRadius: 2,
            background: nodeColor,
            marginRight: theme.spacing(0.75),
          }}
        />
      );
    }

    return <></>;
  }, [
    IconComponent,
    classes.errorTooltip,
    props.settings?.error,
    props.settings?.warning,
    nodeColor,
    theme,
    isDragHandleIcon,
  ]);

  const dragHandleIcon = useMemo(() => {
    if (isDragHandleIcon && IconComponent) {
      return (
        <IconComponent
          fontSize="small"
          color="inherit"
          style={{
            marginRight: theme.spacing(0.5),
            opacity: 0.8,
          }}
        />
      );
    }
    return undefined;
  }, [IconComponent, isDragHandleIcon, theme]);

  return (
    <>
      <div
        className={cx(classes.nodeHeader, {
          [classes.focusedNode]: isFocused,
          [classes.nodeHeaderVisible]: visible && topicNamespace == undefined,
          [classes.nodeHeaderDragging]: isDragging,
          [classes.nodeHeaderDropBefore]: dropEdge === "before",
          [classes.nodeHeaderDropAfter]: dropEdge === "after",
        })}
        ref={headerRef}
        style={{
          opacity: isDragging ? 0.5 : 1,
          cursor: isReorderable || childDragEnabled ? "grab" : undefined,
        }}
      >
        <div
          className={cx(classes.nodeHeaderToggle, {
            [classes.nodeHeaderToggleHasProperties]: hasProperties,
            [classes.nodeHeaderToggleVisible]: visible,
          })}
          style={{
            marginLeft: theme.spacing(0.75 + 2 * indent),
          }}
          onClick={toggleOpen}
          role={topicNamespace ? "button" : undefined}
          tabIndex={topicNamespace ? 0 : undefined}
          aria-expanded={topicNamespace ? state.open : undefined}
          onKeyDown={
            topicNamespace
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleOpen();
                  }
                }
              : undefined
          }
          data-testid={`settings__nodeHeaderToggle__${props.path.join("-")}`}
        >
          {dragHandleIcon}
          {hasProperties && <ExpansionArrow expanded={state.open} />}
          {iconItem}
          {state.editing ? (
            <TextField
              className={classes.editNameField}
              autoFocus
              variant="filled"
              onChange={onEditLabel}
              value={settings.label}
              onBlur={toggleEditing}
              onKeyDown={onLabelKeyDown}
              onFocus={(event) => {
                event.target.select();
              }}
              slotProps={{
                input: {
                  endAdornment: (
                    <IconButton
                      className={classes.actionButton}
                      title="Rename"
                      data-node-function="edit-label"
                      data-testid="check-icon-button"
                      color="primary"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleEditing();
                      }}
                    >
                      <CheckIcon fontSize="small" />
                    </IconButton>
                  ),
                },
              }}
            />
          ) : (
            <Typography
              noWrap={true}
              variant="subtitle2"
              color={visible ? "textPrimary" : "textDisabled"}
              style={{
                flex: "1 1 auto",
                fontWeight: indent < 2 ? 600 : 400,
                cursor: dragItem ? "grab" : undefined,
              }}
              title={settings.help ?? (props.displayLabel != undefined ? ownKey : undefined)}
              ref={dragItem ? nodeDragRef : undefined}
              data-testid={dragItem ? "settings-node-drag-source" : undefined}
            >
              <HighlightChars str={label} indices={substringPositions(label, filter)} />
            </Typography>
          )}
        </div>
        <Stack alignItems="center" direction="row">
          {settings.renamable === true && !state.editing && (
            <IconButton
              className={classes.actionButton}
              title="Rename"
              data-node-function="edit-label"
              color="primary"
              onClick={(event) => {
                event.stopPropagation();
                toggleEditing();
              }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          )}
          {settings.visible != undefined && (
            <VisibilityToggle
              size="small"
              checked={visible}
              indeterminate={mixedVisibility}
              title={namespaceVisibilityLabel}
              slotProps={{
                input: {
                  "aria-label": namespaceVisibilityLabel,
                  "aria-checked": mixedVisibility ? "mixed" : undefined,
                },
              }}
              onChange={toggleVisibility}
              style={{ opacity: allowVisibilityToggle ? 1 : 0 }}
              disabled={!allowVisibilityToggle}
            />
          )}
          {inlineActions.map((action) => {
            const Icon = action.icon ? icons[action.icon] : undefined;
            const handler = () => {
              actionHandler({
                action: "perform-node-action",
                payload: { id: action.id, path: props.path },
              });
            };
            const disabled = action.disabled === true;
            const color = action.color ?? "inherit";
            return (
              // The span keeps the tooltip working while the button is disabled.
              <Tooltip key={action.id} title={action.tooltip ?? (Icon ? action.label : "")} arrow>
                <span>
                  {Icon ? (
                    <IconButton
                      onClick={handler}
                      aria-label={action.label}
                      disabled={disabled}
                      color={color === "inherit" ? "default" : color}
                      className={classes.actionButton}
                    >
                      <Icon fontSize="small" />
                    </IconButton>
                  ) : (
                    <Button
                      onClick={handler}
                      size="small"
                      disabled={disabled}
                      color={color}
                      className={classes.actionButton}
                    >
                      {action.label}
                    </Button>
                  )}
                </span>
              </Tooltip>
            );
          })}

          {menuActions.length > 0 && (
            <NodeActionsMenu actions={menuActions} onSelectAction={handleNodeAction} />
          )}
        </Stack>
      </div>
      {state.open && fieldEditors.length > 0 && (
        <>
          <div className={classes.fieldPadding} />
          {fieldEditors}
          <div className={classes.fieldPadding} />
        </>
      )}
      {state.open && topicTreeEnabled && hasChildren && (
        <div className={classes.topicFilterRow}>
          <TextField
            className={classes.topicFilterInput}
            variant="filled"
            size="small"
            type="search"
            value={state.textFilter}
            placeholder={t("filterTopics")}
            slotProps={{ htmlInput: { "aria-label": t("filterTopics") } }}
            onChange={(event) => {
              setState(
                produce((draft) => {
                  draft.textFilter = event.target.value;
                }),
              );
            }}
          />
          <div className={classes.topicFilterControls}>
            <ToggleButtonGroup
              className={classes.topicVisibilityFilter}
              size="small"
              exclusive
              value={state.visibilityFilter}
              aria-label={t("filterListHelp")}
              onChange={(_event, value: SelectVisibilityFilterValue | null) => {
                if (value != undefined) {
                  setState(
                    produce((draft) => {
                      draft.visibilityFilter = value;
                    }),
                  );
                }
              }}
            >
              <Tooltip title={t("topicVisibilityAll")}>
                <ToggleButton value="all" aria-label={t("topicVisibilityAll")}>
                  <ViewListIcon className={classes.topicFilterIcon} />
                </ToggleButton>
              </Tooltip>
              <Tooltip title={t("topicVisibilityShown")}>
                <ToggleButton value="visible" aria-label={t("topicVisibilityShown")}>
                  <VisibilityIcon className={classes.topicFilterIcon} />
                </ToggleButton>
              </Tooltip>
              <Tooltip title={t("topicVisibilityHidden")}>
                <ToggleButton value="invisible" aria-label={t("topicVisibilityHidden")}>
                  <VisibilityOffIcon className={classes.topicFilterIcon} />
                </ToggleButton>
              </Tooltip>
            </ToggleButtonGroup>
            <Tooltip title={t("groupTopicsByName")}>
              <ToggleButton
                className={classes.topicTreeToggle}
                size="small"
                value="tree"
                selected={state.topicTree}
                aria-label={t("groupTopicsByName")}
                onChange={() => {
                  setState(
                    produce((draft) => {
                      draft.topicTree = !draft.topicTree;
                    }),
                  );
                }}
              >
                <AccountTreeIcon className={classes.topicFilterIcon} />
              </ToggleButton>
            </Tooltip>
          </div>
        </div>
      )}
      {state.open &&
        topicTreeEnabled &&
        hasChildren &&
        (settings.topicQuickFilters?.length ?? 0) > 0 && (
          <div className={classes.topicTypeFilters} role="group" aria-label={t("topicTypeFilters")}>
            {settings.topicQuickFilters?.map(({ id, label: filterLabel }) => {
              const selected = state.topicQuickFilter === id;
              return (
                <Chip
                  key={id}
                  size="small"
                  variant={selected ? "filled" : "outlined"}
                  color={selected ? "primary" : "default"}
                  label={filterLabel}
                  aria-pressed={selected}
                  onClick={() => {
                    setState(
                      produce((draft) => {
                        draft.topicQuickFilter = selected ? undefined : id;
                      }),
                    );
                  }}
                />
              );
            })}
          </div>
        )}
      {state.open && selectVisibilityFilterEnabled && !topicTreeEnabled && hasChildren && (
        <>
          <Stack paddingBottom={0.5} style={{ gridColumn: "span 2" }} />
          <FieldEditor
            key="visibilityFilter"
            field={{ ...getSelectVisibilityFilterField(t), value: state.visibilityFilter }}
            path={makeStablePath(props.path, "visibilityFilter")}
            actionHandler={selectVisibilityFilter}
          />
          <FieldEditor
            key="textFilter"
            field={{
              input: "string",
              label: t("filterListText"),
              help: t("filterListTextHelp"),
              placeholder: t("filterListTextPlaceholder"),
              value: state.textFilter,
            }}
            path={makeStablePath(props.path, "textFilter")}
            actionHandler={textFilterHandler}
          />
        </>
      )}
      {state.open && (topicNamespace?.children ?? childNodes)}
      {indent === 1 && <Divider style={{ gridColumn: "span 2" }} />}
    </>
  );
}

export const NodeEditor = React.memo(NodeEditorComponent);
