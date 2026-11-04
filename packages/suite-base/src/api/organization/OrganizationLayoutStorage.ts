// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  SaveNewLayoutParams,
  UpdateLayoutRequest,
  UpdateLayoutResponse,
} from "@lichtblick/suite-base/api/layouts/types";
import { LayoutID } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { ISO8601Timestamp } from "@lichtblick/suite-base/services/ILayoutStorage";
import { IRemoteLayoutFavoritesStorage } from "@lichtblick/suite-base/services/IRemoteLayoutFavoritesStorage";
import {
  IRemoteLayoutStorage,
  RemoteLayout,
} from "@lichtblick/suite-base/services/IRemoteLayoutStorage";

import { OrganizationApiClient, OrganizationApiError, Schemas, revisionETag } from "./client";

type ApiLayout = Schemas["Layout"];
type LayoutSummary = Schemas["LayoutSummary"];

/**
 * Layouts and favorites from every organization the user can read, behind the existing
 * single-remote interfaces used by the LayoutManager.
 *
 * A layout's `externalId` is its id (layout ids are UUIDs, unique across organizations). The
 * organization and revision of each layout are remembered here, so callers never pass them.
 */
export class OrganizationLayoutStorage
  implements IRemoteLayoutStorage, IRemoteLayoutFavoritesStorage
{
  public readonly workspace: string;

  readonly #client: OrganizationApiClient;
  readonly #session: Schemas["CurrentSession"];
  /** Last seen full layout, by id. Used to skip refetching unchanged layouts. */
  readonly #layouts = new Map<string, ApiLayout>();
  /** Organization of each layout id, also filled from favorites. */
  readonly #organizationOf = new Map<string, string>();
  /** Last list ETag and its summaries, by organization id. */
  readonly #lists = new Map<string, { etag: string; items: LayoutSummary[] }>();

  public constructor(client: OrganizationApiClient, session: Schemas["CurrentSession"]) {
    this.#client = client;
    this.#session = session;
    this.workspace = session.user.id;
  }

  /** Organizations the user can read layouts in, in display order. */
  public organizations(): Schemas["Organization"][] {
    return this.#session.organizations.filter((org) => org.permissions.includes("layouts:read"));
  }

  public organizationIdOf(layoutId: string): string | undefined {
    return this.#organizationOf.get(layoutId);
  }

  public canWrite(organizationId: string): boolean {
    return this.#session.organizations.some(
      (org) => org.id === organizationId && org.permissions.includes("layouts:write"),
    );
  }

  public async getLayouts(): Promise<readonly RemoteLayout[]> {
    const perOrganization = await Promise.all(
      this.organizations().map(async (org) => {
        const summaries = await this.#listLayouts(org.id);
        return await Promise.all(summaries.map(async (summary) => await this.#full(summary)));
      }),
    );
    return perOrganization.flat().map((layout) => this.#toRemote(layout));
  }

  public async getLayout(id: LayoutID): Promise<RemoteLayout | undefined> {
    const organizationId = this.#organizationOf.get(id);
    if (organizationId == undefined) {
      return undefined;
    }
    const { data, error, response } = await this.#client.GET(
      "/v1/organizations/{organizationId}/layouts/{layoutId}",
      { params: { path: { organizationId, layoutId: id } } },
    );
    if (response.status === 404) {
      return undefined;
    }
    if (!data) {
      throw new OrganizationApiError(response, error);
    }
    return this.#toRemote(this.#remember(data));
  }

  public async saveNewLayout(params: SaveNewLayoutParams): Promise<RemoteLayout> {
    const { organizationId } = params;
    if (organizationId == undefined) {
      throw new Error("Choose an organization to save the layout in");
    }
    const { data, error, response } = await this.#client.POST(
      "/v1/organizations/{organizationId}/layouts",
      {
        params: { path: { organizationId } },
        body: { id: params.id, displayName: params.name, data: params.data },
      },
    );
    if (data) {
      return this.#toRemote(this.#remember(data));
    }
    // A retried create that already succeeded: the existing layout is ours.
    if (
      response.status === 409 &&
      "current" in error &&
      error.current.createdBy.id === this.#session.user.id
    ) {
      return this.#toRemote(this.#remember(error.current));
    }
    throw new OrganizationApiError(response, error);
  }

  public async updateLayout(params: UpdateLayoutRequest): Promise<UpdateLayoutResponse> {
    const known = this.#layouts.get(params.externalId);
    if (!known) {
      return { status: "conflict" };
    }
    const { data, error, response } = await this.#client.PUT(
      "/v1/organizations/{organizationId}/layouts/{layoutId}",
      {
        params: {
          path: { organizationId: known.organizationId, layoutId: known.id },
          header: { "If-Match": revisionETag(known.revision) },
        },
        // Full replacement: unchanged fields are resent from the last known version.
        body: {
          displayName: params.name ?? known.displayName,
          data: params.data ?? known.data,
        },
      },
    );
    if (data) {
      return {
        status: "success",
        newLayout: this.#toRemote(this.#remember(data)),
      };
    }
    if (response.status === 412) {
      if ("current" in error) {
        this.#remember(error.current);
      }
      return { status: "conflict" };
    }
    throw new OrganizationApiError(response, error);
  }

  public async deleteLayout(id: string): Promise<boolean> {
    const known = this.#layouts.get(id);
    if (!known) {
      return false;
    }
    const { error, response } = await this.#client.DELETE(
      "/v1/organizations/{organizationId}/layouts/{layoutId}",
      {
        params: {
          path: { organizationId: known.organizationId, layoutId: id },
          header: { "If-Match": revisionETag(known.revision) },
        },
      },
    );
    if (response.status === 404) {
      this.#forget(id);
      return false;
    }
    if (!response.ok) {
      throw new OrganizationApiError(response, error);
    }
    this.#forget(id);
    return true;
  }

  public async getFavoriteLayoutIds(): Promise<readonly string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const { data, error, response } = await this.#client.GET("/v1/me/favorite-layouts", {
        params: { query: { cursor } },
      });
      if (!data) {
        throw new OrganizationApiError(response, error);
      }
      for (const favorite of data.items) {
        this.#organizationOf.set(favorite.layoutId, favorite.organizationId);
        ids.push(favorite.layoutId);
      }
      cursor = data.nextCursor ?? undefined;
    } while (cursor != undefined);
    return ids;
  }

  public async addFavoriteLayout(externalId: string): Promise<void> {
    await this.#setFavorite(externalId, { favorite: true });
  }

  public async removeFavoriteLayout(externalId: string): Promise<void> {
    await this.#setFavorite(externalId, { favorite: false });
  }

  async #setFavorite(layoutId: string, { favorite }: { favorite: boolean }): Promise<void> {
    const organizationId = this.#organizationOf.get(layoutId);
    if (organizationId == undefined) {
      throw new Error(`Unknown layout ${layoutId}`);
    }
    const options = { params: { path: { organizationId, layoutId } } };
    const path = "/v1/me/favorite-layouts/{organizationId}/{layoutId}";
    const { error, response } = favorite
      ? await this.#client.PUT(path, options)
      : await this.#client.DELETE(path, options);
    if (!response.ok) {
      throw new OrganizationApiError(response, error);
    }
  }

  /** All summaries of one organization; reuses the previous result when the list is unchanged. */
  async #listLayouts(organizationId: string): Promise<LayoutSummary[]> {
    const previous = this.#lists.get(organizationId);
    const items: LayoutSummary[] = [];
    let etag: string | undefined;
    let cursor: string | undefined;
    do {
      const { data, error, response } = await this.#client.GET(
        "/v1/organizations/{organizationId}/layouts",
        {
          params: {
            path: { organizationId },
            query: { cursor },
            header:
              cursor == undefined && previous ? { "If-None-Match": previous.etag } : undefined,
          },
        },
      );
      if (response.status === 304 && previous) {
        return previous.items;
      }
      if (!data) {
        throw new OrganizationApiError(response, error);
      }
      etag ??= response.headers.get("ETag") ?? undefined;
      items.push(...data.items);
      cursor = data.nextCursor ?? undefined;
    } while (cursor != undefined);

    if (etag != undefined) {
      this.#lists.set(organizationId, { etag, items });
    }
    return items;
  }

  /** The full layout for a summary, fetched only if its revision changed. */
  async #full(summary: LayoutSummary): Promise<ApiLayout> {
    const cached = this.#layouts.get(summary.id);
    if (cached?.revision === summary.revision) {
      return cached;
    }
    const { data, error, response } = await this.#client.GET(
      "/v1/organizations/{organizationId}/layouts/{layoutId}",
      {
        params: {
          path: {
            organizationId: summary.organizationId,
            layoutId: summary.id,
          },
        },
      },
    );
    if (!data) {
      throw new OrganizationApiError(response, error);
    }
    return this.#remember(data);
  }

  #remember(layout: ApiLayout): ApiLayout {
    this.#layouts.set(layout.id, layout);
    this.#organizationOf.set(layout.id, layout.organizationId);
    return layout;
  }

  #forget(id: string): void {
    this.#layouts.delete(id);
  }

  #toRemote(layout: ApiLayout): RemoteLayout {
    return {
      id: layout.id as LayoutID,
      externalId: layout.id,
      name: layout.displayName,
      data: layout.data as LayoutData,
      permission: this.canWrite(layout.organizationId) ? "ORG_WRITE" : "ORG_READ",
      savedAt: layout.updatedAt as ISO8601Timestamp,
    };
  }
}
