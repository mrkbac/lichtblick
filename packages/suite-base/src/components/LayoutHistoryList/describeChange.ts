// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";
import * as _ from "lodash-es";

import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { getPanelTypeFromId } from "@lichtblick/suite-base/util/layout";
import { getAllPanelIds } from "@lichtblick/suite-base/util/tabLayout";

/** Short, human-readable lines describing what changed from `prev` to `next`. */
export function describeChange(
  prev: LayoutData | undefined,
  next: LayoutData,
  panelTitle: (type: string) => string,
  t: TFunction<"layoutHistory">,
): string[] {
  const nextIds = getAllPanelIds(next);
  if (prev == undefined) {
    return [t("panels", { count: nextIds.length })];
  }
  const prevIds = getAllPanelIds(prev);
  const names = (ids: string[]) =>
    [...new Set(ids.map((id) => panelTitle(getPanelTypeFromId(id))))].join(", ");
  const prevSet = new Set(prevIds);
  const nextSet = new Set(nextIds);
  const added = [...nextSet.difference(prevSet)];
  const removed = [...prevSet.difference(nextSet)];
  const edited = [...prevSet].filter(
    (id) => nextSet.has(id) && !_.isEqual(prev.configById[id], next.configById[id]),
  );

  const lines: string[] = [];
  if (added.length > 0) {
    lines.push(t("added", { panels: names(added) }));
  }
  if (removed.length > 0) {
    lines.push(t("removed", { panels: names(removed) }));
  }
  if (edited.length > 0) {
    lines.push(t("changedSettings", { panels: names(edited) }));
  }
  if (added.length === 0 && removed.length === 0 && !_.isEqual(prev.layout, next.layout)) {
    lines.push(t("rearranged"));
  }
  if (!_.isEqual(prev.globalVariables, next.globalVariables)) {
    lines.push(t("changedVariables"));
  }
  if (!_.isEqual(prev.userNodes, next.userNodes)) {
    lines.push(t("changedScripts"));
  }
  if (!_.isEqual(prev.playbackConfig, next.playbackConfig)) {
    lines.push(t("changedPlayback"));
  }
  return lines;
}
