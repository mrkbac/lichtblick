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
import ArrowDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import ErrorIcon from "@mui/icons-material/Error";
import { Button, Divider, IconButton, TextField, Tooltip, Typography } from "@mui/material";
import { TFunction } from "i18next";
import * as _ from "lodash-es";
import memoizeWeak from "memoize-weak";
import React, { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useImmer } from "use-immer";

import { filterMap } from "@lichtblick/den/collection";
import {
  Immutable,
  SettingsTreeAction,
  SettingsTreeField,
  SettingsTreeNode,
  SettingsTreeNodeActionItem,
  SettingsTreeNodes,
} from "@lichtblick/suite";
import { HighlightedText } from "@lichtblick/suite-base/components/HighlightedText";
import { useStyles } from "@lichtblick/suite-base/components/SettingsTreeEditor/NodeEditor.style";
import { SETTINGS_NODE_DRAG_TYPE } from "@lichtblick/suite-base/components/SettingsTreeEditor/constants";
import {
  DragItem,
  NodeEditorProps,
  NodeEditorState,
  SelectVisibilityFilterValue,
} from "@lichtblick/suite-base/components/SettingsTreeEditor/types";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useAppContext } from "@lichtblick/suite-base/context/AppContext";

import { FieldEditor } from "./FieldEditor";
import { NodeActionsMenu } from "./NodeActionsMenu";
import { VisibilityToggle } from "./VisibilityToggle";
import { icons } from "./icons";
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
function showVisibleFilter(child: Immutable<SettingsTreeNode>): boolean {
  // want to show children with undefined visibility
  return child.visible !== false;
}
function showInvisibleFilter(child: Immutable<SettingsTreeNode>): boolean {
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
  actionHandler: (action: SettingsTreeAction) => void,
): void => {
  actionHandler({
    action: "reorder-node",
    payload: {
      path: item.path,
      targetPath,
    },
  });
};

