// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec } from "@foxglove/rostime";

import { SettingsTreeAction } from "@lichtblick/suite";
import type { RosValue } from "@lichtblick/suite-base/players/types";

import type { AnyRendererSubscription } from "../IRenderer";
import { BaseUserData, Renderable } from "../Renderable";
import type { Renderer } from "../Renderer";
import {
  PartialMessage,
  PartialMessageEvent,
  SceneExtension,
  onlyLastByTopicMessage,
} from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { makeRgba, stringToRgba } from "../color";
import { normalizeHeader, normalizeVector3s } from "../normalizeMessages";
import {
  Marker,
  MarkerAction,
  MarkerType,
  Polygon,
  PolygonStamped,
  POLYGON_STAMPED_DATATYPES,
  TIME_ZERO,
} from "../ros";
import { BaseSettings } from "../settings";
import { POLYGON_DEFAULTS, polygonSettingsNode } from "../settingsNodes/topics";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";
import { makePose } from "../transforms";
import { RenderableLineStrip } from "./markers/RenderableLineStrip";

export type LayerSettingsPolygon = BaseSettings & {
  lineWidth: number;
  color: string;
};

const DEFAULT_SETTINGS = POLYGON_DEFAULTS;

export type PolygonUserData = BaseUserData & {
  settings: LayerSettingsPolygon;
  topic: string;
  polygonStamped: PolygonStamped;
  lines: RenderableLineStrip | undefined;
};

export class PolygonRenderable extends Renderable<PolygonUserData> {
  public override dispose(): void {
    this.userData.lines?.dispose();
    super.dispose();
  }

  public override details(): Record<string, RosValue> {
    return this.userData.polygonStamped;
  }
}

export class Polygons extends SceneExtension<PolygonRenderable> {
  public static extensionId = "foxglove.Polygons";
  public constructor(renderer: Renderer, name: string = Polygons.extensionId) {
    super(name, renderer);
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: POLYGON_STAMPED_DATATYPES,
        subscription: { handler: this.#handlePolygon, filterQueue: onlyLastByTopicMessage },
      },
    ];
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const configTopics = this.renderer.config.topics;
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    for (const topic of this.renderer.topics ?? []) {
      if (!topicIsConvertibleToSchema(topic, POLYGON_STAMPED_DATATYPES)) {
        continue;
      }
      const config = (configTopics[topic.name] ?? {}) as Partial<LayerSettingsPolygon>;

      entries.push({
        path: ["topics", topic.name],
        node: { ...polygonSettingsNode(topic, config), handler },
      });
    }
    return entries;
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;
    if (action.action !== "update" || path.length !== 3) {
      return;
    }

    this.saveSetting(path, action.payload.value);

    // Update the renderable
    const topicName = path[1]!;
    const renderable = this.renderables.get(topicName);
    if (renderable) {
      const settings = this.renderer.config.topics[topicName];
      renderable.userData.settings = { ...DEFAULT_SETTINGS, ...settings };
      this.#updatePolygonRenderable(
        renderable,
        renderable.userData.polygonStamped,
        renderable.userData.receiveTime,
      );
    }
  };

  #handlePolygon = (messageEvent: PartialMessageEvent<PolygonStamped>): void => {
    const topic = messageEvent.topic;
    const polygonStamped = normalizePolygonStamped(messageEvent.message);
    const receiveTime = toNanoSec(messageEvent.receiveTime);

    let renderable = this.renderables.get(topic);
    if (!renderable) {
      // Set the initial settings from default values merged with any user settings
      const userSettings = this.renderer.config.topics[topic];
      const settings = { ...DEFAULT_SETTINGS, ...userSettings };

      renderable = new PolygonRenderable(topic, this.renderer, {
        receiveTime,
        messageTime: toNanoSec(polygonStamped.header.stamp),
        frameId: this.renderer.normalizeFrameId(polygonStamped.header.frame_id),
        pose: makePose(),
        settingsPath: ["topics", topic],
        settings,
        topic,
        polygonStamped,
        lines: undefined,
      });

      this.add(renderable);
      this.renderables.set(topic, renderable);
    }

    this.#updatePolygonRenderable(renderable, polygonStamped, receiveTime);
  };

  #updatePolygonRenderable(
    renderable: PolygonRenderable,
    polygonStamped: PolygonStamped,
    receiveTime: bigint,
  ): void {
    const settings = renderable.userData.settings;

    renderable.userData.receiveTime = receiveTime;
    renderable.userData.messageTime = toNanoSec(polygonStamped.header.stamp);
    renderable.userData.frameId = this.renderer.normalizeFrameId(polygonStamped.header.frame_id);
    renderable.userData.polygonStamped = polygonStamped;

    const topic = renderable.userData.topic;
    const linesMarker = createLineStripMarker(polygonStamped, settings);
    if (!renderable.userData.lines) {
      renderable.userData.lines = new RenderableLineStrip(
        topic,
        linesMarker,
        receiveTime,
        this.renderer,
      );
      renderable.add(renderable.userData.lines);
    } else {
      renderable.userData.lines.update(linesMarker, receiveTime);
    }
  }
}

function createLineStripMarker(
  polygonStamped: PolygonStamped,
  settings: LayerSettingsPolygon,
): Marker {
  // Close the polygon
  const points = [...polygonStamped.polygon.points];
  const first = points[0];
  if (first) {
    points.push(first);
  }

  const linesMarker: Marker = {
    header: polygonStamped.header,
    ns: "",
    id: 0,
    type: MarkerType.LINE_STRIP,
    action: MarkerAction.ADD,
    pose: makePose(),
    scale: { x: settings.lineWidth, y: 1, z: 1 },
    color: stringToRgba(makeRgba(), settings.color),
    lifetime: TIME_ZERO,
    frame_locked: true,
    points,
    colors: [],
    text: "",
    mesh_resource: "",
    mesh_use_embedded_materials: false,
  };
  return linesMarker;
}

function normalizePolygon(polygon: PartialMessage<Polygon> | undefined): Polygon {
  return {
    points: normalizeVector3s(polygon?.points),
  };
}

function normalizePolygonStamped(polygon: PartialMessage<PolygonStamped>): PolygonStamped {
  return {
    header: normalizeHeader(polygon.header),
    polygon: normalizePolygon(polygon.polygon),
  };
}
