// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { expect, test } from "@playwright/test";

const obj =
  "mtllib ../materials/paint.mtl\nv -1 -1 0\nv 1 -1 0\nv 1 1 0\nv -1 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nusemtl paint\nf 1/1 2/2 3/3\nf 1/1 3/3 4/4\n";
const positions = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0];
const uvs = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
const gltf = JSON.stringify({
  asset: { version: "2.0" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
  buffers: [{ uri: "../data/positions.bin", byteLength: (positions.length + uvs.length) * 4 }],
  bufferViews: [
    { buffer: 0, byteLength: positions.length * 4 },
    { buffer: 0, byteOffset: positions.length * 4, byteLength: uvs.length * 4 },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 6,
      type: "VEC3",
      min: [-1, -1, 0],
      max: [1, 1, 0],
    },
    { bufferView: 1, componentType: 5126, count: 6, type: "VEC2" },
  ],
  images: [{ uri: "../textures/green.png" }],
  textures: [{ source: 0 }],
  materials: [
    {
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      doubleSided: true,
    },
  ],
});
const robot = `<robot name="local"><link name="base_link"><visual><origin xyz="-1.2 0 0"/><geometry><mesh filename="../meshes/red.obj"/></geometry></visual><visual><origin xyz="1.2 0 0"/><geometry><mesh filename="../meshes/green.gltf"/></geometry></visual></link></robot>`;

async function coloredPixels(canvas: import("@playwright/test").Locator) {
  const screenshot = await canvas.screenshot();
  return await canvas.page().evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const output = document.createElement("canvas");
    output.width = image.width;
    output.height = image.height;
    const context = output.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, output.width, output.height);
    let red = 0;
    let green = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 80 && data[i] > data[i + 1] * 2 && data[i] > data[i + 2] * 2) {
        red++;
      }
      if (data[i + 1] > 80 && data[i + 1] > data[i] * 2 && data[i + 1] > data[i + 2] * 2) {
        green++;
      }
    }
    return { red, green };
  }, screenshot.toString("base64"));
}

test("loads local URDF meshes, materials and textures and reloads when folder grants change", {
  tag: "@smoke",
}, async ({ page }) => {
  test.setTimeout(60_000);
  // Given
  await page.addInitScript(
    ({ objText, gltfText, robotText, binary }) => {
      window.showDirectoryPicker = async () => {
        // Real browser file handles exercise directory access and Blob/image decoding together.
        const root = await navigator.storage.getDirectory();
        const folder = await root.getDirectoryHandle("local-model-assets", { create: true });
        const files: Record<string, string | Uint8Array> = {
          "package.xml": "<package><name>local_robot</name></package>",
          "urdf/robot.urdf": robotText,
          "meshes/red.obj": objText,
          "meshes/green.gltf": gltfText,
          "data/positions.bin": new Uint8Array(new Float32Array(binary).buffer),
          "materials/paint.mtl": "newmtl paint\nKd 1 1 1\nmap_Kd ../textures/red.png\n",
          "textures/red.png": Uint8Array.from(
            atob(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
            ),
            (c) => c.charCodeAt(0),
          ),
          "textures/green.png": Uint8Array.from(
            atob(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNg+M8AAAICAQB7CYF4AAAAAElFTkSuQmCC",
            ),
            (c) => c.charCodeAt(0),
          ),
        };
        for (const [path, contents] of Object.entries(files)) {
          const parts = path.split("/");
          let directory = folder;
          for (const part of parts.slice(0, -1)) {
            directory = await directory.getDirectoryHandle(part, { create: true });
          }
          const handle = await directory.getFileHandle(parts.at(-1)!, { create: true });
          const writer = await handle.createWritable();
          await writer.write(typeof contents === "string" ? contents : new Uint8Array(contents));
          await writer.close();
        }
        return folder;
      };
    },
    { objText: obj, gltfText: gltf, robotText: robot, binary: [...positions, ...uvs] },
  );
  await page.goto("/");
  await page.getByTestId("DataSourceDialog").waitFor();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("DataSourceDialog")).toBeHidden();
  const layout = {
    configById: {
      "3D!local-assets": {
        cameraState: {
          distance: 7,
          perspective: true,
          phi: 20,
          thetaOffset: 0,
          targetOffset: [0, 0, 0],
        },
        followTf: "base_link",
        followMode: "follow-pose",
        scene: { meshUpAxis: "z_up" },
        topics: {},
        transforms: {},
        layers: {
          robot: {
            layerId: "foxglove.Urdf",
            instanceId: "robot",
            label: "Local robot",
            visible: true,
            sourceType: "url",
            url: "package://local_robot/urdf/robot.urdf",
          },
        },
      },
    },
    layout: "3D!local-assets",
    globalVariables: {},
    playbackConfig: { speed: 1 },
  };
  await page.locator("[data-puppeteer-file-upload]").setInputFiles({
    name: "local-assets.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(layout)),
  });
  const canvas = page.getByTestId("panel-mouseenter-container 3D!local-assets").locator("canvas");
  await expect(canvas).toBeVisible();
  // When
  await page.locator("#app-menu-button").click();
  await page.getByTestId("menu-item-settings").click();
  await page.getByRole("button", { name: "Select resource folder" }).click();
  await expect(page.getByText("local-model-assets — 1 ROS package", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  // Then: software WebGL on CI can take longer than the default five-second assertion budget.
  await expect
    .poll(async () => (await coloredPixels(canvas)).red, { timeout: 15_000 })
    .toBeGreaterThan(100);
  await expect
    .poll(async () => (await coloredPixels(canvas)).green, { timeout: 15_000 })
    .toBeGreaterThan(100);
  // When
  await page.locator("#app-menu-button").click();
  await page.getByTestId("menu-item-settings").click();
  await page.getByRole("button", { name: "Remove folder" }).click();
  await page.keyboard.press("Escape");
  // Then
  await expect
    .poll(async () => (await coloredPixels(canvas)).red, { timeout: 15_000 })
    .toBeLessThan(100);
  // When
  await page.locator("#app-menu-button").click();
  await page.getByTestId("menu-item-settings").click();
  await page.getByRole("button", { name: "Select resource folder" }).click();
  await expect(page.getByRole("button", { name: "Remove folder" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Then
  await expect
    .poll(async () => (await coloredPixels(canvas)).red, { timeout: 15_000 })
    .toBeGreaterThan(100);
  await expect
    .poll(async () => (await coloredPixels(canvas)).green, { timeout: 15_000 })
    .toBeGreaterThan(100);
});
