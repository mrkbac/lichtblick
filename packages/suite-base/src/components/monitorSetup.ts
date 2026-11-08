// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export type WindowBounds = { left: number; top: number; width: number; height: number };
export type MonitorScreen = WindowBounds & { label?: string };
export type SavedMonitor = { panelId: string; bounds: WindowBounds; screen?: MonitorScreen };
export type ManagedScreen = Screen & {
  availLeft: number;
  availTop: number;
  label?: string;
};

/** Request screen access only from an explicit save/restore action; unsupported/denied uses one screen. */
export async function monitorScreens(): Promise<MonitorScreen[]> {
  const api = window as Window & {
    getScreenDetails?: () => Promise<{ screens: ManagedScreen[] }>;
  };
  try {
    const details = await api.getScreenDetails?.();
    if (details != undefined && details.screens.length > 0) {
      return details.screens.map((screen) => ({
        left: screen.availLeft,
        top: screen.availTop,
        width: screen.availWidth,
        height: screen.availHeight,
        label: screen.label,
      }));
    }
  } catch {
    // Ordinary pop-outs still work when screen access is denied.
  }
  const screen = window.screen as Screen & Partial<Pick<ManagedScreen, "availLeft" | "availTop">>;
  return [
    {
      left: screen.availLeft ?? 0,
      top: screen.availTop ?? 0,
      width: screen.availWidth > 0 ? screen.availWidth : window.outerWidth,
      height: screen.availHeight > 0 ? screen.availHeight : window.outerHeight,
    },
  ];
}

function isBounds(value: unknown): value is WindowBounds {
  if (value == undefined || typeof value !== "object") {
    return false;
  }
  const bounds = value as Partial<WindowBounds>;
  return (
    [bounds.left, bounds.top, bounds.width, bounds.height].every(
      (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100_000,
    ) &&
    bounds.width! > 0 &&
    bounds.height! > 0
  );
}

/** Treat browser storage as untrusted; a malformed setup must never open arbitrary windows. */
export function readMonitorSetup(key: string): SavedMonitor[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(value) || value.length > 50) {
      return [];
    }
    return value.filter((item: unknown): item is SavedMonitor => {
      if (item == undefined || typeof item !== "object") {
        return false;
      }
      const saved = item as Partial<SavedMonitor>;
      return (
        typeof saved.panelId === "string" &&
        saved.panelId.length <= 256 &&
        isBounds(saved.bounds) &&
        (saved.screen == undefined ||
          (isBounds(saved.screen) &&
            (saved.screen.label == undefined || typeof saved.screen.label === "string")))
      );
    });
  } catch {
    return [];
  }
}

/** Capture outer bounds so restoring includes browser chrome, and remember the containing display. */
export function captureMonitor(
  panelId: string,
  child: Window,
  screens: MonitorScreen[],
): SavedMonitor {
  const bounds = {
    left: child.screenX,
    top: child.screenY,
    width: child.outerWidth,
    height: child.outerHeight,
  };
  const screen = screens.find(
    (s) =>
      bounds.left + bounds.width / 2 >= s.left &&
      bounds.left + bounds.width / 2 < s.left + s.width &&
      bounds.top + bounds.height / 2 >= s.top &&
      bounds.top + bounds.height / 2 < s.top + s.height,
  );
  return { panelId, bounds, screen };
}

/** Match a remembered display, then clamp to its current work area; missing displays fall back visibly. */
export function restoreMonitorBounds(saved: SavedMonitor, screens: MonitorScreen[]): WindowBounds {
  const previous = saved.screen;
  const matchingLabels = previous?.label ? screens.filter((s) => s.label === previous.label) : [];
  const screen =
    (matchingLabels.length === 1 ? matchingLabels[0] : undefined) ??
    screens.find(
      (s) =>
        previous != undefined &&
        s.left === previous.left &&
        s.top === previous.top &&
        s.width === previous.width &&
        s.height === previous.height,
    ) ??
    screens[0]!;
  const width = Math.min(Math.max(320, saved.bounds.width), screen.width);
  const height = Math.min(Math.max(240, saved.bounds.height), screen.height);
  const left = saved.bounds.left - (previous?.left ?? screen.left) + screen.left;
  const top = saved.bounds.top - (previous?.top ?? screen.top) + screen.top;
  return {
    width,
    height,
    left: Math.min(Math.max(screen.left, left), screen.left + screen.width - width),
    top: Math.min(Math.max(screen.top, top), screen.top + screen.height - height),
  };
}
