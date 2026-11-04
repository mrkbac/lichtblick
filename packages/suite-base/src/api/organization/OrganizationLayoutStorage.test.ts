// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LayoutID } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { ISO8601Timestamp } from "@lichtblick/suite-base/services/ILayoutStorage";
import LayoutBuilder from "@lichtblick/suite-base/testing/builders/LayoutBuilder";

import { OrganizationLayoutStorage } from "./OrganizationLayoutStorage";
import { Schemas, cleanText, createOrganizationApiClient, fetchCurrentSession } from "./client";

const me = { id: "user-1", displayName: "Me" };

const session: Schemas["CurrentSession"] = {
  user: me,
  links: [],
  organizations: [
    { id: "team", displayName: "Team", permissions: ["layouts:read"] },
    { id: "mine", displayName: "Mine", permissions: ["layouts:read", "layouts:write"] },
    { id: "hidden", displayName: "Hidden", permissions: ["extensions:read"] },
  ],
};

const layoutData = LayoutBuilder.data();

function layout(organizationId: string, id: string, revision = 1): Schemas["Layout"] {
  return {
    id,
    organizationId,
    revision,
    displayName: `Layout ${id}`,
    data: layoutData,
    createdAt: "2026-11-04T00:00:00Z",
    updatedAt: `2026-11-04T00:00:0${revision}Z`,
    createdBy: me,
    updatedBy: me,
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function setup(handler: (request: Request) => Response) {
  const requests: Request[] = [];
  // openapi-fetch passes a Request; the test environment has no fetch of its own.
  globalThis.fetch = (async (input: Request) => {
    requests.push(input.clone());
    return handler(input);
  }) as unknown as typeof fetch;
  const client = createOrganizationApiClient("https://api.example.com/", async () => "token");
  return { storage: new OrganizationLayoutStorage(client, session), requests };
}

function route(request: Request): string {
  return `${request.method} ${new URL(request.url).pathname}`;
}

describe("OrganizationLayoutStorage", () => {
  it("lists readable organizations and refetches nothing when the list is unchanged", async () => {
    const { storage, requests } = setup((request) => {
      const org = new URL(request.url).pathname.split("/")[3]!;
      const id = `${org}-layout`;
      if (route(request).endsWith("/layouts")) {
        if (request.headers.get("If-None-Match") === `"list-${org}"`) {
          return new Response(undefined, { status: 304 });
        }
        const { data: _data, ...summary } = layout(org, id);
        return json(200, { items: [summary], nextCursor: null }, { ETag: `"list-${org}"` });
      }
      return json(200, layout(org, id));
    });

    const first = await storage.getLayouts();
    expect(first.map((l) => [l.id, l.permission])).toEqual([
      ["team-layout", "ORG_READ"],
      ["mine-layout", "ORG_WRITE"],
    ]);
    expect(requests.every((r) => r.headers.get("Authorization") === "Bearer token")).toBe(true);
    expect(requests.some((r) => r.url.includes("/hidden/"))).toBe(false);

    requests.length = 0;
    expect(await storage.getLayouts()).toEqual(first);
    expect(requests.map(route)).toEqual([
      "GET /v1/organizations/team/layouts",
      "GET /v1/organizations/mine/layouts",
    ]);
  });

  it("sends If-Match with the known revision and reports a stale one as a conflict", async () => {
    const { storage, requests } = setup((request) => {
      if (request.method === "POST") {
        return json(201, layout("mine", "a", 4));
      }
      return json(412, {
        type: "about:blank",
        title: "Stale",
        status: 412,
        current: layout("mine", "a", 5),
      });
    });
    await storage.saveNewLayout({
      id: "a" as LayoutID,
      name: "Layout a",
      permission: "ORG_WRITE",
      data: layoutData,
      organizationId: "mine",
    });

    const result = await storage.updateLayout({
      id: "a" as LayoutID,
      externalId: "a",
      name: "Renamed",
      savedAt: "2026-11-04T00:00:09Z" as ISO8601Timestamp,
    });

    expect(result).toEqual({ status: "conflict" });
    const put = requests.at(-1)!;
    expect(route(put)).toBe("PUT /v1/organizations/mine/layouts/a");
    expect(put.headers.get("If-Match")).toBe('"4"');
    expect(await put.json()).toEqual({ displayName: "Renamed", data: layoutData });
  });

  it("treats a retried create of its own layout as success", async () => {
    const { storage } = setup(() =>
      json(409, {
        type: "about:blank",
        title: "Exists",
        status: 409,
        current: layout("mine", "b"),
      }),
    );
    const saved = await storage.saveNewLayout({
      id: "b" as LayoutID,
      name: "Layout b",
      permission: "ORG_WRITE",
      data: layoutData,
      organizationId: "mine",
    });
    expect(saved.externalId).toBe("b");
  });

  it("cleans layout names and fails the whole list on invalid data", async () => {
    // Leaving a layout out would make the sync delete its local copy, so the list must fail.
    let includeBad = false;
    const { storage } = setup((request) => {
      if (!route(request).startsWith("GET /v1/organizations/mine")) {
        return json(200, { items: [], nextCursor: null });
      }
      const good = { ...layout("mine", "good"), displayName: "Evil\u202Egnp.exe\u0007" };
      const bad = { ...layout("mine", "bad"), data: { configById: "<script>" } };
      if (route(request).endsWith("/layouts")) {
        const { data: _a, ...goodSummary } = good;
        const { data: _b, ...badSummary } = bad;
        const items = includeBad ? [goodSummary, badSummary] : [goodSummary];
        return json(200, { items, nextCursor: null });
      }
      return json(200, route(request).endsWith("/good") ? good : bad);
    });
    const layouts = await storage.getLayouts();
    expect(layouts.map((l) => [l.id, l.name])).toEqual([["good", "Evilgnp.exe"]]);

    includeBad = true;
    await expect(storage.getLayouts()).rejects.toThrow(/is invalid/);
  });

  it("encodes path parameters", async () => {
    const { storage, requests } = setup(() => json(404, { type: "x", title: "x", status: 404 }));
    await storage
      .saveNewLayout({
        id: "a" as LayoutID,
        name: "a",
        permission: "ORG_WRITE",
        data: layoutData,
        organizationId: "../me?x=1#",
      })
      .catch(() => undefined);
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/organizations/..%2Fme%3Fx%3D1%23/layouts");
  });
});

describe("fetchCurrentSession", () => {
  it("cleans names and drops links and avatars Lichtblick must not open", async () => {
    globalThis.fetch = async () =>
      json(200, {
        user: { id: "u", displayName: " A\u202Edmin\n", avatarUrl: "javascript:alert(1)" },
        organizations: [{ id: "o", displayName: "\u2066Team\u2069", permissions: [] }],
        links: [
          { id: "ok", label: "Account", url: "https://auth.example.com/account" },
          { id: "js", label: "Bad", url: "javascript:alert(1)" },
          { id: "data", label: "Bad", url: "data:text/html,<script>alert(1)</script>" },
          { id: "http", label: "Bad", url: "http://example.com" },
        ],
      });
    const client = createOrganizationApiClient("https://api.example.com", async () => undefined);
    const result = await fetchCurrentSession(client);
    expect(result).toEqual({
      status: "authenticated",
      session: {
        user: { id: "u", displayName: "Admin" },
        organizations: [{ id: "o", displayName: "Team", permissions: [] }],
        links: [{ id: "ok", label: "Account", url: "https://auth.example.com/account" }],
      },
    });
  });

  it("caps long text", () => {
    expect(cleanText("x".repeat(300), 200)).toHaveLength(200);
  });
});
