// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { FormControlLabel, IconButton, Radio, RadioGroup, Tooltip } from "@mui/material";
import { useCallback, useMemo, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";

import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import ExpandingToolbar from "@lichtblick/suite-base/components/ExpandingToolbar";
import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import Panel from "@lichtblick/suite-base/components/Panel";
import { usePanelButtonTitle } from "@lichtblick/suite-base/components/PanelButton";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import { PANEL_TOOLBAR_HEIGHT } from "@lichtblick/suite-base/components/PanelToolbar/constants";
import { measureTextWidth } from "@lichtblick/suite-base/util/measureTextWidth";

import Graph, { GraphMutation, LABEL_MAX_WIDTH } from "./Graph";
import { TOPIC_GRAPH_BUTTONS } from "./buttons";

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    position: "absolute",
    top: `calc(${PANEL_TOOLBAR_HEIGHT} + ${theme.spacing(1)})`,
    right: theme.spacing(1),
    zIndex: 101,
    gap: theme.spacing(1),
    // allow mouse events to pass through the empty space in this container element
    pointerEvents: "none",
  },
  toolbarContent: {
    padding: theme.spacing(1),
  },
}));

export type TopicVisibility =
  | "all"
  | "none"
  | "published"
  | "subscribed"
  | "connected"
  | "disconnected-pub"
  | "disconnected-sub";

const topicVisibilityToLabelMap: Record<TopicVisibility, string> = {
  all: "All topics",
  none: "No topics",
  published: "Published topics",
  subscribed: "Subscribed topics",
  connected: "Connected topics",
  "disconnected-pub": "Disconnected published topics",
  "disconnected-sub": "Disconnected subscribed topics",
};

