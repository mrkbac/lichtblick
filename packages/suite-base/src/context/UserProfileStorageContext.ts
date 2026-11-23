// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";

import { LayoutID } from "@lichtblick/suite-base/context/CurrentLayoutContext";

export type UserProfile = {
  /** The id of the layout the user is currently working with. */
  currentLayoutId?: LayoutID;

  /** Ids of the personal (local) layouts the user marked as favorite. */
  favoriteLayoutIds?: LayoutID[];
};

export type UserProfileStorage = {
  getUserProfile: () => Promise<UserProfile>;
  setUserProfile: (data: UserProfile | ((profile: UserProfile) => UserProfile)) => Promise<void>;
};

export const UserProfileStorageContext = createContext<UserProfileStorage | undefined>(undefined);
UserProfileStorageContext.displayName = "UserProfileStorageContext";
export function useUserProfileStorage(): UserProfileStorage {
  const storage = useContext(UserProfileStorageContext);
  if (storage == undefined) {
    throw new Error("A UserProfileStorage provider is required to useUserProfileStorage");
  }

  return storage;
}
