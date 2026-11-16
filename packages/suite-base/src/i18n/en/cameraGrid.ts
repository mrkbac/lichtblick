// SPDX-License-Identifier: MPL-2.0

export const cameraGrid = {
  // Panel
  emptyIntro: "Show many camera topics side by side.",
  addAllImageTopicsCount: "Add all compressed image topics ({{count}})",
  onlyRawImageTopics:
    "Only raw image topics are available. Add them one by one in the panel settings.",
  allCamerasHidden: "All cameras are hidden.",
  waitingForImageTopics: "Waiting for image topics…",
  waitingForImages: "Waiting for images…",

  // Settings
  general: "General",
  addAllImageTopics: "Add all compressed image topics",
  addAllImageTopicsHelp:
    "Adds every compressed image and video topic not shown yet. Raw images are left out because they can saturate the connection.",
  removeAll: "Remove all",
  addCamera: "Add camera",
  addCameraHelp: "Adds one image topic; raw image topics can only be added this way.",
  addCameraTooltip: "Pick an image topic to add it to the grid",
  columns: "Columns",
  columnsHelp: "Fixed number of columns; leave empty to pick the layout with the largest images.",
  columnsAuto: "Auto",
  showTopic: "Show topic",
  showTopicHelp: "Shows each camera's topic name over its image.",
  showTimestamp: "Show timestamp",
  showTimestampHelp: "Shows the timestamp of each camera's current image.",
  cameras: "Cameras",
  camerasHelp: "The cameras in the grid, in display order.",
  moveUp: "Move up",
  moveDown: "Move down",
  remove: "Remove",
  topic: "Topic",
  topicHelp: "Image topic this camera shows.",
  scaling: "Scaling",
  scalingHelp: "Fit shows the whole image; Fill crops it to cover the tile.",
  scalingFit: "Fit",
  scalingFill: "Fill",
  rotation: "Rotation",
  rotationHelp: "Rotates the image by this angle.",
  flipHorizontal: "Flip horizontal",
  flipHorizontalHelp: "Mirrors the image left to right.",
  flipVertical: "Flip vertical",
  flipVerticalHelp: "Mirrors the image top to bottom.",
  annotations: "Annotations",
  annotationsHelp:
    "Annotation topics drawn over this camera. Defaults to those in the image topic's namespace.",
  linkZoom: "Link zoom",
  linkZoomHelp: "Zoom and pan all cameras together.",
  syncAnnotations: "Sync annotations",
  syncAnnotationsHelp: "Only draw annotations whose timestamp matches the image.",
};