/** Displays publisher/subscriber relationships with floating graph and visibility controls. */
function TopicGraph() {
  const { classes } = useStyles();
  const [expanded, setExpanded] = useState(false);

  const publishedTopics = useMessagePipeline(
    useCallback((ctx) => ctx.playerState.activeData?.publishedTopics, []),
  );

  const subscribedTopics = useMessagePipeline(
    useCallback((ctx) => ctx.playerState.activeData?.subscribedTopics, []),
  );

  const services = useMessagePipeline(
    useCallback((ctx) => ctx.playerState.activeData?.services, []),
  );

  const [lrOrientation, setLROrientation] = useState<boolean>(false);
  const [showServices, setShowServices] = useState<boolean>(true);
  const [topicVisibility, setTopicVisibility] = useState<TopicVisibility>("all");

  const elements = useMemo<cytoscape.ElementDefinition[]>(() => {
    const output: cytoscape.ElementDefinition[] = [];
    const nodeIds = new Set(
      [publishedTopics, subscribedTopics, services].flatMap((map) =>
        [...(map?.values() ?? [])].flatMap((nodes) => [...nodes]),
      ),
    );
    const topicIds = new Set([
      ...(publishedTopics?.keys() ?? []),
      ...(subscribedTopics?.keys() ?? []),
    ]);
    const serviceIds = services?.keys() ?? [];
    const topicPassesConditions = (topic: string): boolean => {
      const published = publishedTopics?.has(topic) ?? false;
      const subscribed = subscribedTopics?.has(topic) ?? false;
      return (
        topicVisibility === "all" ||
        (topicVisibility === "published" && published) ||
        (topicVisibility === "subscribed" && subscribed) ||
        (topicVisibility === "connected" && published && subscribed) ||
        (topicVisibility === "disconnected-pub" && published && !subscribed) ||
        (topicVisibility === "disconnected-sub" && subscribed && !published)
      );
    };

    for (const node of nodeIds) {
      const widthPx = Math.min(LABEL_MAX_WIDTH, measureTextWidth(node, "16px Arial"));
      output.push({
        style: { width: `${widthPx}px` },
        data: { id: `n:${node}`, label: node, type: "node" },
      });
    }
    if (topicVisibility !== "none") {
      for (const topic of topicIds) {
        if (!topicPassesConditions(topic)) {
          continue;
        }
        output.push({
          data: { id: `t:${topic}`, label: topic, type: "topic" },
        });
      }
    }
    if (showServices) {
      for (const service of serviceIds) {
        const widthPx = Math.min(LABEL_MAX_WIDTH, measureTextWidth(service, "16px Arial"));
        output.push({
          style: { width: `${widthPx}px` },
          data: { id: `s:${service}`, label: service, type: "service" },
        });
      }
    }

    switch (topicVisibility) {
      case "none":
        if (publishedTopics == undefined || subscribedTopics == undefined) {
          break;
        }
        for (const [topic, publishers] of publishedTopics.entries()) {
          for (const pubNode of publishers) {
            for (const subNode of subscribedTopics.get(topic) ?? []) {
              if (subNode === pubNode) {
                continue;
              }
              const source = `n:${pubNode}`;
              const target = `n:${subNode}`;
              output.push({ data: { id: `${source}-${target}`, source, target } });
            }
          }
        }
        break;
      default:
        if (publishedTopics != undefined) {
          for (const [topic, publishers] of publishedTopics.entries()) {
            if (!topicPassesConditions(topic)) {
              continue;
            }

            for (const node of publishers) {
              const source = `n:${node}`;
              const target = `t:${topic}`;
              output.push({ data: { id: `${source}-${target}`, source, target } });
            }
          }
        }

        if (subscribedTopics != undefined) {
          for (const [topic, subscribers] of subscribedTopics.entries()) {
            if (!topicPassesConditions(topic)) {
              continue;
            }

            for (const node of subscribers) {
              const source = `t:${topic}`;
              const target = `n:${node}`;
              output.push({ data: { id: `${source}-${target}`, source, target } });
            }
          }
        }
    }

    if (showServices && services != undefined) {
      for (const [service, providers] of services.entries()) {
        for (const node of providers) {
          output.push({ data: { source: `n:${node}`, target: `s:${service}` } });
        }
      }
    }

    return output;
  }, [publishedTopics, subscribedTopics, services, topicVisibility, showServices]);

  const graph = useRef<GraphMutation>(undefined);

  const onZoomFit = useCallback(() => {
    graph.current?.fit();
  }, []);

  const toggleOrientation = useCallback(() => {
    graph.current?.resetUserPanZoom();
    setLROrientation(!lrOrientation);
  }, [lrOrientation]);

  const topicVisibilityTooltip: string = useMemo(() => {
    return `Showing ${topicVisibilityToLabelMap[topicVisibility].toLowerCase()}`;
  }, [topicVisibility]);

  const toggleShowServices = useCallback(() => {
    graph.current?.resetUserPanZoom();
    setShowServices(!showServices);
  }, [showServices]);

  const zoomFitTitle = usePanelButtonTitle(TOPIC_GRAPH_BUTTONS.zoomFit);
  const orientationTitle = usePanelButtonTitle(TOPIC_GRAPH_BUTTONS.orientation);
  const servicesTitle = usePanelButtonTitle(TOPIC_GRAPH_BUTTONS.services);

  if (publishedTopics == undefined) {
    return (
      <>
        <PanelToolbar />
        <EmptyState>Waiting for data…</EmptyState>
      </>
    );
  }

  return (
    <>
      <PanelToolbar />
      <div className={classes.root}>
        <ExpandingToolbar
          checked={topicVisibility !== "none"}
          dataTest="set-topic-visibility"
          tooltip={topicVisibilityTooltip}
          icon={<TOPIC_GRAPH_BUTTONS.topics.icon fontSize="small" />}
          toolbarItems={
            <>
              <Tooltip placement="left" title={zoomFitTitle}>
                <IconButton size="small" aria-label={zoomFitTitle} onClick={onZoomFit}>
                  <TOPIC_GRAPH_BUTTONS.zoomFit.icon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip placement="left" title={orientationTitle}>
                <IconButton size="small" aria-label={orientationTitle} onClick={toggleOrientation}>
                  <TOPIC_GRAPH_BUTTONS.orientation.icon
                    fontSize="small"
                    style={{ transform: `rotate(${lrOrientation ? 90 : 0}deg)` }}
                  />
                </IconButton>
              </Tooltip>
              <Tooltip placement="left" title={servicesTitle}>
                <IconButton
                  size="small"
                  aria-pressed={showServices}
                  aria-label={servicesTitle}
                  onClick={toggleShowServices}
                >
                  <TOPIC_GRAPH_BUTTONS.services.icon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          }
          title="Topics"
          expanded={expanded}
          onToggle={() => {
            setExpanded((old) => !old);
          }}
        >
          <div className={classes.toolbarContent}>
            <RadioGroup
              defaultValue={topicVisibility}
              onChange={(_event, value) => {
                graph.current?.resetUserPanZoom();
                setTopicVisibility(value as TopicVisibility);
              }}
            >
              {Object.entries(topicVisibilityToLabelMap).map(([id, label]) => (
                <FormControlLabel key={id} value={id} control={<Radio />} label={label} />
              ))}
            </RadioGroup>
          </div>
        </ExpandingToolbar>
      </div>
      <Graph elements={elements} rankDir={lrOrientation ? "LR" : "TB"} graphRef={graph} />
    </>
  );
}

TopicGraph.panelType = "TopicGraph";
TopicGraph.defaultConfig = {};

export default Panel(TopicGraph);
