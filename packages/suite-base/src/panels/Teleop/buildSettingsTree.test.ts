// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { SettingsTreeAction, Topic } from "@lichtblick/suite";
import {
  applySettingsAction,
  buildSettingsTreeTeleop,
} from "@lichtblick/suite-base/panels/Teleop/buildSettingsTree";
import { DEFAULT_CONFIG } from "@lichtblick/suite-base/panels/Teleop/constants";
import PlayerBuilder from "@lichtblick/suite-base/testing/builders/PlayerBuilder";

function update(path: string[], value: unknown): SettingsTreeAction {
  return { action: "update", payload: { path, value, input: "string" } } as SettingsTreeAction;
}

describe("buildSettingsTreeTeleop", () => {
  it("lists topics of the selected message type first", () => {
    const topics = [
      PlayerBuilder.topic({ name: "/scan", schemaName: "sensor_msgs/LaserScan" }),
      PlayerBuilder.topic({ name: "/joy", schemaName: "sensor_msgs/msg/Joy" }),
      PlayerBuilder.topic({ name: "/cmd", schemaName: "geometry_msgs/msg/TwistStamped" }),
    ] as readonly Topic[];

    const twist = buildSettingsTreeTeleop(DEFAULT_CONFIG, topics);
    const joy = buildSettingsTreeTeleop({ ...DEFAULT_CONFIG, messageType: "Joy" }, topics);

    expect((twist.general?.fields?.topic as { items: string[] }).items[0]).toBe("/cmd");
    expect((joy.general?.fields?.topic as { items: string[] }).items[0]).toBe("/joy");
  });

  it("shows velocity mapping and gamepad actions only for Twist output", () => {
    const twist = buildSettingsTreeTeleop(DEFAULT_CONFIG, []);
    expect(twist.mapping?.fields?.["linear-x"]).toMatchObject({ value: "leftY" });
    expect(twist.mapping?.fields?.["linear-x-max"]).toMatchObject({ value: 1 });
    // unmapped fields hide their max
    expect(twist.mapping?.fields?.["linear-y-max"]).toBeUndefined();
    expect(twist.gamepad?.fields?.turboButton).toMatchObject({ value: "rb" });
    expect(twist.general?.fields?.joyEnableButton).toBeUndefined();

    const joy = buildSettingsTreeTeleop({ ...DEFAULT_CONFIG, messageType: "Joy" }, []);
    expect(joy.mapping).toBeUndefined();
    expect(joy.gamepad?.fields?.turboButton).toBeUndefined();
    expect(joy.general?.fields?.joyEnableButton).toBeDefined();
    expect(joy.general?.fields?.frameId).toBeDefined();
  });

  it("offers connected gamepads and keeps an unplugged saved one selectable", () => {
    const tree = buildSettingsTreeTeleop(
      { ...DEFAULT_CONFIG, gamepadId: "Old pad" },
      [],
      ["New pad"],
    );
    const options = (tree.gamepad?.fields?.gamepadId as { options: { value: string }[] }).options;
    expect(options.map((option) => option.value)).toEqual(["", "New pad", "Old pad"]);
  });

  it("hides gamepad details when the gamepad is disabled", () => {
    const tree = buildSettingsTreeTeleop({ ...DEFAULT_CONFIG, gamepad: false }, []);
    expect(tree.gamepad?.fields?.gamepadDeadzone).toBeUndefined();
  });
});

describe("applySettingsAction", () => {
  it("updates plain fields without touching the previous config", () => {
    const next = applySettingsAction(DEFAULT_CONFIG, update(["controls", "mode"], "dual"));
    expect(next.mode).toBe("dual");
    expect(DEFAULT_CONFIG.mode).toBe("joystick");
  });

  it("updates mapping inputs and max values", () => {
    let next = applySettingsAction(DEFAULT_CONFIG, update(["mapping", "linear-y"], "rightX"));
    next = applySettingsAction(next, update(["mapping", "linear-y-max"], 0.4));
    expect(next.mapping["linear-y"]).toEqual({ input: "rightX", max: 0.4 });
    expect(DEFAULT_CONFIG.mapping["linear-y"].input).toBe("none");
  });

  it("stores a cleared topic as an empty string", () => {
    const next = applySettingsAction(DEFAULT_CONFIG, update(["general", "topic"], undefined));
    expect(next.topic).toBe("");
  });

  it("switches a default topic along with the message type but keeps custom ones", () => {
    const joy = applySettingsAction(DEFAULT_CONFIG, update(["general", "messageType"], "Joy"));
    expect(joy.topic).toBe("/joy");

    const custom = applySettingsAction(
      { ...DEFAULT_CONFIG, topic: "/robot/drive" },
      update(["general", "messageType"], "Joy"),
    );
    expect(custom.topic).toBe("/robot/drive");

    const cleared = applySettingsAction(
      { ...DEFAULT_CONFIG, topic: "" },
      update(["general", "messageType"], "Joy"),
    );
    expect(cleared.topic).toBe("");
  });
});
