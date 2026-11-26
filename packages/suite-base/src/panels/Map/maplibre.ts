// SPDX-License-Identifier: MPL-2.0

import { AJAXError, addProtocol, setWorkerUrl } from "maplibre-gl";
import type { RequestTransformFunction } from "maplibre-gl";
import { Protocol } from "pmtiles";

import { needsHttpProxy, proxiedFetch } from "@lichtblick/suite-base/util/httpProxy";

// Import MapLibre through this module so its global setup runs once for every panel using it.

// MapLibre locates its worker relative to its own module URL, which a bundle doesn't preserve.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
// pmtiles://https://host/archive.pmtiles works as a raster, elevation, or style source URL.
addProtocol("pmtiles", new Protocol().tile);

// An https page can't load http:// tiles (mixed content), and addProtocol ignores http(s)://.
// transformRequest renames those URLs to this scheme, whose handler fetches through the proxy
// extension. Requests from MapLibre's workers come back to this thread for unknown schemes.
const PROXY_SCHEME = "licht-proxy";
const PROXY_PREFIX = `${PROXY_SCHEME}://`;

addProtocol(PROXY_SCHEME, async (params, abortController) => {
  const url = params.url.slice(PROXY_PREFIX.length);
  const response = await proxiedFetch(url, {
    method: params.method,
    headers: params.headers as HeadersInit | undefined,
    credentials: params.credentials,
    signal: abortController.signal,
  });
  if (!response.ok) {
    throw new AJAXError(response.status, response.statusText, url, await response.blob());
  }
  const data =
    params.type === "json"
      ? ((await response.json()) as object)
      : params.type === "string"
        ? await response.text()
        : await response.arrayBuffer();
  return {
    data,
    cacheControl: response.headers.get("Cache-Control"),
    expires: response.headers.get("Expires"),
  };
});

/** Pass as MapOptions.transformRequest so http:// sources work on the https site. */
export const transformRequest: RequestTransformFunction = (url) =>
  needsHttpProxy(url) ? { url: PROXY_PREFIX + url } : undefined;

export { Map } from "maplibre-gl";
