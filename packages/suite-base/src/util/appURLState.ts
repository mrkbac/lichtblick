// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, toRFC3339String } from "@foxglove/rostime";
import * as _ from "lodash-es";

import { LayoutID } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { parseTimeUrlString } from "@lichtblick/suite-base/util/time";

import { keyMap } from "./constants";
import { splitRemoteRecordingUrlList } from "./recentSources";

export type AppURLState = {
  ds?: string;
  layoutUrl?: string;
  dsParams?: Record<string, string>;
  dsParamsArray?: Record<string, string[]>;
  layoutId?: LayoutID;
  mcapBundleId?: string;
  time?: Time;
};

/**
 * Encodes app state in a URL's query params.
 *
 * @param url The base URL to encode params into.
 * @param urlState The player state to encode.
 * @returns A url with all app state stored as query pararms.
 */
export function updateAppURLState(url: URL, urlState: AppURLState): URL {
  const newURL = new URL(url.href);

  if ("time" in urlState) {
    if (urlState.time) {
      newURL.searchParams.set("time", toRFC3339String(urlState.time));
    } else {
      newURL.searchParams.delete("time");
    }
  }

  if ("ds" in urlState) {
    if (urlState.ds) {
      newURL.searchParams.set("ds", urlState.ds);
    } else {
      newURL.searchParams.delete("ds");
    }
  }

  if ("layoutUrl" in urlState) {
    if (urlState.layoutUrl) {
      newURL.searchParams.set("layoutUrl", urlState.layoutUrl);
    } else {
      newURL.searchParams.delete("layoutUrl");
    }
  }

  if (urlState.dsParams || urlState.dsParamsArray) {
    [...newURL.searchParams].forEach(([k]) => {
      if (k.startsWith("ds.")) {
        newURL.searchParams.delete(k);
      }
    });

    Object.entries(urlState.dsParams ?? {}).forEach(([k, v]) => {
      newURL.searchParams.append("ds." + (keyMap[k] ?? k), v);
    });
    Object.entries(urlState.dsParamsArray ?? {}).forEach(([k, v]) => {
      v.forEach((item: string) => {
        newURL.searchParams.append("ds." + (keyMap[k] ?? k), item);
      });
    });
  }

  newURL.searchParams.sort();

  return newURL;
}

/**
 * The URL's href with `:`, `/` and `,` unescaped in the query, where they are literal, so times
 * and source URLs stay readable. Never decodeURIComponent the whole href: a data-source URL with
 * its own query string (e.g. a presigned URL) would spill its `&…` params into ours.
 */
export function readableHref(url: URL): string {
  const readable = new URL(url.href);
  readable.search = readable.search.replace(/%(3A|2F|2C)/gi, (m) => decodeURIComponent(m));
  return readable.href;
}

/**
 * Tries to parse a state url into one of the types we know how to open.
 *
 * @param url URL to try to parse.
 * @returns Parsed URL type or undefined if the url is not a valid URL.
 * @throws Error if URL parsing fails.
 */
export function parseAppURLState(url: URL): AppURLState | undefined {
  const ds = url.searchParams.get("ds") ?? undefined;
  const layoutUrl = url.searchParams.get("layoutUrl");
  const mcapBundleId = url.searchParams.get("mcap-bundle") ?? undefined;
  const timeString = url.searchParams.get("time");
  const time = parseTimeUrlString(timeString ?? undefined);
  const dsParams: Record<string, string> = {};
  const urlParams = url.searchParams.getAll("ds.url").filter(Boolean);
  const urls =
    urlParams.length === 1 &&
    (ds === "remote-file" || ds === "mcap-remote-file" || ds === "ros1-remote-bagfile")
      ? (splitRemoteRecordingUrlList(urlParams[0]!) ?? urlParams)
      : urlParams;
  url.searchParams.forEach((v, k) => {
    if (k && v && k.startsWith("ds.")) {
      const cleanKey = k.replace(/^ds./, "");
      if (cleanKey !== "url" || urls.length === 1) {
        dsParams[cleanKey] = v;
      }
    }
  });

  const state: AppURLState = _.omitBy(
    {
      time,
      ds,
      layoutUrl,
      mcapBundleId,
      dsParams: _.isEmpty(dsParams) ? undefined : dsParams,
      dsParamsArray: urls.length > 1 ? { urls } : undefined,
    },
    _.isEmpty,
  );

  return _.isEmpty(state) ? undefined : state;
}

/**
 * Tries to parse app url state from the window's current location.
 */
export function windowAppURLState(): AppURLState | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return parseAppURLState(new URL(window.location.href));
  } catch {
    return undefined;
  }
}
