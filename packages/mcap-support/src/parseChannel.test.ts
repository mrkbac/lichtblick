// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import fs from "fs";
import { FileDescriptorSet, IFileDescriptorSet } from "protobufjs/ext/descriptor";

import { parseChannel } from "./parseChannel";

describe("parseChannel", () => {
  it("works with json/jsonschema", () => {
    const channel = parseChannel({
      messageEncoding: "json",
      schema: {
        name: "X",
        encoding: "jsonschema",
        data: new TextEncoder().encode(
          JSON.stringify({ type: "object", properties: { value: { type: "string" } } }),
        ),
      },
    });
    expect(channel.deserialize(new TextEncoder().encode(JSON.stringify({ value: "hi" })))).toEqual({
      value: "hi",
    });
  });

  it("works with flatbuffer", () => {
    const reflectionSchema = fs.readFileSync(`${__dirname}/fixtures/reflection.bfbs`);
    const reflectionSchemaUint8 = new Uint8Array(
      reflectionSchema.buffer,
      reflectionSchema.byteOffset,
      reflectionSchema.byteLength,
    );
    const channel = parseChannel({
      messageEncoding: "flatbuffer",
      schema: { name: "reflection.Schema", encoding: "flatbuffer", data: reflectionSchemaUint8 },
    });

    const deserialized = channel.deserialize(reflectionSchema) as {
      objects: Record<string, unknown>[];
    };
    expect(deserialized.objects.length).toEqual(10);
    expect(deserialized.objects[0]!.name).toEqual("reflection.Enum");
  });

  it("works with protobuf", () => {
    const fds = FileDescriptorSet.encode(FileDescriptorSet.root.toDescriptor("proto3")).finish();
    const channel = parseChannel({
      messageEncoding: "protobuf",
      schema: { name: "google.protobuf.FileDescriptorSet", encoding: "protobuf", data: fds },
    });
    const deserialized = channel.deserialize(fds) as IFileDescriptorSet;
    expect(deserialized.file[0]!.name).toEqual("google_protobuf.proto");
  });

  it("works with ros1", () => {
    const channel = parseChannel({
      messageEncoding: "ros1",
      schema: {
        name: "foo_msgs/Bar",
        encoding: "ros1msg",
        data: new TextEncoder().encode("string data"),
      },
    });

    const obj = channel.deserialize(new Uint8Array([4, 0, 0, 0, 65, 66, 67, 68]));
    expect(obj).toEqual({ data: "ABCD" });
  });

  it("rejects ros1 type names that would inject code into the generated reader", () => {
    const evil = "foo_msgs/X(){}};globalThis.injected=1;class Y{static Z";
    expect(() =>
      parseChannel({
        messageEncoding: "ros1",
        schema: {
          name: "foo_msgs/Bar",
          encoding: "ros1msg",
          data: new TextEncoder().encode(`${evil} x\n===\nMSG: ${evil}\nint32 y`),
        },
      }),
    ).toThrow();
    expect((globalThis as { injected?: number }).injected).toBeUndefined();
  });

  it("rejects ros1 type names injected through a MSG header", () => {
    const evil = "foo_msgs/X(){}};globalThis.injected=1;class Y{static Z";
    expect(() =>
      parseChannel({
        messageEncoding: "ros1",
        schema: {
          name: "foo_msgs/Bar",
          encoding: "ros1msg",
          data: new TextEncoder().encode(`int32 x\n===\nMSG: ${evil}\nint32 y`),
        },
      }),
    ).toThrow("Invalid message definition type name");
    expect((globalThis as { injected?: number }).injected).toBeUndefined();
  });

  it("works with ros2", () => {
    const channel = parseChannel({
      messageEncoding: "cdr",
      schema: {
        name: "foo_msgs/Bar",
        encoding: "ros2msg",
        data: new TextEncoder().encode("string data"),
      },
    });

    const obj = channel.deserialize(new Uint8Array([0, 1, 0, 0, 5, 0, 0, 0, 65, 66, 67, 68, 0]));
    expect(obj).toEqual({ data: "ABCD" });
  });

  it("resolves a bare ros2 type to the root's package when several packages define it", () => {
    const channel = parseChannel({
      messageEncoding: "cdr",
      schema: {
        name: "foo_msgs/msg/Bar",
        encoding: "ros2msg",
        data: new TextEncoder().encode(
          [
            "Time stamp",
            "builtin_interfaces/Time header_stamp",
            "================================================================================",
            "MSG: builtin_interfaces/Time",
            "int32 sec",
            "uint32 nanosec",
            "================================================================================",
            "MSG: foo_msgs/msg/Time",
            "uint8 value",
          ].join("\n"),
        ),
      },
    });

    expect(channel.datatypes.get("foo_msgs/msg/Bar")?.definitions[0]?.type).toBe(
      "foo_msgs/msg/Time",
    );
    const obj = channel.deserialize(
      new Uint8Array([0, 1, 0, 0, 7, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0]),
    );
    expect(obj).toEqual({ stamp: { value: 7 }, header_stamp: { sec: 1, nanosec: 2 } });
  });

  it("resolves a bare ros2 type when dependencies omit /msg/ from the package", () => {
    const channel = parseChannel({
      messageEncoding: "cdr",
      schema: {
        name: "foo_msgs/msg/Bar",
        encoding: "ros2msg",
        data: new TextEncoder().encode(
          [
            "Time stamp",
            "================================================================================",
            "MSG: builtin_interfaces/Time",
            "int32 sec",
            "uint32 nanosec",
            "================================================================================",
            "MSG: foo_msgs/Time",
            "uint8 value",
          ].join("\n"),
        ),
      },
    });

    expect(channel.datatypes.get("foo_msgs/msg/Bar")?.definitions[0]?.type).toBe("foo_msgs/Time");
  });

  it("works with ros2idl", () => {
    const channel = parseChannel({
      messageEncoding: "cdr",
      schema: {
        name: "foo_msgs/Bar",
        encoding: "ros2idl",
        data: new TextEncoder().encode(`
        module foo_msgs {
          struct Bar {string data;};
        };
        `),
      },
    });

    const obj = channel.deserialize(new Uint8Array([0, 1, 0, 0, 5, 0, 0, 0, 65, 66, 67, 68, 0]));
    expect(obj).toEqual({ data: "ABCD" });
  });
  it("works with omgidl xcdr2", () => {
    const channel = parseChannel({
      messageEncoding: "cdr",
      schema: {
        name: "foo_msgs::Bar",
        encoding: "omgidl",
        data: new TextEncoder().encode(`
        enum Color {RED, GREEN, BLUE};
        module foo_msgs {
          struct NonRootBar {string data;};
          struct Bar {foo_msgs::NonRootBar data; Color color;};
        };
        `),
      },
    });

    const obj = channel.deserialize(
      new Uint8Array([0, 1, 0, 0, 5, 0, 0, 0, 65, 66, 67, 68, 0, 0, 0, 0, 2, 0, 0, 0]),
    );
    expect(obj).toEqual({ data: { data: "ABCD" }, color: 2 });
  });
});
