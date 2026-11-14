// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";
import { useCallback, useMemo } from "react";

import { parseMessagePath, quoteTopicNameIfNeeded } from "@lichtblick/message-path";
import { prefixTopic } from "@lichtblick/suite-base/players/IterablePlayer/shared/ComparedSource";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { CompareSideInfo, useCompare } from "./CompareContext";
import {
  COMPARE_VIEW_CONFIG_KEY,
  CompareView,
  compareSupport,
  resolveCompareView,
} from "./compareView";

/** A configured series of a panel that draws every compared side itself */
export type ComparablePath = { value: string; label?: string; enabled?: boolean };

const ORIGIN = "compareOrigin";

type Origin<P> = {
  /** Index of the path this one was expanded from */
  index: number;
  /** How many paths were expanded from it: removing any of them removes it */
  count: number;
  /** The fields expansion set, to tell them from the user's edits */
  generated: Partial<P>;
};

type Expanded<P> = P & { [ORIGIN]?: Origin<P> };

/** `path` read from the side with `prefix`: `/odom.x` -> `/b/odom.x` */
export function sidePath(path: string, prefix: string): string {
  const parsed = parseMessagePath(path);
  if (!parsed || parsed.topicName === "" || parsed.topicName.startsWith(`${prefix}/`)) {
    return path;
  }
  const rest = path.trimStart().slice(parsed.topicNameRepr.length);
  return `${quoteTopicNameIfNeeded(prefixTopic(prefix, parsed.topicName))}${rest}`;
}

/** `path` with any side prefix taken off its topic: `/b/odom.x` -> `/odom.x` */
export function unsidePath(path: string, prefixes: readonly string[]): string {
  const parsed = parseMessagePath(path);
  const prefix = parsed && prefixes.find((p) => parsed.topicName.startsWith(`${p}/`));
  if (!parsed || prefix == undefined) {
    return path;
  }
  const rest = path.trimStart().slice(parsed.topicNameRepr.length);
  return `${quoteTopicNameIfNeeded(parsed.topicName.slice(prefix.length))}${rest}`;
}

/**
 * One path per side for each path on a topic (others, e.g. Plot reference lines, stay single).
 * `style` sets the fields that tell the sides apart.
 */
export function expandPaths<P extends ComparablePath>(
  paths: readonly P[],
  sides: readonly CompareSideInfo[],
  style: (path: P, side: CompareSideInfo, pathIndex: number) => Partial<P>,
  isTopicPath: (path: P) => boolean = () => true,
): Expanded<P>[] {
  const prefixes = sides.map((side) => side.prefix);
  return paths.flatMap((path, index): Expanded<P>[] => {
    // A path already naming a side reads only that side
    if (!isTopicPath(path) || unsidePath(path.value, prefixes) !== path.value) {
      return [{ ...path, [ORIGIN]: { index, count: 1, generated: {} } }];
    }
    return sides.map((side) => {
      const generated: Partial<P> = {
        ...style(path, side, index),
        value: sidePath(path.value, side.prefix),
        ...(path.label != undefined && path.label !== ""
          ? { label: `${path.label} (${side.label})` }
          : {}),
      };
      return { ...path, ...generated, [ORIGIN]: { index, count: sides.length, generated } };
    });
  });
}

/** `path` as configured: fields expansion set are back to the original's, edits are kept */
function restore<P extends ComparablePath>(
  path: Expanded<P>,
  original: readonly P[],
  prefixes: readonly string[],
): P {
  const { [ORIGIN]: origin, ...rest } = path;
  const restored = { ...rest } as Record<string, unknown>;
  const source = origin
    ? (original[origin.index] as Record<string, unknown> | undefined)
    : undefined;
  if (origin && source) {
    for (const [key, value] of Object.entries(origin.generated)) {
      if (_.isEqual(restored[key], value)) {
        if (key in source) {
          restored[key] = source[key];
        } else {
          delete restored[key];
        }
      }
    }
  }
  // An edited or added path is read from every side; a configured one stays as it was
  if (!source || restored.value !== source.value) {
    restored.value = unsidePath(restored.value as string, prefixes);
  }
  return restored as P;
}

/**
 * The configured paths for `expanded` paths edited by a panel: each original path takes the
 * edits made to any of its sides and is removed with any of them; paths added while expanded are
 * kept, without a side prefix.
 */
export function collapsePaths<P extends ComparablePath>(
  expanded: readonly Expanded<P>[],
  original: readonly P[],
  prefixes: readonly string[],
): P[] {
  const result: P[] = [];
  const positions = new Map<number, number>();
  const counts = _.countBy(expanded.flatMap((path) => (path[ORIGIN] ? [path[ORIGIN].index] : [])));
  for (const path of expanded) {
    const origin = path[ORIGIN];
    // Removing one side of a path removes the path, else the next expansion brings it back
    if (origin && (counts[origin.index] ?? 0) < origin.count) {
      continue;
    }
    const restored = restore(path, original, prefixes);
    const position = origin ? positions.get(origin.index) : undefined;
    if (!origin) {
      result.push(restored);
    } else if (position == undefined) {
      positions.set(origin.index, result.length);
      result.push(restored);
    } else if (!_.isEqual(restored, original[origin.index])) {
      result[position] = restored;
    }
  }
  return result;
}

/**
 * A settings tree path into expanded paths (`["paths", "3", …]`) as the same path into the
 * configured paths
 */
export function configuredFocus<P>(
  focus: readonly string[] | undefined,
  expanded: readonly Expanded<P>[],
): readonly string[] | undefined {
  if (focus?.[0] !== "paths" || focus[1] == undefined) {
    return focus;
  }
  const origin = expanded[Number(focus[1])]?.[ORIGIN];
  return origin ? ["paths", String(origin.index), ...focus.slice(2)] : focus;
}

/**
 * For a panel drawing every compared side itself: while it shows every side, its config with one
 * path per side, and a saveConfig that writes edits back to the configured paths.
 */
export function useComparedPaths<C extends { paths: P[] }, P extends ComparablePath>(
  panelType: string,
  config: C,
  saveConfig: SaveConfig<C>,
  style: (path: P, side: CompareSideInfo, pathIndex: number) => Partial<P>,
  isTopicPath?: (path: P) => boolean,
): { config: C; saveConfig: SaveConfig<C>; sides?: readonly CompareSideInfo[] } {
  const compare = useCompare();
  const view = (config as Record<string, unknown>)[COMPARE_VIEW_CONFIG_KEY] as
    | CompareView
    | undefined;
  const sides =
    compare && resolveCompareView(view, compareSupport(panelType, config), compare).kind === "all"
      ? compare.sides
      : undefined;

  const expandedConfig = useMemo(
    () =>
      sides ? { ...config, paths: expandPaths(config.paths, sides, style, isTopicPath) } : config,
    [config, isTopicPath, sides, style],
  );

  const save = useCallback<SaveConfig<C>>(
    (update) => {
      if (!sides) {
        saveConfig(update);
        return;
      }
      const prefixes = sides.map((side) => side.prefix);
      saveConfig((old) => {
        const partial =
          typeof update === "function"
            ? update({ ...old, paths: expandPaths(old.paths, sides, style, isTopicPath) })
            : update;
        return partial.paths
          ? { ...partial, paths: collapsePaths(partial.paths, old.paths, prefixes) }
          : partial;
      });
    },
    [isTopicPath, saveConfig, sides, style],
  );

  return { config: expandedConfig, saveConfig: save, sides };
}
