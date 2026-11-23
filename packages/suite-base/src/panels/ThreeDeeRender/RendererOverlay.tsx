// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import RouteIcon from "@mui/icons-material/Route";
import {
  Button,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  useTheme,
} from "@mui/material";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useLongPress } from "@lichtblick/hooks";
import { LayoutActions } from "@lichtblick/suite";
import OverlayToolbar, {
  OverlayToolGroup,
  useIsShorterThan,
} from "@lichtblick/suite-base/components/OverlayToolbar";
import { usePanelButtonTitle } from "@lichtblick/suite-base/components/PanelButton";
import {
  PanelContextMenu,
  PanelContextMenuItem,
} from "@lichtblick/suite-base/components/PanelContextMenu";
import { PANEL_FLOATING_TOOLBAR_HEIGHT } from "@lichtblick/suite-base/components/PanelToolbar/constants";
import PublishGoalIcon from "@lichtblick/suite-base/components/PublishGoalIcon";
import PublishPointIcon from "@lichtblick/suite-base/components/PublishPointIcon";
import PublishPoseEstimateIcon from "@lichtblick/suite-base/components/PublishPoseEstimateIcon";
import { usePanelMousePresence } from "@lichtblick/suite-base/hooks/usePanelMousePresence";
import { HUD } from "@lichtblick/suite-base/panels/ThreeDeeRender/HUD";
import { shortcutLabel } from "@lichtblick/suite-base/util/keyboardShortcuts";
import { parseColor } from "@lichtblick/suite-base/util/parseColor";
import { customTypography } from "@lichtblick/theme";

import { FrameMeasureOverlay } from "./FrameMeasureOverlay";
import { InteractionContextMenu, Interactions, SelectionObject } from "./Interactions";
import { HoverTooltip } from "./Interactions/HoverTooltip";
import type { HoverEntityInfo } from "./Interactions/types";
import { MeasurePanel } from "./MeasurePanel";
import type { PickedRenderable } from "./Picker";
import type { Renderer } from "./Renderer";
import { useRenderer, useRendererEvent } from "./RendererContext";
import { Stats } from "./Stats";
import { IMAGE_BUTTONS, MeasureIcon, THREE_DEE_BUTTONS } from "./buttons";
import { PublishClickType } from "./renderables/PublishClickTool";
import { THREE_DEE_SHORTCUTS } from "./shortcuts";
import { InterfaceMode } from "./types";

const PublishClickIcons: Record<PublishClickType, React.ReactNode> = {
  pose: <PublishGoalIcon fontSize="small" />,
  point: <PublishPointIcon fontSize="small" />,
  pose_estimate: <PublishPoseEstimateIcon fontSize="small" />,
};

const useStyles = makeStyles()((theme) => ({
  root: {
    position: "absolute",
    top: `calc(10px + ${PANEL_FLOATING_TOOLBAR_HEIGHT})`,
    right: 10,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 10,
    pointerEvents: "none",
  },
  iconButton: {
    position: "relative",
    pointerEvents: "auto",
  },
  resetViewButton: {
    position: "absolute",
    bottom: 0,
    right: 0,
    marginBottom: theme.spacing(1),
    marginRight: theme.spacing(1),
  },
  kbd: {
    fontFamily: customTypography.fontMonospace,
    background: parseColor(theme.palette.common.white).darken(0.45).toHex(),
    padding: theme.spacing(0, 0.5),
    aspectRatio: 1,
    borderRadius: theme.shape.borderRadius,
    marginLeft: theme.spacing(1),
  },
  frameMeasure: {
    position: "absolute",
    left: theme.spacing(1),
    bottom: theme.spacing(1),
    pointerEvents: "none",
  },
}));

type Props = {
  addPanel: LayoutActions["addPanel"];
  canPublish: boolean;
  canvas: HTMLCanvasElement | null;
  enableStats: boolean;
  /** Show object details on hover; toggled with a shortcut */
  hoverInspector: boolean;
  interfaceMode: InterfaceMode;
  measureActive: boolean;
  onChangePublishClickType: (_: PublishClickType) => void;
  onClickMeasure: () => void;
  onClickPublish: () => void;
  onShowTopicSettings: (topic: string) => void;
  onTogglePerspective: () => void;
  perspective: boolean;
  publishActive: boolean;
  publishClickType: PublishClickType;
  timezone: string | undefined;
};

/**
 * Extracts metadata key-value pairs from a renderable's details object for hover tooltip display.
 */
