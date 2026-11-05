// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// End to end through LayoutManager: share, rename, reload, sync, against an in-memory server
// that follows openapi.yaml (revisions, ETags, list versions).

import { Layout } from "@lichtblick/suite-base/services/ILayoutStorage";
import LayoutManager from "@lichtblick/suite-base/services/LayoutManager/LayoutManager";
import MockLayoutStorage from "@lichtblick/suite-base/services/MockLayoutStorage";
import { migrateLayout } from "@lichtblick/suite-base/services/migrateLayout";
import LayoutBuilder from "@lichtblick/suite-base/testing/builders/LayoutBuilder";

import { OrganizationLayoutStorage } from "./OrganizationLayoutStorage";
import { Schemas, createOrganizationApiClient } from "./client";

const me = { id: "user-1", displayName: "Me" };
const session: Schemas["CurrentSession"] = {
  user: me,
  links: [],
  organizations: [
    { id: "team", displayName: "Team", permissions: ["layouts:read", "layouts:write"] },
  ],
};

type StoredLayout = Schemas["Layout"];

/** Minimal organization API server for one organization. */
function fakeServer() {
  const layouts = new Map<string, StoredLayout>();
  let version = 0;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // v1 organizations team layouts [id]
    if (url.pathname === "/v1/me/favorite-layouts") {
      return json(200, { items: [], nextCursor: null });
    }
    const id = parts[4];
    const now = new Date().toISOString();
    if (request.method === "GET" && id == undefined) {
      const etag = `W/"${version}"`;
      if (request.headers.get("If-None-Match") === etag) {
        return new Response(undefined, { status: 304 });
      }
      const items = [...layouts.values()].map(({ data: _data, ...summary }) => summary);
      return json(200, { items, nextCursor: null }, { ETag: etag });
    }
    if (request.method === "POST") {
      const body = (await request.json()) as Schemas["LayoutCreate"];
      const layout: StoredLayout = {
        ...body,
        id: body.id.toLowerCase(),
        organizationId: "team",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: me,
        updatedBy: me,
      };
      layouts.set(layout.id, layout);
      version++;
      return json(201, layout, { ETag: `"1"` });
    }
    const existing = id != undefined ? layouts.get(id) : undefined;
    if (!existing) {
      return json(404, { type: "/problems/not-found", title: "Not found", status: 404 });
    }
    if (request.method === "GET") {
      return json(200, existing, { ETag: `"${existing.revision}"` });
    }
    if (request.headers.get("If-Match") !== `"${existing.revision}"`) {
      return json(412, {
        type: "/problems/revision-mismatch",
        title: "Stale",
        status: 412,
        current: existing,
      });
    }
    if (request.method === "PUT") {
      const body = (await request.json()) as Schemas["LayoutWrite"];
      const updated = { ...existing, ...body, revision: existing.revision + 1, updatedAt: now };
      layouts.set(existing.id, updated);
      version++;
      return json(200, updated, { ETag: `"${updated.revision}"` });
    }
    layouts.delete(existing.id);
    version++;
    return new Response(undefined, { status: 204 });
  };
  return { layouts, handle };
}

/** Reads go through migrateLayout and a structured clone, like IdbLayoutStorage. */
class StoredLayoutStorage extends MockLayoutStorage {
  public override async list(namespace: string): Promise<readonly Layout[]> {
    return (await super.list(namespace)).map((layout) => migrateLayout(structuredClone(layout)));
  }

  public override async get(namespace: string, id: string): Promise<Layout | undefined> {
    const layout = await super.get(namespace, id);
    return layout && migrateLayout(structuredClone(layout));
  }
}

describe("organization layouts through LayoutManager", () => {
  it("keeps a shared and renamed layout after a reload", async () => {
    const server = fakeServer();
    globalThis.fetch = (async (input: Request) => await server.handle(input)) as typeof fetch;
    const browserStorage = new StoredLayoutStorage(LayoutManager.LOCAL_STORAGE_NAMESPACE, []);

    const open = () => {
      const client = createOrganizationApiClient("https://api.example.com", async () => "token");
      const storage = new OrganizationLayoutStorage(client, session);
      const manager = new LayoutManager({
        local: browserStorage,
        remote: storage,
        remoteFavorites: storage,
      });
      manager.setOnline({ online: true });
      return manager;
    };

    // Before login the app runs local-only on the same browser storage.
    const localOnly = new LayoutManager({ local: browserStorage, remote: undefined });
    await localOnly.getLayouts();

    const first = open();
    await first.syncWithRemote(new AbortController().signal);
    const shared = await first.saveNewLayout({
      name: "Shared",
      data: LayoutBuilder.data(),
      permission: "ORG_WRITE",
      organizationId: "team",
    });
    await first.updateLayout({ id: shared.id, name: "Renamed", data: undefined });
    await first.syncWithRemote(new AbortController().signal);
    expect((await first.getLayouts()).map((l) => l.name)).toEqual(["Renamed"]);

    // Reload: a fresh session object and LayoutManager over the same browser storage.
    const second = open();
    expect((await second.getLayouts()).map((l) => l.name)).toEqual(["Renamed"]);
    await second.syncWithRemote(new AbortController().signal);
    expect((await second.getLayouts()).map((l) => [l.name, l.organizationId])).toEqual([
      ["Renamed", "team"],
    ]);
    expect([...server.layouts.values()].map((l) => l.displayName)).toEqual(["Renamed"]);
  });
});
