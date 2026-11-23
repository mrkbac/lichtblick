// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

// All message types supported by Rviz
// http://wiki.ros.org/rviz/DisplayTypes

import { Time } from "@foxglove/rostime";

export type MutablePoint = {
  x: number;
  y: number;
  z: number;
};
export type Point = Readonly<MutablePoint>;
type Points = readonly Point[];

export type MutablePoint2D = {
  x: number;
  y: number;
};
export type Point2D = Readonly<MutablePoint2D>;

export type Header = Readonly<{
  frame_id: string;
  stamp: Time;
  seq: number;
}>;

export type StampedMessage = Readonly<{
  header: Header;
}>;

type Duration = Time;

type MutableOrientation = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type Color = Readonly<{
  r: number;
  g: number;
  b: number;
  a: number;
}>;

// NOTE: Deep mutability.
export type MutablePose = {
  position: MutablePoint;
  orientation: MutableOrientation;
};

type Colors = readonly Color[];

export type PointField = Readonly<{
  name: string;
  offset: number;
  datatype: number;
  count: number;
}>;

export type PointCloud2 = StampedMessage & {
  fields: readonly PointField[];
  height: number;
  width: number;
  is_bigendian: boolean;
  point_step: number; // Length of point in bytes
  row_step: number; // Length of row in bytes
  data: Uint8Array;
  is_dense: boolean | number;
  // this is appended by scene builder
  type: 102;
  // this is appended by scene builder
  pose?: MutablePose;
};

export type VelodynePacket = Readonly<{
  stamp: Time;
  data: Uint8Array; // 1206 bytes
}>;

export type VelodyneScan = Readonly<
  StampedMessage & {
    packets: VelodynePacket[];
  }
>;

export enum ImageMarkerType {
  CIRCLE = 0,
  LINE_STRIP = 1,
  LINE_LIST = 2,
  POLYGON = 3,
  POINTS = 4,
  // TEXT is not part of visualization_msgs/ImageMarker, but we include it to
  // support existing frameworks that have extended this message definition
  TEXT = 5,
}

export enum ImageMarkerAction {
  ADD = 0,
  REMOVE = 1,
}

export type ImageMarker = Readonly<{
  header: Header;
  ns: string;
  id: number;
  type: ImageMarkerType;
  action: ImageMarkerAction;
  position: Point;
  scale: number;
  outline_color: Color;
  filled: boolean;
  fill_color: Color;
  lifetime: Duration;
  points: Points;
  outline_colors: Colors;
  // `text` is not part of visualization_msgs/ImageMarker, but we include it to
  // support existing frameworks that have extended this message definition
  text?: { data: string };
}>;

export type ImageMarkerArray = Readonly<{
  markers: ImageMarker[];
}>;