function extractHoverMetadata(
  details: Record<string, unknown> | undefined,
): { key: string; value: string }[] {
  if (details == undefined) {
    return [];
  }

  const metadata: { key: string; value: string }[] = [];
  const entityMeta = details.metadata;
  if (Array.isArray(entityMeta)) {
    for (const metadataEntry of entityMeta) {
      if (
        metadataEntry != undefined &&
        typeof metadataEntry === "object" &&
        "key" in metadataEntry &&
        "value" in metadataEntry
      ) {
        metadata.push({
          key: String(metadataEntry.key),
          value: String(metadataEntry.value),
        });
      }
    }
  }
  // Then add any remaining top-level primitive fields (id, frame_id, etc.)
  for (const [fieldName, fieldValue] of Object.entries(details)) {
    if (
      fieldName !== "metadata" &&
      fieldValue != undefined &&
      (typeof fieldValue === "string" ||
        typeof fieldValue === "number" ||
        typeof fieldValue === "boolean")
    ) {
      metadata.push({ key: fieldName, value: String(fieldValue) });
    }
  }
  return metadata;
}

function hoverEntityId(pickedRenderable: PickedRenderable): string {
  const entityId = (pickedRenderable.renderable.userData as { entityId?: string }).entityId;
  if (entityId != undefined) {
    return entityId;
  }
  const name = pickedRenderable.renderable.name;
  if (name.length === 0) {
    return `object-${pickedRenderable.instanceIndex ?? 0}`;
  }
  return name;
}

const NO_ENTITIES: HoverEntityInfo[] = [];

/**
 * Owns the hover state, so pointer moves re-render only the tooltip and not the whole overlay.
 * While nothing is hovered, the cursor position is kept in a ref without rendering at all.
 */
function RendererHoverTooltip({ canvas }: { canvas: HTMLCanvasElement | null }): React.JSX.Element {
  const renderer = useRenderer();
  const [entities, setEntities] = useState(NO_ENTITIES);
  const [position, setPosition] = useState({ clientX: 0, clientY: 0 });
  const latestPosition = useRef(position);
  const hasEntities = entities.length > 0;

  useEffect(() => {
    // Hovered objects belong to the previous renderer
    setEntities(NO_ENTITIES);
  }, [renderer]);

  // Follow the cursor at full frame rate, but only while there is a tooltip to move
  useRendererEvent(
    "hoverMoved",
    useCallback(
      (cursorCoords) => {
        const rect = canvas?.getBoundingClientRect();
        if (rect) {
          latestPosition.current = {
            clientX: rect.left + cursorCoords.x,
            clientY: rect.top + cursorCoords.y,
          };
          if (hasEntities) {
            setPosition(latestPosition.current);
          }
        }
      },
      [canvas, hasEntities],
    ),
  );

  useRendererEvent(
    "renderableHovered",
    useCallback((selections) => {
      const infos: HoverEntityInfo[] = [];
      for (const pickedRenderable of selections) {
        const topic = pickedRenderable.renderable.topic;
        const details: Record<string, unknown> | undefined =
          pickedRenderable.instanceIndex == undefined
            ? pickedRenderable.renderable.details()
            : pickedRenderable.renderable.instanceDetails(pickedRenderable.instanceIndex);

        const metadata = extractHoverMetadata(details);

        // Avoid showing tooltips for non-user-facing objects when hovering empty space.
        // If a renderable has no associated topic and no metadata, it doesn't provide useful info.
        if (topic == undefined && metadata.length === 0) {
          continue;
        }

        infos.push({ topic, entityId: hoverEntityId(pickedRenderable), metadata });
      }
      // Hovering empty space repeats an empty pick; keep the same array so nothing re-renders
      setEntities((previous) => (infos.length === 0 && previous.length === 0 ? previous : infos));
      if (infos.length > 0) {
        setPosition(latestPosition.current);
      }
    }, []),
  );

  return <HoverTooltip entities={entities} position={position} canvas={canvas} />;
}

/**
 * Provides DOM overlay elements on top of the 3D scene (e.g. stats, debug GUI).
 *
 * Memoized: the panel re-renders on every frame, and the overlay's toolbars and hover tooltip
 * (MUI buttons and tooltips) change only with their own props and renderer events.
 */
