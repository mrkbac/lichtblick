/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";
import * as _ from "lodash-es";
import { PropsWithChildren } from "react";

import { useShallowMemo } from "@lichtblick/hooks";
import { LOCAL_STORAGE_PROFILE_DATA } from "@lichtblick/suite-base/constants/browserStorageKeys";
import { LayoutID } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import {
  UserProfile,
  useUserProfileStorage,
} from "@lichtblick/suite-base/context/UserProfileStorageContext";
import UserProfileLocalStorageProvider from "@lichtblick/suite-base/providers/UserProfileLocalStorageProvider";
import { BasicBuilder } from "@lichtblick/test-builders";

vi.mock("@lichtblick/hooks");
vi.mock("lodash-es");

const mockedUseShallowMemo = vi.mocked(useShallowMemo);
const mockedLodash = vi.mocked(_);
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, "localStorage", {
  value: mockLocalStorage,
});

describe("UserProfileLocalStorageProvider", () => {
  const createLayoutId = (id: string): LayoutID => id as LayoutID;

  const mockUserProfile: UserProfile = {
    currentLayoutId: createLayoutId(BasicBuilder.string()),
    favoriteLayoutIds: [createLayoutId(BasicBuilder.string())],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(undefined);
    mockedUseShallowMemo.mockImplementation((obj) => obj);
    mockedLodash.merge.mockImplementation((target, source) => ({ ...target, ...source }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getUserProfile", () => {
    it("should return default profile when localStorage is empty", async () => {
      // Given
      mockLocalStorage.getItem.mockReturnValue(undefined);

      const wrapper = ({ children }: PropsWithChildren) => (
        <UserProfileLocalStorageProvider>{children}</UserProfileLocalStorageProvider>
      );

      // When
      const { result } = renderHook(() => useUserProfileStorage(), { wrapper });
      const profile = await result.current.getUserProfile();

      // Then
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith(LOCAL_STORAGE_PROFILE_DATA);
      expect(profile).toEqual({});
    });

    it("should return parsed profile from localStorage when data exists", async () => {
      // Given
      const storedProfile = JSON.stringify(mockUserProfile);
      mockLocalStorage.getItem.mockReturnValue(storedProfile);

      const wrapper = ({ children }: PropsWithChildren) => (
        <UserProfileLocalStorageProvider>{children}</UserProfileLocalStorageProvider>
      );

      // When
      const { result } = renderHook(() => useUserProfileStorage(), { wrapper });
      const profile = await result.current.getUserProfile();

      // Then
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith(LOCAL_STORAGE_PROFILE_DATA);
      expect(profile).toEqual(mockUserProfile);
    });

    it("should return default profile when localStorage contains invalid JSON", async () => {
      // Given
      mockLocalStorage.getItem.mockReturnValue("invalid-json");
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const wrapper = ({ children }: PropsWithChildren) => (
        <UserProfileLocalStorageProvider>{children}</UserProfileLocalStorageProvider>
      );

      // When & Then
      const { result } = renderHook(() => useUserProfileStorage(), { wrapper });
      await expect(result.current.getUserProfile()).rejects.toThrow();

      // Cleanup
      consoleSpy.mockRestore();
    });
  });

  describe("setUserProfile", () => {
    it("should store new profile when localStorage is empty", async () => {
      // Given
      mockLocalStorage.getItem.mockReturnValue(undefined);
      const layoutId = BasicBuilder.string();
      const newProfile: UserProfile = { currentLayoutId: createLayoutId(layoutId) };

      const wrapper = ({ children }: PropsWithChildren) => (
        <UserProfileLocalStorageProvider>{children}</UserProfileLocalStorageProvider>
      );

      // When
      const { result } = renderHook(() => useUserProfileStorage(), { wrapper });
      await result.current.setUserProfile(newProfile);

      // Then
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith(LOCAL_STORAGE_PROFILE_DATA);
      expect(mockedLodash.merge).toHaveBeenCalledWith({}, newProfile);
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        LOCAL_STORAGE_PROFILE_DATA,
        JSON.stringify({ currentLayoutId: layoutId }),
      );
    });

    it("should merge new profile with existing profile", async () => {
      // Given
      const existingProfile: UserProfile = {
        currentLayoutId: createLayoutId(BasicBuilder.string()),
      };
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(existingProfile));
      const newProfile: UserProfile = {
        favoriteLayoutIds: [createLayoutId(BasicBuilder.string())],
      };
      const mergedProfile = { ...existingProfile, ...newProfile };
      mockedLodash.merge.mockReturnValue(mergedProfile);

      const wrapper = ({ children }: PropsWithChildren) => (
        <UserProfileLocalStorageProvider>{children}</UserProfileLocalStorageProvider>
      );

      // When
      const { result } = renderHook(() => useUserProfileStorage(), { wrapper });
      await result.current.setUserProfile(newProfile);

      // Then
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith(LOCAL_STORAGE_PROFILE_DATA);
      expect(mockedLodash.merge).toHaveBeenCalledWith(existingProfile, newProfile);
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        LOCAL_STORAGE_PROFILE_DATA,
        JSON.stringify(mergedProfile),
      );
    });

    it("should handle function-based profile updates", async () => {
      // Given
      const existingProfile: UserProfile = {
        currentLayoutId: createLayoutId(BasicBuilder.string()),
      };
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(existingProfile));
      const updateFunction = (prev: UserProfile) => ({
        ...prev,
        favoriteLayoutIds: [createLayoutId("favorite")],
      });
      const expectedResult = updateFunction(existingProfile);

      const wrapper = ({ children }: PropsWithChildren) => (
        <UserProfileLocalStorageProvider>{children}</UserProfileLocalStorageProvider>
      );

      // When
      const { result } = renderHook(() => useUserProfileStorage(), { wrapper });
      await result.current.setUserProfile(updateFunction);

      // Then
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith(LOCAL_STORAGE_PROFILE_DATA);
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        LOCAL_STORAGE_PROFILE_DATA,
        JSON.stringify(expectedResult),
      );
    });

    it("should handle empty string from JSON.stringify", async () => {
      // Given
      mockLocalStorage.getItem.mockReturnValue(undefined);
      const newProfile: UserProfile = {};
      const originalStringify = JSON.stringify;
      JSON.stringify = vi.fn().mockReturnValue(undefined);

      const wrapper = ({ children }: PropsWithChildren) => (
        <UserProfileLocalStorageProvider>{children}</UserProfileLocalStorageProvider>
      );

      // When
      const { result } = renderHook(() => useUserProfileStorage(), { wrapper });
      await result.current.setUserProfile(newProfile);

      // Then
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(LOCAL_STORAGE_PROFILE_DATA, "");

      // Restore original JSON.stringify
      JSON.stringify = originalStringify;
    });
  });

  describe("provider integration", () => {
    it("should use useShallowMemo for performance optimization", () => {
      // Given
      const wrapper = ({ children }: PropsWithChildren) => (
        <UserProfileLocalStorageProvider>{children}</UserProfileLocalStorageProvider>
      );

      // When
      renderHook(() => useUserProfileStorage(), { wrapper });

      // Then
      expect(mockedUseShallowMemo).toHaveBeenCalledWith({
        getUserProfile: expect.any(Function),
        setUserProfile: expect.any(Function),
      });
    });
  });

  describe("edge cases", () => {
    it("should handle undefined localStorage item correctly", async () => {
      // Given
      mockLocalStorage.getItem.mockReturnValue(undefined as any);

      const wrapper = ({ children }: PropsWithChildren) => (
        <UserProfileLocalStorageProvider>{children}</UserProfileLocalStorageProvider>
      );

      // When
      const { result } = renderHook(() => useUserProfileStorage(), { wrapper });
      const profile = await result.current.getUserProfile();

      // Then
      expect(profile).toEqual({});
    });

    it("should handle null values in profile updates", async () => {
      // Given
      mockLocalStorage.getItem.mockReturnValue(undefined);
      const profileWithNulls: Partial<UserProfile> = {
        currentLayoutId: undefined,
        favoriteLayoutIds: undefined,
      };

      const wrapper = ({ children }: PropsWithChildren) => (
        <UserProfileLocalStorageProvider>{children}</UserProfileLocalStorageProvider>
      );

      // When
      const { result } = renderHook(() => useUserProfileStorage(), { wrapper });
      await result.current.setUserProfile(profileWithNulls);

      // Then
      expect(mockedLodash.merge).toHaveBeenCalledWith({}, profileWithNulls);
    });
  });
});
