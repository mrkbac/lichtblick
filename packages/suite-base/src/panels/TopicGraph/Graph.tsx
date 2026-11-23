// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Cytoscape from "cytoscape";
import CytoscapeDagre from "cytoscape-dagre";
import { RefObject, useEffect, useRef } from "react";

Cytoscape.use(CytoscapeDagre); // eslint-disable-line react-hooks/rules-of-hooks -- Cytoscape plugin registration, not a React hook
Cytoscape.warnings(false);

const DAG_LAYOUT = {
  name: "dagre",
  fit: false,
  nodesep: 20,
  rankDir: "TB",
  ranker: "longest-path",
};

export const LABEL_MAX_WIDTH = 200;

const LABELED_BOX: Cytoscape.Css.Node = {
  content: "data(label)",
  shape: "round-rectangle",
  height: "20px",
  "background-color": "#000",
  "border-width": "1px",
  padding: "4px",
  "font-size": "16px",
  "text-max-width": `${LABEL_MAX_WIDTH}px`,
  "text-wrap": "ellipsis",
  "text-valign": "center",
  "text-halign": "center",
};

const STYLESHEET: Cytoscape.StylesheetStyle[] = [
  {
    selector: "edge",
    style: {
      "target-arrow-shape": "triangle",
      "line-color": "rgb(190, 190, 187)",
      "target-arrow-color": "rgb(190, 190, 187)",
      "curve-style": "bezier",
    },
  },
  {
    selector: 'node[type="node"]',
    style: { ...LABELED_BOX, "border-color": "rgb(69, 165, 255)", color: "rgb(69, 165, 255)" },
  },
  {
    selector: 'node[type="topic"]',
    style: {
      content: "data(label)",
      shape: "diamond",
      width: "40px",
      height: "40px",
      "background-color": "rgb(183, 157, 202)",
      "font-size": "16px",
      "text-outline-color": "#000",
      "text-outline-width": "2px",
      color: "#fff",
    },
  },
  {
    selector: 'node[type="service"]',
    style: { ...LABELED_BOX, "border-color": "rgb(255, 107, 130)", color: "rgb(255, 107, 130)" },
  },
];

export interface GraphMutation {
  fit: () => void;
  resetUserPanZoom: () => void;
}

type Props = {
  elements: cytoscape.ElementDefinition[];
  rankDir: string;
  graphRef: RefObject<GraphMutation | undefined>;
};

export default function Graph(props: Props): React.JSX.Element {
  const cy = useRef<Cytoscape.Core>(undefined);
  const graphRef = useRef<HTMLDivElement>(null);

  // indicates that a user has manually panned/zoomed the viewport
  // we avoid performing actions like automatic fit when this happens.
  const userPanZoom = useRef<boolean>(false);

  useEffect(() => {
    if (!graphRef.current) {
      throw new Error("Graph ref must be available on first render");
    }

    cy.current = Cytoscape({
      container: graphRef.current,
      style: STYLESHEET,
      zoom: 0.7,
    });

    cy.current.on("viewport", () => {
      userPanZoom.current = true;
    });

    props.graphRef.current = {
      fit: () => {
        userPanZoom.current = false;
        cy.current?.fit();
      },
      resetUserPanZoom: () => {
        userPanZoom.current = false;
      },
    };

    return () => {
      cy.current?.destroy();
    };
  }, [props.graphRef]);

  const { elements, rankDir } = props;
  useEffect(() => {
    if (!cy.current) {
      return;
    }

    cy.current.batch(() => {
      cy.current?.elements().remove();
      cy.current?.add(elements);
      cy.current
        ?.elements()
        .makeLayout({ ...DAG_LAYOUT, rankDir } as unknown as Cytoscape.LayoutOptions)
        .run();
    });

    if (!userPanZoom.current) {
      cy.current.fit();
    }
  }, [elements, rankDir]);

  return <div ref={graphRef} style={{ width: "100%", height: "100%" }} />;
}
