/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  captureMonitor,
  capturePanelConfigs,
  monitorScreens,
  readMonitorSetup,
  restoreMonitorBounds,
} from "./monitorSetup";

const primary = { left: 0, top: 25, width: 1920, height: 1055, label: "Laptop" };
const external = { left: -2560, top: 0, width: 2560, height: 1440, label: "External" };
const saved = {
  panelId: "Tab!monitor",
  bounds: { left: -2500, top: 100, width: 1200, height: 800 },
  screen: external,
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("restores the same monitor and follows it when its position changes", () => {
  expect(restoreMonitorBounds(saved, [primary, external])).toEqual(saved.bounds);
  expect(restoreMonitorBounds(saved, [primary, { ...external, left: 1920 }])).toEqual({
    ...saved.bounds,
    left: 1980,
  });
});

it("clamps a disconnected or smaller screen onto an available work area", () => {
  expect(restoreMonitorBounds(saved, [primary])).toEqual({
    left: 60,
    top: 125,
    width: 1200,
    height: 800,
  });
  expect(restoreMonitorBounds(saved, [{ ...external, width: 800, height: 600 }])).toEqual({
    left: -2560,
    top: 0,
    width: 800,
    height: 600,
  });
});

it("does not confuse duplicate monitor labels", () => {
  expect(restoreMonitorBounds(saved, [{ ...primary, label: "External" }, external])).toEqual(
    saved.bounds,
  );
});

it("captures the display containing the window and its outer geometry", () => {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const child = iframe.contentWindow!;
  Object.defineProperties(child, {
    screenX: { value: -2500 },
    screenY: { value: 100 },
    outerWidth: { value: 1200 },
    outerHeight: { value: 800 },
  });
  expect(captureMonitor("Tab!monitor", child, [primary, external])).toEqual(saved);
  iframe.remove();
});

it("validates local storage without trusting imported identifiers or malformed geometry", () => {
  localStorage.setItem(
    "setup",
    JSON.stringify([
      saved,
      { ...saved, bounds: { ...saved.bounds, width: -1 } },
      { panelId: 1 },
      { ...saved, screen: { ...external, label: 3 } },
    ])!,
  );
  expect(readMonitorSetup("setup")).toEqual([saved]);
  expect(readMonitorSetup("different-layout")).toEqual([]);
  localStorage.setItem("setup", "broken");
  expect(readMonitorSetup("setup")).toEqual([]);
  localStorage.setItem("setup", JSON.stringify(Array(51).fill(saved))!);
  expect(readMonitorSetup("setup")).toEqual([]);
});

it("uses the Window Management API only when asked and falls back when access is denied", async () => {
  const getScreenDetails = vi.fn().mockResolvedValue({
    screens: [
      { availLeft: -2560, availTop: 0, availWidth: 2560, availHeight: 1440, label: "External" },
    ],
  });
  Object.defineProperty(window, "getScreenDetails", {
    configurable: true,
    value: getScreenDetails,
  });
  expect(getScreenDetails).not.toHaveBeenCalled();
  expect(await monitorScreens()).toEqual([external]);
  getScreenDetails.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  expect(await monitorScreens()).toHaveLength(1);
  Reflect.deleteProperty(window, "getScreenDetails");
  expect(await monitorScreens()).toHaveLength(1);
});

it("captures only the saved window and its nested views", () => {
  const configs = {
    "Tab!one": { tabs: [{ title: "Image", layout: { panels: ["Image!one"] } }] },
    "Image!one": { imageTopic: "/camera" },
    "Plot!other": { title: "Main workspace" },
  };
  expect(capturePanelConfigs({ configById: configs }, "Tab!one")).toEqual({
    "Tab!one": configs["Tab!one"],
    "Image!one": configs["Image!one"],
  });
});

it("keeps legacy geometry and validates saved view snapshots", () => {
  const valid = { ...saved, configs: { [saved.panelId]: { tabs: [] } } };
  localStorage.setItem(
    "setup",
    JSON.stringify([
      saved,
      valid,
      { ...saved, configs: [] },
      { ...saved, configs: { "Image!other": {} } },
      { ...saved, configs: { [saved.panelId]: null } },
    ])!,
  );
  expect(readMonitorSetup("setup")).toEqual([saved, valid]);
});