function NodeEditorComponent(props: Readonly<NodeEditorProps>): React.JSX.Element {
  const { actionHandler, defaultOpen = true, filter, focusedPath, settings = {} } = props;
  const [state, setState] = useImmer<NodeEditorState>({
    editing: false,
    focusedPath: undefined,
    open: defaultOpen,
    textFilter: "",
    visibilityFilter: "all",
  });
  const { renderSettingsStatusButton } = useAppContext();
  const { t } = useTranslation("settingsEditor");
  const { classes, cx, theme } = useStyles();

  const indent = props.path.length;
  const allowVisibilityToggle = props.settings?.visible != undefined;
  const visible = props.settings?.visible !== false;
  const selectVisibilityFilterEnabled = props.settings?.enableVisibilityFilter === true;
  const isReorderable = settings.reorderable === true;

  // Drag and drop for reorderable nodes: a node can be dropped onto a sibling to reorder it.
  const [isDragging, setIsDragging] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const latest = useRef({ path: props.path, actionHandler });
  latest.current = { path: props.path, actionHandler };

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
          setIsDropTarget(true);
        },
        onDragLeave: () => {
          setIsDropTarget(false);
        },
        onDrop: ({ source }) => {
          setIsDropTarget(false);
          const path = sourcePath(source.data);
          if (path != undefined) {
            handleDropNode({ path }, latest.current.path, latest.current.actionHandler);
          }
        },
      }),
    );
  }, []);

  const headerRef = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      return el != undefined && isReorderable ? connectReorder(el) : undefined;
    },
    [connectReorder, isReorderable],
  );

  const selectVisibilityFilter = (action: SettingsTreeAction) => {
    if (action.action === "update" && action.payload.input === "select") {
      setState((draft) => {
        draft.visibilityFilter = action.payload.value as SelectVisibilityFilterValue;
      });
    }
  };

  const textFilterHandler = (action: SettingsTreeAction) => {
    if (action.action === "update" && action.payload.input === "string") {
      setState((draft) => {
        draft.textFilter = action.payload.value as string;
      });
    }
  };

  const toggleVisibility = () => {
    actionHandler({
      action: "update",
      payload: { input: "boolean", path: [...props.path, "visible"], value: !visible },
    });
  };

  const handleNodeAction = (actionId: string) => {
    actionHandler({ action: "perform-node-action", payload: { id: actionId, path: props.path } });
  };

  const isFocused = _.isEqual(focusedPath, props.path);

  useEffect(() => {
    const isOnFocusedPath =
      focusedPath != undefined && _.isEqual(props.path, focusedPath.slice(0, props.path.length));

    if (isOnFocusedPath) {
      setState((draft) => {
        draft.open = true;
      });
    }

    if (isFocused) {
      rootRef.current?.scrollIntoView();
    }
  }, [focusedPath, isFocused, props.path, setState]);

  const { fields, children } = settings;
  const hasChildren = children != undefined && Object.keys(children).length > 0;
  const hasProperties = fields != undefined || hasChildren;

  const rootRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => Object.entries(fields ?? {}), [fields]);

  const renderFieldEditor = useCallback(
    (key: string, field: Immutable<SettingsTreeField>) => (
      <FieldEditor
        key={key}
        field={field}
        path={makeStablePath(props.path, key)}
        actionHandler={actionHandler}
      />
    ),
    [props.path, actionHandler],
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

  const preparedNodes = useMemo(() => prepareSettingsNodes(children ?? {}), [children]);

  const visibilityFilteredNodes = useMemo(() => {
    if (!filterFn) {
      return preparedNodes;
    }
    return preparedNodes.filter(([, child]) => filterFn(child));
  }, [preparedNodes, filterFn]);

  const filteredNodes = useMemo(() => {
    if (state.textFilter.length === 0) {
      return visibilityFilteredNodes;
    }
    const nodesRecord: Immutable<SettingsTreeNodes> = Object.fromEntries(visibilityFilteredNodes);
    return prepareSettingsNodes(filterTreeNodes(nodesRecord, state.textFilter));
  }, [visibilityFilteredNodes, state.textFilter]);

  const childNodes = useMemo(() => {
    return filterMap(filteredNodes, ([key, child]) => (
      <NodeEditor
        actionHandler={actionHandler}
        defaultOpen={child.defaultExpansionState !== "collapsed"}
        filter={filter}
        focusedPath={focusedPath}
        key={key}
        settings={child}
        path={makeStablePath(props.path, key)}
      />
    ));
  }, [filteredNodes, actionHandler, filter, focusedPath, props.path]);

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
    setState((draft) => {
      draft.editing = !draft.editing;
    });
  }, [setState]);

  const toggleOpen = useCallback(() => {
    setState((draft) => {
      if (!draft.editing) {
        draft.open = !draft.open;
      }
    });
  }, [setState]);

  const onLabelKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === "Escape") {
        toggleEditing();
      }
    },
    [toggleEditing],
  );

  const [inlineActions, menuActions] = useMemo(
    () =>
      _.partition(
        settings.actions,
        (action): action is SettingsTreeNodeActionItem =>
          action.type === "action" && action.display === "inline",
      ),
    [settings.actions],
  );

  const statusButton = renderSettingsStatusButton
    ? renderSettingsStatusButton(settings)
    : undefined;

  const isDragHandleIcon = settings.icon === "DragHandle" && isReorderable;

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

    if (IconComponent && !isDragHandleIcon) {
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

    return <></>;
  }, [IconComponent, classes.errorTooltip, props.settings?.error, theme, isDragHandleIcon]);

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
          [classes.nodeHeaderVisible]: visible,
          [classes.nodeHeaderDragging]: isDragging,
          [classes.nodeHeaderDropTarget]: isDropTarget,
        })}
        ref={headerRef}
        style={{
          opacity: isDragging ? 0.5 : 1,
          cursor: isReorderable ? "grab" : undefined,
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
              style={{ flex: "1 1 auto", fontWeight: indent < 2 ? 600 : 400 }}
            >
              <HighlightedText text={settings.label ?? t("general")} highlight={filter} />
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
          {statusButton ??
            (settings.visible != undefined && (
              <VisibilityToggle
                size="small"
                checked={visible}
                onChange={toggleVisibility}
                style={{ opacity: allowVisibilityToggle ? 1 : 0 }}
                disabled={!allowVisibilityToggle}
              />
            ))}
          {inlineActions.map((action) => {
            const Icon = action.icon ? icons[action.icon] : undefined;
            const handler = () => {
              actionHandler({
                action: "perform-node-action",
                payload: { id: action.id, path: props.path },
              });
            };
            return Icon ? (
              <IconButton
                key={action.id}
                onClick={handler}
                title={action.label}
                className={classes.actionButton}
              >
                <Icon fontSize="small" />
              </IconButton>
            ) : (
              <Button
                key={action.id}
                onClick={handler}
                size="small"
                color="inherit"
                className={classes.actionButton}
              >
                {action.label}
              </Button>
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
      {state.open && selectVisibilityFilterEnabled && hasChildren && (
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
      {state.open && childNodes}
      {indent === 1 && <Divider style={{ gridColumn: "span 2" }} />}
    </>
  );
}

export const NodeEditor = React.memo(NodeEditorComponent);
