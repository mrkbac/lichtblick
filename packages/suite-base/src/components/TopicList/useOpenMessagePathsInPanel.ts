// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback } from "react";

import { DraggedMessagePath } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import {
  useCurrentLayoutActions,
  useSelectedPanels,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { PanelInfo, usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import {
  dropOnFirstAcceptingPanel,
  queuePanelDrop,
} from "@lichtblick/suite-base/services/messagePathDragging/panelDropRegistry";
import { getPanelIdForType, getPanelTypeFromId } from "@lichtblick/suite-base/util/layout";

/** Schemas each panel reads, by panel type; from the panels' lazily loaded docs. */
export type SchemasByPanelType = ReadonlyMap<string, ReadonlySet<string>>;

const schemasByPanel = new WeakMap<PanelInfo, Promise<ReadonlySet<string>>>();

async function loadSchemas(panel: PanelInfo): Promise<ReadonlySet<string>> {
  let schemas = schemasByPanel.get(panel);
  if (!schemas) {
    schemas = (panel.docs?.() ?? Promise.resolve(undefined)).then(
      (docs) => new Set(docs?.default.openInSchemas ?? docs?.default.schemas ?? []),
      () => new Set<string>(),
    );
    schemasByPanel.set(panel, schemas);
  }
  return await schemas;
}

/** Loads the schemas of every panel offered for topics. Cached, so cheap after the first call. */
export async function loadOpenInSchemas(panels: readonly PanelInfo[]): Promise<SchemasByPanelType> {
  const topicPanels = panels.filter((panel) => panel.openIn?.kind === "topic");
  const schemas = await Promise.all(topicPanels.map(loadSchemas));
  return new Map(topicPanels.map((panel, i) => [panel.type, schemas[i]!]));
}

/** Returns a callback that starts loading the schemas, e.g. when the pointer nears a topic. */
export function usePrefetchOpenInSchemas(): () => void {
  const panelCatalog = usePanelCatalog();
  return useCallback(() => {
    void loadOpenInSchemas(panelCatalog.getPanels());
  }, [panelCatalog]);
}

function acceptsPath(panel: PanelInfo, schemas: SchemasByPanelType, path: DraggedMessagePath) {
  switch (panel.openIn?.kind) {
    case "topic":
      return (
        path.isTopic &&
        path.rootSchemaName != undefined &&
        schemas.get(panel.type)?.has(path.rootSchemaName) === true
      );
    case "field":
      return path.isLeaf;
    case "path":
      return true;
    case undefined:
      return false;
  }
}

/** The panels that can show all of `paths`, in catalog order. */
export function getOpenInPanels(
  panels: readonly PanelInfo[],
  schemas: SchemasByPanelType,
  paths: readonly DraggedMessagePath[],
): PanelInfo[] {
  return panels.filter(
    (panel) =>
      panel.hidden !== true &&
      paths.length > 0 &&
      (paths.length === 1 || panel.openIn?.multiple === true) &&
      paths.every((path) => acceptsPath(panel, schemas, path)),
  );
}

// Most specific first: an image topic also opens in 3D, a log topic also in Raw Messages.
const DEFAULT_PREFERENCE = ["Image", "Audio", "RosOut", "map", "CameraGrid", "3D", "Plot"];

/** The panel type a double-click opens `paths` in. */
export function getDefaultPanelType(offered: readonly PanelInfo[]): string {
  const types = offered.map((panel) => panel.type);
  return (
    DEFAULT_PREFERENCE.find((type) => types.includes(type)) ??
    offered.find((panel) => panel.openIn?.kind === "topic")?.type ??
    "RawMessages"
  );
}

/**
 * Shows message paths in a panel of `type`, or the default type for them: in the selected panel
 * if it accepts them, otherwise in a new panel next to it. The new panel gets selected so further
 * paths are added to it.
 */
export function useOpenMessagePathsInPanel(): (
  paths: readonly DraggedMessagePath[],
  type?: string,
) => Promise<void> {
  const { addPanel, getCurrentLayoutState } = useCurrentLayoutActions();
  const { getSelectedPanelIds, setSelectedPanelIds } = useSelectedPanels();
  const panelCatalog = usePanelCatalog();

  return useCallback(
    async (paths: readonly DraggedMessagePath[], requestedType?: string) => {
      if (paths.length === 0) {
        return;
      }
      const selected = getSelectedPanelIds();
      const candidates =
        requestedType == undefined
          ? selected
          : selected.filter((id) => getPanelTypeFromId(id) === requestedType);
      if (dropOnFirstAcceptingPanel(candidates, paths)) {
        return;
      }
      const panels = panelCatalog.getPanels();
      let type = requestedType;
      if (type == undefined) {
        const layoutId = getCurrentLayoutState().selectedLayout?.id;
        const schemas = await loadOpenInSchemas(panels);
        // Another layout may have been opened while the schemas loaded
        if (getCurrentLayoutState().selectedLayout?.id !== layoutId) {
          return;
        }
        type = getDefaultPanelType(getOpenInPanels(panels, schemas, paths));
      }
      const openIn = panelCatalog.getPanelByType(type)?.openIn;
      const shownPaths = openIn?.multiple === true ? paths : paths.slice(0, 1);
      const id = getPanelIdForType(type);
      const placement =
        selected[0] != undefined
          ? { position: "right" as const, targetPanelId: selected[0] }
          : undefined;
      if (openIn?.config) {
        addPanel({ id, config: openIn.config(shownPaths.map((p) => p.topicName)), ...placement });
      } else {
        addPanel({ id, ...placement });
        queuePanelDrop(id, shownPaths);
      }
      setSelectedPanelIds([id]);
    },
    [addPanel, getCurrentLayoutState, getSelectedPanelIds, panelCatalog, setSelectedPanelIds],
  );
}
