// SPDX-License-Identifier: MPL-2.0

import {
  KeyboardShortcut,
  KeyEventLike,
  matchesCombo,
} from "@lichtblick/suite-base/util/keyboardShortcuts";

const ARROWS = [
  { key: "ArrowUp" },
  { key: "ArrowDown" },
  { key: "ArrowLeft" },
  { key: "ArrowRight" },
] as const;

/** Object inspection, shared by the 3D and Image panels. Escape is bound in HoverTooltip. */
const INSPECT_SHORTCUTS = [
  { id: "3d.hoverObject", titleKey: "inspectHover", keys: [], mouse: [{ action: "hover" }] },
  { id: "3d.selectObject", titleKey: "inspectSelect", keys: [], mouse: [{ action: "click" }] },
  { id: "3d.pinDetails", titleKey: "pinHoverDetails", keys: [], mouse: [{ action: "click" }] },
  { id: "3d.closeDetails", titleKey: "closeHoverDetails", keys: [{ key: "Escape" }] },
] as const satisfies readonly KeyboardShortcut[];

/**
 * Bound from this list: the perspective toggle, recentering and the hover inspector toggle (ThreeDeeRender), frame offsets (FrameAxes),
 * measuring keys (MeasurementTool, FrameMeasureOverlay) and closing hover details (HoverTooltip).
 * Display only: camera keys (three.js OrbitControls, configured by DEFAULT_ORBIT_CONTROLS_CONFIG
 * in camera.ts) and all mouse gestures (pointer handlers of the renderer and its renderables).
 */
export const THREE_DEE_SHORTCUTS = [
  { id: "3d.togglePerspective", titleKey: "togglePerspective", keys: [{ key: "3" }] },
  { id: "3d.recenter", titleKey: "recenterCamera", keys: [{ key: "1" }] },
  {
    id: "3d.pan",
    titleKey: "moveCamera",
    keys: [{ key: "w" }, { key: "a" }, { key: "s" }, { key: "d" }],
    mouse: [{ action: "drag" }, { action: "two-finger-scroll" }],
  },
  {
    id: "3d.screenSpacePan",
    titleKey: "screenSpacePan",
    keys: [],
    mouse: [{ action: "drag", alt: true }],
  },
  {
    id: "3d.rotate",
    titleKey: "rotateCamera",
    keys: [
      { key: "w", shift: true },
      { key: "a", shift: true },
      { key: "s", shift: true },
      { key: "d", shift: true },
    ],
    mouse: [
      { action: "drag", button: "right" },
      { action: "two-finger-scroll", alt: true },
    ],
  },
  {
    id: "3d.zoom",
    titleKey: "zoomCamera",
    keys: [],
    mouse: [{ action: "scroll" }, { action: "pinch" }, { action: "drag", button: "middle" }],
  },
  { id: "3d.dropTopic", titleKey: "dropTopicToShow", keys: [], mouse: [{ action: "drop" }] },
  ...INSPECT_SHORTCUTS,
  { id: "3d.toggleInspector", titleKey: "toggleHoverInspector", keys: [{ key: "i" }] },
  {
    id: "3d.toggleOriginal",
    titleKey: "toggleOriginalTransforms",
    keys: [{ key: "o", alt: false }],
  },
  {
    id: "3d.undoOffset",
    titleKey: "undoTransformOffset",
    keys: [{ key: "z", mod: true, shift: false }],
  },
  {
    id: "3d.nudgeFrame",
    titleKey: "nudgeFrame",
    keys: [...ARROWS, { key: "PageUp" }, { key: "PageDown" }],
  },
  {
    id: "3d.placePoint",
    titleKey: "placeMeasurementPoint",
    keys: [],
    mouse: [{ action: "click" }],
  },
  {
    id: "3d.finishMeasurement",
    titleKey: "finishMeasurement",
    keys: [{ key: "Escape" }],
    mouse: [{ action: "click", button: "right" }],
  },
  { id: "3d.movePoint", titleKey: "moveMeasurementPoint", keys: [], mouse: [{ action: "drag" }] },
  {
    id: "3d.deleteMeasurement",
    titleKey: "deleteMeasurement",
    keys: [{ key: "Backspace" }, { key: "Delete" }],
  },
  { id: "3d.pickFrame", titleKey: "pickMeasureFrame", keys: [], mouse: [{ action: "click" }] },
  { id: "3d.publishAt", titleKey: "publishAtPoint", keys: [], mouse: [{ action: "click" }] },
  {
    id: "3d.choosePublishType",
    titleKey: "choosePublishType",
    keys: [],
    mouse: [{ action: "long-press" }],
  },
] as const satisfies readonly KeyboardShortcut[];

/** Display only: pan and zoom are handled by ImageMode, the menu by PanelContextMenu. */
export const IMAGE_SHORTCUTS = [
  { id: "image.pan", titleKey: "imagePan", keys: [], mouse: [{ action: "drag" }] },
  { id: "image.zoom", titleKey: "imageZoom", keys: [], mouse: [{ action: "scroll" }] },
  {
    id: "image.menu",
    titleKey: "imageMenu",
    keys: [],
    mouse: [{ action: "click", button: "right" }],
  },
  { id: "image.dropTopic", titleKey: "imageDropTopic", keys: [], mouse: [{ action: "drop" }] },
  ...INSPECT_SHORTCUTS,
] as const satisfies readonly KeyboardShortcut[];

type ThreeDeeShortcutId = (typeof THREE_DEE_SHORTCUTS)[number]["id"];

/**
 * Whether the event matches a binding of one declared 3D shortcut. Checked per action rather than
 * with findShortcut, since several actions share Escape and each handler is active in its own mode.
 */
export function isThreeDeeShortcut(id: ThreeDeeShortcutId, event: KeyEventLike): boolean {
  return THREE_DEE_SHORTCUTS.some(
    (shortcut) => shortcut.id === id && shortcut.keys.some((combo) => matchesCombo(event, combo)),
  );
}
