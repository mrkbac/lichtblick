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
  locationFrameHelp: "Frame of the GPS receiver.",
  lineWidth: "Line width",
  position: "Position",
  reset: "Reset",
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
  keyboardFrameHelp: "Frame that keyboard adjustments move while the pointer is over the panel.",
  keyboardFrameNone: "None",
  showOriginal: "Show original",
  showOriginalHelp: "Render recorded transforms without adjustments, in every panel of this layout",
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
  syncTimestamps: "Sync timestamps",
  syncTimestampsHelp:
    "Only show messages whose timestamps match across all topics marked Sync. Each topic then shows its newest message from the newest matching set. Transforms and robot models are never held back.",
  syncTopic: "Sync",
  syncTopicHelp:
    "Hold back this topic's messages until every topic marked Sync has one with the same message timestamp (or log time when the message has none). Needs at least two topics.",
  waitingForSyncMessages: "Waiting for synchronized messages…",
  target: "Target",
  theta: "Theta",
  view: "View",

  // Topics
  topics: "Topics",

  // Settings help (one sentence per field, shown on hover and in the panel guide)
  topicsHelp:
    "Every topic this panel can show. Toggle visibility here and expand a topic for its settings.",
  customLayersHelp: "Grids, robot models and maps that don't come from a topic.",
  transformsHelp:
    "Coordinate frames from transform messages. Toggle a frame's axes, inspect or adjust its transform.",
  imageAnnotationsHelp: "Annotation topics drawn over the image.",
  renderStatsHelp: "Shows rendering statistics such as the frame rate over the scene.",
  debugPickingHelp:
    "Renders the buffer used to pick objects instead of the scene, to debug selection.",
  backgroundHelp: "Scene background color. Empty follows the app's light or dark theme.",
  directionalLightIntensityHelp: "Brightness of the main light.",
  hemisphereLightIntensityHelp: "Brightness of the ambient sky and ground light.",
  cameraDistanceHelp: "Distance from the camera to its target, in meters.",
  perspectiveHelp: "Perspective 3D view. Off shows an orthographic top-down view.",
  targetHelp: "Point the camera looks at, offset from the display frame's origin (m).",
  thetaHelp: "Camera rotation around the vertical axis, in degrees.",
  phiHelp: "Camera tilt from straight down, in degrees.",
  fovyHelp: "Vertical field of view, in degrees.",
  nearHelp: "Closest distance drawn. Anything nearer the camera is cut off.",
  farHelp: "Farthest distance drawn. Anything beyond is cut off.",
  logDepth: "Log depth",
  logDepthHelp:
    "Spreads depth precision evenly from near to far, which stops distant surfaces from flickering through each other. Can be slower and cause artifacts on some objects.",
  editableHelp: "Lets you offset each frame's translation and rotation.",
  adjustStepHelp: "Step size of the offset inputs and keyboard adjustments.",
  frameLabelsHelp: "Shows each frame's name next to its axes.",
  frameLabelSizeHelp: "Height of the frame name labels.",
  frameAxisScaleHelp: "Size of each frame's axes.",
  frameLineWidthHelp: "Width in pixels of the line from each frame to its parent.",
  frameLineColorHelp: "Color of the line from each frame to its parent.",
  parentHelp: "The frame this frame's transform is relative to.",
  ageHelp: "How long ago the transform in use was recorded, relative to the playhead.",
  historySizeHelp: "Number of transforms stored for this frame.",
  recordedTranslationHelp: "Translation from the parent frame as recorded, in meters.",
  translationHelp: "Translation from the parent frame, in meters.",
  markerColorHelp: "Overrides the color of every marker on this topic.",
  showOutlineHelp: "Draws dark edges around cubes, spheres, cylinders, arrows and meshes.",
  showLabelsHelp: "Draws text labels. Turn off to hide labels without hiding the shapes.",
  poseTypeHelp: "Draws each pose as coordinate axes or as an arrow.",
  poseArrayTypeHelp: "Draws each pose as axes or an arrow, or all poses as one line.",
  axisLengthHelp: "Length of the axes, in meters.",
  arrowScaleHelp: "Arrow length (X) and thickness (Y, Z), in meters.",
  arrowColorHelp: "Color of the arrow.",
  covarianceHelp: "Shows the position covariance as an ellipsoid.",
  pointMarkerSizeHelp: "Diameter of the sphere drawn at the point, in meters.",
  pointMarkerColorHelp: "Color of the sphere drawn at the point.",
  covarianceColorHelp: "Color of the covariance ellipsoid.",
  pathLineWidthHelp: "Width of the line through the poses, in meters.",
  poseGradientHelp: "Colors from the first pose to the last.",
  gridMapColorLayer: "Color layer",
  gridMapColorLayerHelp: "The map layer whose values set each cell's color.",
  gridMapElevationLayer: "Elevation layer",
  gridMapElevationLayerHelp:
    "The map layer whose values lift each cell along Z, in meters. Choose None for a flat map.",
  gridMapNoLayer: "None",
  gridMapInterpolation: "Interpolation",
  gridMapInterpolationHelp:
    "Linear blends colors between cell centers. Nearest shows each cell as a solid block.",
  gridMapInterpolationLinear: "Linear",
  gridMapInterpolationNearest: "Nearest",
  gridMapLighting: "Lighting",
  gridMapLightingHelp: "Shade slopes of the elevation surface so terrain shape is easier to read.",
  gridMapDrawBehind: "Draw behind",
  gridMapDrawBehindHelp: "Draw the map underneath everything else in the scene, ignoring depth.",
  occupancyColorModeHelp:
    "Custom blends between your colors; Map and Costmap use the rviz palettes; Raw shows cell values as gray levels.",
  minColorHelp: "Color of free cells (0); values up to 100 blend toward the max color.",
  maxColorHelp: "Color of fully occupied cells (100).",
  unknownColorHelp: "Color of unknown cells (-1).",
  invalidColorHelp: "Color of cells outside -1 to 100.",
  frameLockHelp:
    "Moves the data with its frame. Off keeps it where it was when the message arrived.",
  cameraInfoHelp: "Calibration that places the image in the scene.",
  imageDistanceHelp: "Distance from the camera at which the image is drawn, in meters.",
  frustumDistanceHelp: "Length of the drawn camera frustum, in meters.",
  planarProjectionFactorHelp:
    "0 projects onto a sphere around the camera, 1 onto a flat plane; values between blend.",
  imageColorHelp: "Tints the image; the alpha sets its opacity.",
  renderMode: "Render mode",
  renderModeHelp:
    "Default draws the image at a distance from the camera, Plane projection lays it onto a frame's XY plane, Depth map turns a depth image into 3D points.",
  renderModeDefault: "Default",
  renderModePlane: "Plane projection",
  renderModeDepth: "Depth map",
  projectionFrame: "Projection frame",
  projectionFrameHelp: "Frame whose XY plane (z = 0) the image is projected onto.",
  projectionFrameFixed: "Fixed frame",
  projectionDistance: "Projection distance",
  projectionDistanceHelp:
    "Farthest a pixel is drawn from the camera, in meters (at least 1). Empty stops rays that graze the plane.",
  auto: "auto",
  depthDistanceType: "Distance type",
  depthDistanceTypeHelp:
    "Z axis: depth is measured along the camera's optical axis (most depth cameras). Euclidean: along each pixel's ray.",
  depthDistanceZ: "Z axis",
  depthDistanceEuclidean: "Euclidean",
  depthScale: "Depth scale",
  depthScaleHelp:
    "Meters per depth unit. Empty uses 1 for 32FC1 images and 0.001 (millimeters) otherwise.",
  rgbTopic: "RGB topic",
  rgbTopicHelp:
    "Color image that colors the points. It should be registered to the depth image (same view).",
  rgbTopicNone: "None",
  frustumLineWidthHelp: "Width of the frustum lines, in meters.",
  frustumColorHelp: "Color of the frustum lines.",
  pointShapeHelp: "Shape drawn for each point.",
  pointSizeHelp: "Point size in pixels.",
  cubeSizeHelp: "Edge length of each cube, in meters.",
  sphereSizeHelp: "Diameter of each sphere, in meters.",
  cubeOutlineHelp: "Draws dark edges around each cube.",
  decayTimeHelp: "Seconds that older messages stay visible. 0 shows only the latest one.",
  colorModeHelp:
    "How to color: one flat color, a gradient or color map over a field's value, or colors stored in the message.",
  flatColorHelp: "Color used for everything on this topic.",
  colorByHelp:
    "Field whose value picks the color. Distance (auto) uses the distance from the frame's origin.",
  gradientHelp: "Colors for the min and max value; values in between blend.",
  colorMapHelp: "Color map spread from the min to the max value.",
  opacityHelp: "Opacity applied to the computed colors.",
  valueMinHelp: "Value mapped to the first color. Empty picks it from the data.",
  valueMaxHelp: "Value mapped to the last color. Empty picks it from the data.",
  gridFrameHelp: "Frame the grid is attached to.",
  gridSizeHelp: "Width and length of the grid, in meters.",
  gridDivisionsHelp: "Number of cells along each side.",
  gridLineWidthHelp: "Width of the grid lines, in pixels.",
  gridColorHelp: "Color of the grid lines.",
  gridPositionHelp: "Offset of the grid's center in its frame, in meters.",
  gridRotationHelp: "Rotation of the grid in its frame (roll, pitch, yaw) in degrees.",

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

  // Grids (cell data)
  cellGridElevation: "Elevation",
  cellGridElevationHelp:
    "Numeric field that lifts each cell along the grid's Z axis, in meters, turning the grid into a height map. Cells without a finite value are hidden. None keeps the grid flat.",
  cellGridElevationNone: "None",
  cellGridLighting: "Lighting",
  cellGridLightingHelp:
    "Shade the elevated surface by its slope so its shape is visible. Needs an elevation field.",
  cellGridInterpolation: "Interpolation",
  cellGridInterpolationHelp:
    "How colors are sampled between cell centers. Nearest shows each cell as a solid block; Linear blends neighbouring cells smoothly.",
  cellGridInterpolationNearest: "Nearest",
  cellGridInterpolationLinear: "Linear",
  cellGridShowLines: "Show lines",
  cellGridShowLinesHelp: "Draw the border of every cell.",
  cellGridLineColor: "Line color",
  cellGridLineColorHelp: "Color of the cell borders. Lower the alpha to make them subtler.",
  cellGridDrawBehind: "Draw behind",
  cellGridDrawBehindHelp:
    "Draw this grid before everything else and without depth, so other objects always show on top, like a map underlay. The grid is drawn opaque, and with elevation, near and far parts of the surface may overlap incorrectly.",

  // Point Extension Utils
  decayTime: "Decay time",
  decayTimeDefaultZeroSeconds: "0 seconds",
  pointShape: "Point shape",
  pointShapeCircle: "Circle",
  pointShapeSquare: "Square",
  pointShapeCube: "Cube",
  pointShapeSphere: "Sphere",
  cubeSize: "Cube size (m)",
  sphereSize: "Sphere size (m)",
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
  showLabels: "Show labels",

  // Poses
  covariance: "Covariance",
  covarianceColor: "Covariance color",
  poseDisplayTypeArrow: "Arrow",
  poseDisplayTypeAxis: "Axis",
  poseDisplayTypeLine: "Line",

  // Camera controls
  switchTo2DCamera: "Switch to 2D camera",
  switchTo3DCamera: "Switch to 3D camera",

  // Publish
  clickToCancel: "Click to cancel",
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

  // Voxel grids
  voxelBitColorModeHelp:
    "By type colors each voxel by which of its two bits are set. Gradient and Rainbow color the voxels with both bits set by their height level.",
  voxelByType: "By type",
  voxelMarkedPresent: "Marked and present",
  voxelMarkedPresentHelp: "Color of voxels with both bits set. Alpha 0 hides them.",
  voxelPresent: "Present",
  voxelPresentHelp:
    "Color of voxels with only the present bit (bit z + 16) set. Alpha 0 hides them.",
  voxelMarked: "Marked",
  voxelMarkedHelp: "Color of voxels with only the marked bit (bit z) set. Alpha 0 hides them.",
  voxelHeightGradientHelp: "Colors for the lowest and highest level; levels in between blend.",
  voxelUseLighting: "Lighting",
  voxelUseLightingHelp: "Shade the voxel faces by the scene lights so their edges stand out.",
  voxelDrawBehind: "Draw behind",
  voxelDrawBehindHelp:
    "Draw the voxels first so every other object stays visible in front of them.",
};
