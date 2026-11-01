// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Feature, FeatureCollection, GeoJsonObject, Geometry } from "geojson";

import { MessageEvent } from "@lichtblick/suite";
import { FoxgloveMessages } from "@lichtblick/suite-base/types/FoxgloveMessages";

import { MapPanelMessage, NavSatFixMsg, NavSatFixStatus } from "./types";

export type GeoJsonMessage = MessageEvent<FoxgloveMessages["foxglove.GeoJSON"]>;

/**
 * @returns true unless the message reports that there is no fix
 */
export function hasFix(ev: MessageEvent<NavSatFixMsg>): boolean {
  switch (ev.message.status?.status) {
    case NavSatFixStatus.STATUS_GBAS_FIX:
    case NavSatFixStatus.STATUS_SBAS_FIX:
    case NavSatFixStatus.STATUS_FIX:
    case undefined: // LocationFix has no status; don't paint every LocationFix as "no fix".
      return true;
    case NavSatFixStatus.STATUS_NO_FIX:
    default:
      return false;
  }
}

export function isGeoJSONMessage(msgEvent: MessageEvent): msgEvent is GeoJsonMessage {
  return isGeoJSONSchema(msgEvent.schemaName);
}

/**
 * Verify that the message is either a GeoJSON message or a NavSatFix message with
 * finite latitude and longitude so we can actually display it.
 */
export function isValidMapMessage(msgEvent: MessageEvent): msgEvent is MapPanelMessage {
  if (isGeoJSONMessage(msgEvent)) {
    return true;
  }

  const message = msgEvent.message as Partial<NavSatFixMsg>;
  return (
    message.latitude != undefined &&
    isFinite(message.latitude) &&
    message.longitude != undefined &&
    isFinite(message.longitude)
  );
}

export function isSupportedSchema(schemaName: string): boolean {
  switch (schemaName) {
    case "sensor_msgs/NavSatFix":
    case "sensor_msgs/msg/NavSatFix":
    case "ros.sensor_msgs.NavSatFix":
    case "foxglove_msgs/LocationFix":
    case "foxglove_msgs/msg/LocationFix":
    case "foxglove.LocationFix":
    case "foxglove::LocationFix":
    case "foxglove_msgs/GeoJSON":
    case "foxglove_msgs/msg/GeoJSON":
    case "foxglove::GeoJSON":
    case "foxglove.GeoJSON":
      return true;
    default:
      return false;
  }
}

export function isGeoJSONSchema(schemaName: string): boolean {
  switch (schemaName) {
    case "foxglove_msgs/GeoJSON":
    case "foxglove_msgs/msg/GeoJSON":
    case "foxglove::GeoJSON":
    case "foxglove.GeoJSON":
      return true;
    default:
      return false;
  }
}

/**
 * Leaflet-style path options that publishers put in the nonstandard `properties.style` of a
 * feature (kept for compatibility with existing GeoJSON publishers).
 */
export type GeoJsonStyle = {
  color?: string;
  weight?: number;
  opacity?: number | string;
  fillColor?: string;
  fillOpacity?: number | string;
  radius?: number;
};

/** Parse a GeoJSON string into flat features, extracting the nonstandard `style` property. */
export function parseGeoJSON(json: string): { feature: Feature; style: GeoJsonStyle }[] {
  try {
    const parsed = JSON.parse(json) as GeoJsonObject | GeoJsonObject[] | null;
    const objects = parsed ? (Array.isArray(parsed) ? parsed : [parsed]) : [];
    return objects.flatMap((object) => {
      switch (object.type) {
        case "Feature": {
          const feature = object as Feature;
          return [
            {
              feature,
              style: (feature.properties?.style ?? {}) as GeoJsonStyle,
            },
          ];
        }
        case "FeatureCollection":
          return ((object as Partial<FeatureCollection>).features ?? []).map((feature) => ({
            feature,
            style: (feature.properties?.style ?? {}) as GeoJsonStyle,
          }));
        default:
          return [
            {
              feature: {
                type: "Feature",
                geometry: object as Geometry,
                properties: {},
              },
              style: {},
            },
          ];
      }
    });
  } catch (error) {
    console.error(error);
    return [];
  }
}
