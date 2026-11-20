// SPDX-License-Identifier: MPL-2.0

import { fromRFC3339String } from "@foxglove/rostime";

import { CatalogRecording, CatalogTopic } from "./types";

/**
 * A served catalog (schema v1): JSON that lists recordings to open from URLs. Relative URLs are
 * resolved against the catalog's own URL, so a catalog and its files can move together.
 *
 * ```jsonc
 * {
 *   "version": 1,
 *   "name": "Sample data",
 *   "recordings": [{
 *     "id": "droid",                                      // required, unique
 *     "name": "DROID",
 *     "source": { "type": "remote-file", "url": "droid-v1.mcap" }, // or "foxglove-websocket"
 *     "start": "2026-10-01T10:00:00.587056791Z",          // RFC 3339
 *     "end": "2026-10-01T10:12:00Z",
 *     "size": 993703, "messages": 1828,
 *     "topics": [{ "name": "/camera/wrist", "schema": "foxglove.CompressedVideo", "messages": 166 }],
 *     "thumbnail": "droid.jpg",                           // image URL
 *     "layout": "droid-layout.json",                      // applied when the recording opens
 *     "description": "DROID, Alexander Khazatsky et al. · CC BY 4.0"
 *   }]
 * }
 * ```
 */
export type ServedCatalog = { name?: string; recordings: CatalogRecording[] };

const SOURCE_TYPES = new Set(["remote-file", "foxglove-websocket"]);

/** A catalog that doesn't follow the schema; `key` is its message in the "catalog" namespace. */
export class CatalogError extends Error {
  public constructor(
    message: string,
    public readonly key: "catalogNotV1" | "catalogNeedsId" | "catalogNeedsSource",
    public readonly params: Record<string, string | number> = {},
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != undefined && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseTopics(value: unknown): CatalogTopic[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((topic): CatalogTopic[] => {
    if (!isRecord(topic) || typeof topic.name !== "string") {
      return [];
    }
    return [
      {
        name: topic.name,
        schema: typeof topic.schema === "string" ? topic.schema : "",
        messages: optionalNumber(topic.messages),
      },
    ];
  });
}

/** The URL's last path segment, decoded when it is valid UTF-8. */
function fileName(url: string): string {
  const name = new URL(url).pathname.split("/").pop()!;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Parse a catalog fetched from `catalogUrl`. Throws when it is not a v1 catalog. */
export function parseCatalog(json: unknown, catalogUrl: string): ServedCatalog {
  if (!isRecord(json) || json.version !== 1 || !Array.isArray(json.recordings)) {
    throw new CatalogError(
      "Not a catalog: expected version 1 and a recordings list",
      "catalogNotV1",
    );
  }
  const resolve = (url: unknown) =>
    typeof url === "string" && url !== "" ? new URL(url, catalogUrl).href : undefined;
  const ids = new Set<string>();
  const recordings = json.recordings.map((entry: unknown, index): CatalogRecording => {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id === "" || ids.has(entry.id)) {
      throw new CatalogError(`Recording ${index + 1} needs a unique id`, "catalogNeedsId", {
        number: index + 1,
      });
    }
    ids.add(entry.id);
    const source = entry.source;
    const url = isRecord(source) ? resolve(source.url) : undefined;
    if (!isRecord(source) || !SOURCE_TYPES.has(source.type as string) || url == undefined) {
      throw new CatalogError(
        `Recording "${entry.id}" needs a remote-file or foxglove-websocket source`,
        "catalogNeedsSource",
        { id: entry.id },
      );
    }
    return {
      id: entry.id,
      name: optionalString(entry.name) ?? fileName(url),
      source: { type: source.type as "remote-file" | "foxglove-websocket", url },
      start: typeof entry.start === "string" ? fromRFC3339String(entry.start) : undefined,
      end: typeof entry.end === "string" ? fromRFC3339String(entry.end) : undefined,
      size: optionalNumber(entry.size),
      messages: optionalNumber(entry.messages),
      topics: parseTopics(entry.topics),
      thumbnail: resolve(entry.thumbnail),
      layoutUrl: resolve(entry.layout),
      description: optionalString(entry.description),
    };
  });
  return { name: optionalString(json.name), recordings };
}
