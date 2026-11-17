// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  customUrdfSettingsNode,
  resolveJointStatesTopic,
  urdfLinkNode,
  urdfSettingsNode,
} from "./layers";

describe("URDF settings", () => {
  it("gives a layout saved before the robot options the previous behavior", () => {
    // Given a custom layer from an older layout
    const saved = { sourceType: "url" as const, url: "package://robot.urdf", label: "Robot" };
    // When
    const fields = customUrdfSettingsNode(saved, [], [], ["/joints"], {}).fields!;
    // Then
    expect(fields.controlMode?.value).toBe("transforms");
    expect(fields.jointStatesTopic).toBeUndefined();
    expect(fields.opacity?.value).toBe(1);
    expect(fields.showOutlines?.value).toBe(true);
    expect(fields.showAxis?.value).toBe(false);
    expect(fields.axisScale).toBeUndefined();
  });

  it("offers joint states topics in joint states mode", () => {
    // When
    const fields = urdfSettingsNode(
      "Robot",
      { controlMode: "jointStates", showAxis: true, axisScale: 2 },
      ["/a/joints", "/b/joints"],
      {},
    ).fields!;
    // Then
    expect(fields.jointStatesTopic).toMatchObject({
      input: "autocomplete",
      items: ["/a/joints", "/b/joints"],
      value: "/a/joints",
    });
    expect(fields.axisScale?.value).toBe(2);
  });

  it.each([
    [{}, ["/a", "/b"], "/a"],
    [{ jointStatesTopic: "" }, ["/a"], "/a"],
    [{ jointStatesTopic: "/b" }, ["/a"], "/b"],
    [{}, [], undefined],
  ])("resolves the joint states topic of %o from %o", (config, topics, expected) => {
    expect(resolveJointStatesTopic(config, topics)).toBe(expected);
  });

  it("shows a link as visible without offset by default", () => {
    // When
    const node = urdfLinkNode("arm", undefined);
    // Then
    expect(node.label).toBe("arm");
    expect(node.visible).toBe(true);
    expect(node.fields?.position?.value).toEqual([0, 0, 0]);
    expect(node.fields?.rotation?.value).toEqual([0, 0, 0]);
  });

  it("shows a link's saved visibility and offset", () => {
    // When
    const node = urdfLinkNode("arm", { visible: false, position: [1, 2, 3], rotation: [0, 0, 90] });
    // Then
    expect(node.visible).toBe(false);
    expect(node.fields?.position?.value).toEqual([1, 2, 3]);
    expect(node.fields?.rotation?.value).toEqual([0, 0, 90]);
  });
});
