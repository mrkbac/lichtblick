// SPDX-License-Identifier: MPL-2.0

import { DraggedMessagePath } from "@lichtblick/suite-base/components/PanelExtensionAdapter";

import { addPathsDrop, addTopicsDrop, replaceDrop } from "./pathDrop";

const image: DraggedMessagePath = {
  path: "/cam",
  rootSchemaName: "pkg/Image",
  isTopic: true,
  isLeaf: false,
  topicName: "/cam",
};
const imageField: DraggedMessagePath = {
  ...image,
  path: "/cam.data",
  isTopic: false,
};
const other: DraggedMessagePath = {
  ...image,
  path: "/odom",
  rootSchemaName: "pkg/Odom",
  topicName: "/odom",
};
const isImage = (item: DraggedMessagePath) => item.rootSchemaName === "pkg/Image";

describe("replaceDrop", () => {
  it("replaces with exactly one accepted item", () => {
    const replace = vi.fn();
    const config = replaceDrop(isImage, replace);

    expect(config.getDropStatus([image])).toEqual({
      canDrop: true,
      effect: "replace",
    });
    expect(config.getDropStatus([other])).toEqual({ canDrop: false });
    expect(config.getDropStatus([image, image])).toEqual({ canDrop: false });

    config.handleDrop([image]);
    expect(replace).toHaveBeenCalledWith(image);
  });
});

describe("addTopicsDrop", () => {
  it("adds the topics of the accepted items once, ignoring the rest", () => {
    const add = vi.fn();
    const config = addTopicsDrop(isImage, add);

    expect(config.getDropStatus([other, image])).toEqual({
      canDrop: true,
      effect: "add",
    });
    expect(config.getDropStatus([other])).toEqual({ canDrop: false });

    config.handleDrop([image, other, imageField]);
    expect(add).toHaveBeenCalledWith(["/cam"]);
  });
});

describe("addPathsDrop", () => {
  it("adds dropped fields as enabled series, skipping whole messages", () => {
    const add = vi.fn();
    const config = addPathsDrop(add);
    const field = { ...imageField, isLeaf: true };

    expect(config.getDropStatus([image, field])).toEqual({ canDrop: true, effect: "add" });
    expect(config.getDropStatus([image])).toEqual({ canDrop: false });

    config.handleDrop([image, field]);
    expect(add).toHaveBeenCalledWith([
      { value: "/cam.data", enabled: true, timestampMethod: "receiveTime" },
    ]);
  });
});