export const RendererOverlay = memo(function RendererOverlay(
  props: Readonly<Props>,
): React.JSX.Element {
  const { t } = useTranslation("threeDee");
  const { classes } = useStyles();
  const [clickedPosition, setClickedPosition] = useState<{
    clientX: number;
    clientY: number;
  }>({
    clientX: 0,
    clientY: 0,
  });
  const [selectedRenderables, setSelectedRenderables] = useState<PickedRenderable[]>([]);
  const [selectedRenderable, setSelectedRenderable] = useState<PickedRenderable | undefined>(
    undefined,
  );
  const [inspecting, setInspecting] = useState(false);
  const renderer = useRenderer();
  // The fixed frame appears once transforms arrive; the overlay re-renders only when that changes
  const [hasFixedFrame, setHasFixedFrame] = useState(renderer?.fixedFrameId != undefined);
  useEffect(() => {
    setHasFixedFrame(renderer?.fixedFrameId != undefined);
  }, [renderer]);
  useRendererEvent(
    "endFrame",
    useCallback((_currentTime: bigint, frameRenderer: Renderer) => {
      setHasFixedFrame(frameRenderer.fixedFrameId != undefined);
    }, []),
  );

  useEffect(() => {
    // Selections refer to objects owned by the previous renderer.
    setSelectedRenderables([]);
    setSelectedRenderable(undefined);
  }, [renderer]);

  // Toggle object selection mode on/off in the renderer
  useEffect(() => {
    if (renderer) {
      renderer.setPickingEnabled(inspecting);
    }
  }, [inspecting, renderer]);

  useRendererEvent(
    "renderablesClicked",
    useCallback(
      (selections, cursorCoords) => {
        const rect = props.canvas?.getBoundingClientRect();
        if (rect) {
          setClickedPosition({
            clientX: rect.left + cursorCoords.x,
            clientY: rect.top + cursorCoords.y,
          });
        }
        setSelectedRenderables(selections);
        setSelectedRenderable(selections.length === 1 ? selections[0] : undefined);
      },
      [props.canvas],
    ),
  );

  const [framePicking, setFramePicking] = useState(false);
  const stopFramePicking = useCallback(() => {
    setFramePicking(false);
  }, []);
  // Point measuring, publishing and frame picking all take over clicks; only one at a time
  useEffect(() => {
    if (props.measureActive || props.publishActive) {
      setFramePicking(false);
    }
  }, [props.measureActive, props.publishActive]);

  const [showResetViewButton, setShowResetViewButton] = useState(renderer?.canResetView() ?? false);
  useRendererEvent(
    "resetViewChanged",
    useCallback(() => {
      setShowResetViewButton(renderer?.canResetView() ?? false);
    }, [renderer]),
  );
  const onResetView = useCallback(() => {
    renderer?.resetView();
  }, [renderer]);

  const stats = props.enableStats ? (
    <div
      id="stats"
      style={{
        position: "absolute",
        top: `calc(10px + ${PANEL_FLOATING_TOOLBAR_HEIGHT})`,
        left: "10px",
      }}
    >
      <Stats />
    </div>
  ) : undefined;

  // Once a single renderable is selected, convert it to the SelectionObject
  // format to populate the object inspection dialog (<Interactions>)
  const selectedObject = useMemo<SelectionObject | undefined>(
    () =>
      selectedRenderable
        ? {
            object: {
              pose: selectedRenderable.renderable.pose,
              interactionData: {
                topic: selectedRenderable.renderable.topic,
                highlighted: true,
                originalMessage: selectedRenderable.renderable.details(),
                instanceDetails:
                  selectedRenderable.instanceIndex != undefined
                    ? selectedRenderable.renderable.instanceDetails(
                        selectedRenderable.instanceIndex,
                      )
                    : undefined,
              },
            },
            instanceIndex: selectedRenderable.instanceIndex,
          }
        : undefined,
    [selectedRenderable],
  );

  // Inform the Renderer when a renderable is selected
  useEffect(() => {
    renderer?.setSelectedRenderable(selectedRenderable);
  }, [renderer, selectedRenderable]);

  const publishClickButtonRef = useRef<HTMLButtonElement>(null);
  const [publishMenuExpanded, setPublishMenuExpanded] = useState(false);
  const selectedPublishClickIcon = PublishClickIcons[props.publishClickType];

  const onLongPressPublish = useCallback(() => {
    setPublishMenuExpanded(true);
  }, []);
  const longPressPublishEvent = useLongPress(onLongPressPublish);

  const theme = useTheme();
  const publishTitle = usePanelButtonTitle(THREE_DEE_BUTTONS.publish);
  const perspectiveTitle = usePanelButtonTitle(THREE_DEE_BUTTONS.perspective);
  const zoomToDataTitle = usePanelButtonTitle(THREE_DEE_BUTTONS.zoomToData);
  const measureTitle = usePanelButtonTitle(THREE_DEE_BUTTONS.measure);
  const measureFramesTitle = usePanelButtonTitle(THREE_DEE_BUTTONS.measureFrames);
  const downloadTitle = usePanelButtonTitle(IMAGE_BUTTONS.download);
  const resetViewTitle = usePanelButtonTitle(IMAGE_BUTTONS.resetView);
  const publishLabel = props.publishActive ? t("clickToCancel") : publishTitle;
  const perspectiveLabel = t(props.perspective ? "switchTo2DCamera" : "switchTo3DCamera");
  const perspectiveKey = shortcutLabel(THREE_DEE_SHORTCUTS, "3d.togglePerspective");
  const ResetViewLabel = IMAGE_BUTTONS.resetView.icon;
  const DownloadIcon = IMAGE_BUTTONS.download.icon;
  const PerspectiveIcon = THREE_DEE_BUTTONS.perspective.icon;
  const ZoomToDataIcon = THREE_DEE_BUTTONS.zoomToData.icon;
  const MeasureFramesIcon = THREE_DEE_BUTTONS.measureFrames.icon;

  // Publish control is only available if the canPublish prop is true and we have a fixed frame in the renderer
  const showPublishControl = props.interfaceMode === "3d" && props.canPublish && hasFixedFrame;
  const publishControls = showPublishControl && (
    <>
      <Tooltip placement="left" title={publishLabel}>
        <IconButton
          {...longPressPublishEvent}
          className={classes.iconButton}
          size="small"
          aria-pressed={props.publishActive}
          ref={publishClickButtonRef}
          onClick={props.onClickPublish}
          aria-label={publishTitle}
          data-testid="publish-button"
        >
          {selectedPublishClickIcon}
          <div
            style={{
              borderBottom: "6px solid currentColor",
              borderRight: "6px solid transparent",
              bottom: 0,
              left: 0,
              height: 0,
              width: 0,
              margin: theme.spacing(0.25),
              position: "absolute",
            }}
          />
        </IconButton>
      </Tooltip>
      <Menu
        id="publish-menu"
        anchorEl={publishClickButtonRef.current}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        open={publishMenuExpanded}
        onClose={() => {
          setPublishMenuExpanded(false);
        }}
        slotProps={{ list: { dense: true } }}
      >
        <MenuItem
          selected={props.publishClickType === "pose_estimate"}
          onClick={() => {
            props.onChangePublishClickType("pose_estimate");
            setPublishMenuExpanded(false);
          }}
        >
          <ListItemIcon>{PublishClickIcons.pose_estimate}</ListItemIcon>
          <ListItemText disableTypography>Publish pose estimate</ListItemText>
        </MenuItem>
        <MenuItem
          selected={props.publishClickType === "pose"}
          onClick={() => {
            props.onChangePublishClickType("pose");
            setPublishMenuExpanded(false);
          }}
        >
          <ListItemIcon>{PublishClickIcons.pose}</ListItemIcon>
          <ListItemText disableTypography>Publish pose</ListItemText>
        </MenuItem>
        <MenuItem
          selected={props.publishClickType === "point"}
          onClick={() => {
            props.onChangePublishClickType("point");
            setPublishMenuExpanded(false);
          }}
        >
          <ListItemIcon>{PublishClickIcons.point}</ListItemIcon>
          <ListItemText disableTypography>Publish point</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );

  const resetViewButton = showResetViewButton && (
    <OverlayToolbar className={classes.resetViewButton}>
      <Button
        color="inherit"
        onClick={onResetView}
        data-testid="reset-view"
        aria-label={resetViewTitle}
      >
        <ResetViewLabel />
      </Button>
    </OverlayToolbar>
  );

  const getContextMenuItems = useCallback((): PanelContextMenuItem[] => {
    return renderer?.getContextMenuItems() ?? [];
  }, [renderer]);

  // Same action as the "Download image" context menu item, surfaced as a toolbar button
  const onDownloadImage = useCallback(() => {
    const item = getContextMenuItems().find(
      (menuItem) => menuItem.type === "item" && menuItem.label === t("downloadImage"),
    );
    if (item?.type === "item" && item.disabled !== true) {
      item.onclick();
    }
  }, [getContextMenuItems, t]);

  // Below this canvas height the measuring buttons fold into one, so the column fits.
  const foldMeasureTools = useIsShorterThan(props.canvas, 300);

  const mousePresenceRef = useRef<HTMLDivElement>(null);
  const mousePresent = usePanelMousePresence(mousePresenceRef);

  return (
    <>
      {props.interfaceMode === "image" && <PanelContextMenu getItems={getContextMenuItems} />}
      <div ref={mousePresenceRef} className={classes.root}>
        {
          // Only show on hover for image panel
          (props.interfaceMode === "3d" || mousePresent) && (
            <Interactions
              addPanel={props.addPanel}
              inspecting={inspecting}
              onShowTopicSettings={props.onShowTopicSettings}
              selectedObject={selectedObject}
              onToggleInspecting={() => {
                setInspecting((old) => !old);
              }}
              timezone={props.timezone}
              toolbarItems={
                props.interfaceMode === "image" ? (
                  <Tooltip placement="left" title={downloadTitle}>
                    <IconButton
                      data-testid="download-image-button"
                      aria-label={downloadTitle}
                      className={classes.iconButton}
                      size="small"
                      onClick={onDownloadImage}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <>
                    <Tooltip
                      placement="left"
                      describeChild
                      title={
                        <>
                          {perspectiveLabel}{" "}
                          {perspectiveKey != undefined && (
                            <kbd className={classes.kbd}>{perspectiveKey}</kbd>
                          )}
                        </>
                      }
                    >
                      <IconButton
                        className={classes.iconButton}
                        size="small"
                        aria-pressed={props.perspective}
                        aria-label={perspectiveTitle}
                        onClick={props.onTogglePerspective}
                      >
                        <PerspectiveIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip placement="left" title={zoomToDataTitle}>
                      <IconButton
                        aria-label={zoomToDataTitle}
                        className={classes.iconButton}
                        size="small"
                        onClick={() => renderer?.zoomToData()}
                      >
                        <ZoomToDataIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <OverlayToolGroup
                      collapsed={foldMeasureTools}
                      label={measureTitle}
                      icon={
                        framePicking ? (
                          <RouteIcon fontSize="small" />
                        ) : (
                          <MeasureIcon filled={props.measureActive} />
                        )
                      }
                      active={props.measureActive || framePicking}
                    >
                      <Tooltip
                        placement="left"
                        title={props.measureActive ? t("stopMeasuring") : measureTitle}
                      >
                        <IconButton
                          data-testid="measure-button"
                          aria-label={measureTitle}
                          className={classes.iconButton}
                          size="small"
                          aria-pressed={props.measureActive}
                          onClick={props.onClickMeasure}
                        >
                          <MeasureIcon filled={props.measureActive} />
                        </IconButton>
                      </Tooltip>

                      <Tooltip
                        placement="left"
                        title={framePicking ? t("stopMeasuringFrames") : measureFramesTitle}
                      >
                        <IconButton
                          data-testid="measure-frames-button"
                          aria-label={measureFramesTitle}
                          className={classes.iconButton}
                          size="small"
                          aria-pressed={framePicking}
                          onClick={() => {
                            if (!framePicking && props.measureActive) {
                              props.onClickMeasure();
                            }
                            if (!framePicking && props.publishActive) {
                              props.onClickPublish();
                            }
                            setFramePicking(!framePicking);
                          }}
                        >
                          {framePicking ? (
                            <RouteIcon fontSize="small" />
                          ) : (
                            <MeasureFramesIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                    </OverlayToolGroup>

                    {publishControls}
                  </>
                )
              }
            />
          )
        }
      </div>
      {selectedRenderables.length > 1 && !selectedObject && (
        <InteractionContextMenu
          onClose={() => {
            setSelectedRenderables([]);
          }}
          clickedPosition={clickedPosition}
          clickedObjects={selectedRenderables}
          selectObject={(selection) => {
            setSelectedRenderables([]);
            setSelectedRenderable(selection);
          }}
        />
      )}
      {props.interfaceMode === "3d" && props.measureActive && renderer && (
        <MeasurePanel renderer={renderer} />
      )}
      {props.interfaceMode === "3d" && renderer && (
        <div
          className={classes.frameMeasure}
          style={props.measureActive ? { left: 296 } : undefined}
        >
          <FrameMeasureOverlay
            renderer={renderer}
            picking={framePicking}
            onStopPicking={stopFramePicking}
          />
        </div>
      )}
      <HUD renderer={renderer} />
      {props.hoverInspector && <RendererHoverTooltip canvas={props.canvas} />}
      {stats}
      {resetViewButton}
    </>
  );
});
