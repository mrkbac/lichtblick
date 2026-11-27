// SPDX-License-Identifier: MPL-2.0

import { AJAXError, addProtocol, setWorkerUrl } from "maplibre-gl";
import type { RequestTransformFunction } from "maplibre-gl";
import { EtagMismatch, PMTiles, Protocol } from "pmtiles";
import type { RangeResponse, Source } from "pmtiles";

import { needsHttpProxy, proxiedFetch } from "@lichtblick/suite-base/util/httpProxy";

// Import MapLibre through this module so its global setup runs once for every panel using it.

// MapLibre locates its worker relative to its own module URL, which a bundle doesn't preserve.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

/** pmtiles' FetchSource, but through proxiedFetch so http:// archives work on the https site. */
class ProxiedSource implements Source {
  readonly #url: string;

  public constructor(url: string) {
    this.#url = url;
  }

  public getKey(): string {
    return this.#url;
  }

  // ponytail: no 416 retry for archives under 16 KiB, which FetchSource handles
  public async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    const response = await proxiedFetch(this.#url, {
      signal,
      headers: { range: `bytes=${offset}-${offset + length - 1}` },
    });
    const newEtag = response.headers.get("ETag") ?? undefined;
    if (
      etag != undefined &&
      newEtag != undefined &&
      !newEtag.startsWith("W/") &&
      newEtag !== etag
    ) {
      throw new EtagMismatch(`Archive changed on the server (ETag ${newEtag})`);
    }
    if (response.status >= 300) {
      throw new Error(`Bad response code: ${response.status}`);
    }
    const size = response.headers.get("Content-Length");
    // A 200 is fine only when the whole file fits in the requested range
    if (response.status === 200 && (size == undefined || Number(size) > length)) {
      throw new Error("The server ignored the byte range; it must support HTTP range requests");
    }
    return {
      data: await response.arrayBuffer(),
      etag: newEtag,
      cacheControl: response.headers.get("Cache-Control") ?? undefined,
      expires: response.headers.get("Expires") ?? undefined,
    };
  }
}

// pmtiles://https://host/archive.pmtiles works as a raster, elevation, or style source URL.
const pmtiles = new Protocol();
// Same URL shapes pmtiles' handler parses: "pmtiles://<archive>" or ".../<z>/<x>/<y>"
const PMTILES_TILE = /pmtiles:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)/;
addProtocol("pmtiles", async (params, abortController) => {
  const archive =
    params.type === "json"
      ? params.url.slice("pmtiles://".length)
      : PMTILES_TILE.exec(params.url)?.[1];
  if (archive != undefined && needsHttpProxy(archive) && pmtiles.get(archive) == undefined) {
    pmtiles.add(new PMTiles(new ProxiedSource(archive)));
  }
  return await pmtiles.tile(params, abortController);
});

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
