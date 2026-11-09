// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const threeDee = {
  // Common
  color: "Color",
  colorMode: "Color mode",
  frame: "Frame",
  locationFrame: "Location frame",
  mapWaitingForView:
    "Map: waiting for a location transform and a perspective view above the ground",
  mapPerspectiveRequired: "Map is hidden in orthographic view. Switch to perspective to show it.",
  mapUnavailable: "Map is unavailable because its graphics context could not be initialized.",
  mapSingleLayer:
    "Only one geographic map can be displayed. Add map sources to the same map layer.",
  locationFrameFromMessage: "From message",
  locationFrameHelp:
    "Frame of the GPS receiver. For the nuScenes sample, use base_link and keep the ENU frame set to map.",
  lineWidth: "Line width",
  position: "Position",
  reset: "Reset",
  zoomToData: "Zoom to data",
  rotation: "Rotation",
  scale: "Scale",
  gradient: "Gradient",
  type: "Type",
  topic: "Topic",

  // WebGL context loss
  graphicsContextLost: "Graphics context lost",
  graphicsContextRestoring: "Graphics context lost — restoring…",
  restoreGraphics: "Restore",

  // Frame
  age: "Age",
  axisScale: "Axis scale",
  displayFrame: "Display frame",
  displayFrameHelp:
    "The coordinate frame to place the camera in. The camera position and orientation will be relative to the origin of this frame.",
  editable: "Editable",
  enablePreloading: "Enable preloading",
  enablePreloadingTooltip:
    "Load transforms for the whole recording so frames are correct right after seeking. Turn off to save memory on very large recordings.",
  maxPreloadMessages: "Max preload messages",
  maxPreloadMessagesTooltip:
    "Maximum number of transform messages to keep in memory when preloading is enabled. Higher values provide more history but use more memory.",
  clearPreloadBuffer: "Clear preload buffer",
  transformPreloadTruncatedAlert: "{{count}} transform messages not preloaded",
  transformPreloadTruncatedAlertTip:
    'The preload buffer is full, so transforms near the end of the recording may be wrong after seeking. Raise "Max preload messages" in Transforms settings.',
  fixed: "Fixed",
  followMode: "Follow mode",
  followModeHelp: "Change the camera behavior during playback to follow the display frame or not.",
  frameNotFound: "Frame {{frameId}} not found",
  hideAll: "Hide all",
  historySize: "History size",
  labels: "Labels",
  labelSize: "Label size",
  lineColor: "Line color",
  noCoordinateFramesFound: "No coordinate frames found",
  parent: "Parent",
  pose: "Pose",
  rotationOffset: "Rotation offset",
  settings: "Settings",
  showAll: "Show all",
  transforms: "Transforms",
  translation: "Translation",
  translationOffset: "Translation offset",
  translationOffsetHelp: "Added to the recorded translation, along the parent frame's axes (m)",
  rotationOffsetHelp:
    "Rotation applied after the recorded rotation, around the frame's own origin.",
  recordedTranslation: "Recorded translation",
  recordedRotation: "Recorded rotation",
  rotationConvention: "Rotation angles",
  rotationConventionExtrinsic: "Extrinsic xyz (ROS, fixed axes)",
  rotationConventionIntrinsic: "Intrinsic XYZ (own axes)",
  rotationConventionHelpExtrinsic:
    "Roll, pitch and yaw in degrees around the parent's fixed axes: x, then y, then z (extrinsic xyz, as in tf2 getRPY and URDF rpy).",
  rotationConventionHelpIntrinsic:
    "Roll, pitch and yaw in degrees around the frame's own axes: X, then Y, then Z, each turn on the already rotated axes (intrinsic XYZ).",
  resultTranslation: "Result translation",
  resultRotation: "Result rotation",
  resultHelp: "Recorded transform plus offset: what is rendered. Type a value to set it directly.",
  adjusted: "adjusted",
  adjustStep: "Adjust step",
  adjustStepFine: "Fine (1 mm, 0.01°)",
  adjustStepMedium: "Medium (1 cm, 0.1°)",
  adjustStepCoarse: "Coarse (10 cm, 1°)",
  keyboardFrame: "Keyboard adjusts",
  keyboardFrameHelp:
    "With the pointer over the panel, keys step the result values: arrows move X/Y, PageUp/PageDown move Z, hold Alt to change pitch/yaw/roll, Shift for 10× steps, O shows the original, Ctrl/Cmd+Z undoes",
  keyboardFrameNone: "None",
  showOriginal: "Show original",
  showOriginalHelp:
    "Render recorded transforms without adjustments, in every panel of this layout (key: O)",
  adjustWithKeyboard: "Adjust with keyboard",
  resetAdjustment: "Reset adjustment",
  resetAllAdjustments: "Reset all adjustments",
  undoAdjustment: "Undo adjustment",
  copyAsUrdf: "Copy result as URDF joint",
  copyAsStaticTransformPublisher: "Copy result as static_transform_publisher",
  copyAsYaml: "Copy result as YAML",
  keyboardHud:
    "Adjusting {{frame}} · arrows, PgUp/PgDn move · Alt rotates · Shift ×10 · O original · Ctrl/Cmd+Z undo",
  showingOriginalHud: "Showing recorded transforms without adjustments · press O to switch back",

  // Scene
  background: "Background",
  debugPicking: "Debug picking",
  ignoreColladaUpAxis: "Ignore COLLADA <up_axis>",
  ignoreColladaUpAxisHelp:
    "Match the behavior of rviz by ignoring the <up_axis> tag in COLLADA files",
  labelScale: "Label scale",
  labelScaleHelp: "Scale factor to apply to all labels",
  meshUpAxis: "Mesh up axis",
  meshUpAxisHelp: "The direction to use as “up” when loading STL, OBJ and glTF meshes",
  renderStats: "Render stats",
  scene: "Scene",
  takeEffectAfterReboot: "This setting requires a restart to take effect",
  YUp: "Y-up",
  ZUp: "Z-up",

  // Lighting
  mainLightMode: "Main light",
  mainLightModeHelp:
    "Fixed uses a world-space directional light. Headlight attaches the light to the camera so the scene is always lit from the viewer's perspective (similar to RViz).",
  mainLightFixed: "Fixed (scene)",
  mainLightHeadlight: "Headlight (camera)",
  directionalLightIntensity: "Directional light intensity",
  hemisphereLightIntensity: "Hemisphere light intensity",

  // Camera
  distance: "Distance",
  far: "Far",
  fovy: "Y-Axis FOV",
  near: "Near",
  perspective: "Perspective",
  phi: "Phi",
  planarProjectionFactor: "Planar projection factor",
  syncCamera: "Sync camera",
  syncCameraHelp: "Sync the camera with other panels that also have this setting enabled.",
  target: "Target",
  theta: "Theta",
  view: "View",

  // Topics
  topics: "Topics",

  // Custom layers
  addGrid: "Add Grid",
  addMap: "Add Map",
  addURDF: "Add URDF",
  customLayers: "Custom layers",
  delete: "Delete",
  divisions: "Divisions",
  grid: "Grid",
  size: "Size",

  // Image annotations
  imageAnnotations: "Image annotations",
  resetView: "Reset view",
  downloadImage: "Download image",

  // Images
  cameraInfo: "Camera info",

  // Occupancy Grids
  colorModeCustom: "Custom",
  colorModeRaw: "Raw",
  colorModeRvizCostmap: "Costmap",
  colorModeRvizMap: "Map",
  frameLock: "Frame lock",
  invalidColor: "Invalid color",
  maxColor: "Max color",
  minColor: "Min color",
  unknownColor: "Unknown color",

  // Point Extension Utils
  decayTime: "Decay time",
  decayTimeDefaultZeroSeconds: "0 seconds",
  pointShape: "Point shape",
  pointShapeCircle: "Circle",
  pointShapeSquare: "Square",
  pointShapeCube: "Cube",
  cubeSize: "Cube size (m)",
  pointSize: "Point size",

  // Color Mode
  colorBy: "Color by",
  colorModeBgraPacked: "BGRA (packed)",
  colorModeBgrPacked: "BGR (packed)",
  colorModeColorMap: "Color map",
  colorModeFlat: "Flat",
  colorModeRgbaSeparateFields: "RGBA (separate fields)",
  ColorFieldComputedDistance: "distance (auto)",
  flatColor: "Flat color",
  opacity: "Opacity",
  valueMax: "Value max",
  valueMin: "Value min",

  // Markers
  selectionVariable: "Selection variable",
  selectionVariableHelp:
    "When selecting a marker, this global variable will be set to the marker ID",
  showOutline: "Show outline",

  // Poses
  covariance: "Covariance",
  covarianceColor: "Covariance color",
  poseDisplayTypeArrow: "Arrow",
  poseDisplayTypeAxis: "Axis",
  poseDisplayTypeLine: "Line",

  // Publish
  publish: "Publish",
  publishTopicHelp: "The topic on which to publish",
  publishTypeHelp: "The type of message to publish when clicking in the scene",
  publishTypePoint: "Point (geometry_msgs/Point)",
  publishTypePose: "Pose (geometry_msgs/PoseStamped)",
  publishTypePoseEstimate: "Pose estimate (geometry_msgs/PoseWithCovarianceStamped)",
  thetaDeviation: "Theta deviation",
  thetaDeviationHelp: "The theta standard deviation to publish with pose estimates",
  xDeviation: "X deviation",
  xDeviationHelp: "The X standard deviation to publish with pose estimates",
  yDeviation: "Y deviation",
  yDeviationHelp: "The Y standard deviation to publish with pose estimates",

  // HUD Items and empty states
  noImageTopicsAvailable: "No image topics available.",
  imageTopicDNE: "Image topic does not exist.",
  calibrationTopicDNE: "Calibration topic does not exist.",
  imageAndCalibrationDNE: "Image and calibration topics do not exist.",
  waitingForCalibrationAndImages: "Waiting for messages…",
  waitingForCalibration: "Waiting for calibration messages…",
  waitingForImages: "Waiting for image messages…",
  waitingForSyncAnnotations: "Waiting for synchronized annotations…",

  // Measurement tool
  measure: "Measure",
  stopMeasuring: "Stop measuring",
  measurePoint: "Point",
  measureDistance: "Distance",
  measurePolyline: "Polyline",
  measureAngle: "Angle",
  measureArea: "Area",
  measureHeight: "Height",
  measureProfile: "Height profile",
  measureHelp:
    "Click to place points. Right-click or Esc finishes, Backspace undoes a point. Drag points to edit; Del removes the selected measurement.",
  measureResultsIn: "Results in",
  measureDisplayFrame: "Display frame",
  measureFrame: "Frame",
  measureMissingTransform: "— (missing transform {{frame}})",
  measureTransformUnavailable: "— (transform unavailable)",
  measureCopy: "Copy",
  measureDelete: "Delete",
  measureCopyAll: "Copy all",
  measureClearAll: "Clear all",
  // Frame-to-frame measurement
  measureFrames: "Measure between frames",
  stopMeasuringFrames: "Stop picking frames",
  frameMeasureTitle: "Frame to frame",
  frameMeasureFrom: "From",
  frameMeasureTo: "To",
  frameMeasureSwap: "Swap From and To",
  frameMeasureClose: "Close",
  frameMeasureCopy: "Copy values",
  frameMeasurePickHelp: "Click a frame's axes or label to pick {{end}}.",
  frameMeasureChooseHelp: "Choose From and To frames.",
  frameMeasureMissingFrame: "No transform for {{frame}} at the current time.",
  frameMeasureNotConnected: "No transform between {{a}} and {{b}}: they are in separate trees.",
  frameMeasureUnavailable: "Transform unavailable at the current time.",
  frameMeasureDistance: "Distance",
  frameMeasureTranslation: "Translation (m)",
  frameMeasureRotation: "Rotation",
  frameMeasureRotationFormat: "Rotation format",
  frameMeasureDegrees: "Roll/pitch/yaw (°)",
  frameMeasureRadians: "Roll/pitch/yaw (rad)",
  frameMeasureQuaternion: "Quaternion (xyzw)",
  frameMeasureConvention: "Rotation angles",
  frameMeasureExtrinsic: "extrinsic",
  frameMeasureIntrinsic: "intrinsic",
  frameMeasureConventionExtrinsic:
    "Roll, pitch and yaw turn around From's fixed axes: x, then y, then z (extrinsic xyz, as in tf2 getRPY and URDF rpy).",
  frameMeasureConventionIntrinsic:
    "Roll, pitch and yaw turn around the frame's own axes: X, then Y, then Z, each turn on the already rotated axes (intrinsic XYZ).",
  frameMeasureFromBadge: "from",
  frameMeasureToBadge: "to",
  frameMeasureFromHere: "Measure from here",
  frameMeasureToHere: "Measure to here",
};
