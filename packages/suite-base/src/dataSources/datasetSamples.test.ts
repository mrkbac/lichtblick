// SPDX-License-Identifier: MPL-2.0

import { existsSync, openAsBlob } from "node:fs";

import { BlobReadable, McapIndexedReader } from "@lichtblick/mcap-core";
import { loadDecompressHandlers, parseChannel } from "@lichtblick/mcap-support";
import { decodeCompressedDepth } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/decodeCompressedDepth";
import {
  CLOUDINI_SCHEMA,
  decodeCloudini,
  loadCloudini,
} from "@lichtblick/suite-base/util/cloudini";

const samples = [
  { name: "droid", video: "/camera/wrist", extra: "/camera/exterior_calibration", depth: false },
  { name: "grandtour", video: "/camera/hdr", extra: "/ground_truth/leica_prism", depth: true },
  { name: "citrusfarm", video: "/camera/left", extra: "/gps/fix/odometry", depth: true },
];

// The recordings live on R2, not in git. Each case runs once `ci/create-dataset-samples.py` wrote
// its recording here.
const built = (name: string) => existsSync(new URL(`./samples/${name}.mcap`, import.meta.url));

for (const { name, video, extra, depth } of samples) {
  describe.skipIf(!built(name))(`${name} sample`, () => {
    it("decodes all channels", async () => {
      const blob = await openAsBlob(new URL(`./samples/${name}.mcap`, import.meta.url));
      const reader = await McapIndexedReader.Initialize({
        readable: new BlobReadable(blob),
        decompressHandlers: await loadDecompressHandlers(),
      });
      const firstMessages = new Map<string, unknown>();
      for await (const message of reader.readMessages()) {
        const channel = reader.channelsById.get(message.channelId)!;
        if (firstMessages.has(channel.topic)) {
          continue;
        }
        const schema = reader.schemasById.get(channel.schemaId);
        const parsed = parseChannel({ messageEncoding: channel.messageEncoding, schema });
        firstMessages.set(channel.topic, parsed.deserialize(message.data));
      }

      expect(firstMessages.size).toBe(reader.channelsById.size);
      expect(firstMessages.get(video)).toMatchObject({
        format: "h265",
        data: expect.any(Uint8Array),
      });
      expect(firstMessages.get(extra)).toBeDefined();
      const videoChannel = Array.from(reader.channelsById.values()).find(
        (channel) => channel.topic === video,
      )!;
      const calibration = Array.from(reader.channelsById.values()).find(
        (channel) => channel.topic === `${video}/camera_info`,
      )!;
      const counts = reader.statistics!.channelMessageCounts;
      expect(counts.get(calibration.id)).toBe(counts.get(videoChannel.id));

      expect(firstMessages.has("/lidar/points")).toBe(depth);
      expect(firstMessages.has("/camera/depth")).toBe(depth);

      const credits: string[] = [];
      for await (const attachment of reader.readAttachments()) {
        if (attachment.name === "Attribution.txt") {
          credits.push(new TextDecoder().decode(attachment.data));
        }
      }
      expect(credits).toEqual([
        expect.stringContaining(
          depth ? "creativecommons.org/licenses/by-sa/4.0" : "creativecommons.org/licenses/by/4.0",
        ),
      ]);
    });
    // oxlint's vitest rules don't see expects inside it.skipIf, so branch instead.
    if (depth) {
      it("renders point clouds and depth", async () => {
        const blob = await openAsBlob(new URL(`./samples/${name}.mcap`, import.meta.url));
        const reader = await McapIndexedReader.Initialize({
          readable: new BlobReadable(blob),
          decompressHandlers: await loadDecompressHandlers(),
        });
        const first = async (
          topic: string,
          accept: (message: unknown, schemaName?: string) => boolean = () => true,
        ): Promise<unknown> => {
          for await (const message of reader.readMessages({ topics: [topic] })) {
            const channel = reader.channelsById.get(message.channelId)!;
            const schema = reader.schemasById.get(channel.schemaId);
            const decoded = parseChannel({
              messageEncoding: channel.messageEncoding,
              schema,
            }).deserialize(message.data);
            if (accept(decoded, schema?.name)) {
              return decoded;
            }
          }
          throw new Error(`No matching message on ${topic}`);
        };
        // The app only decodes Cloudini under its schema name; an empty scan would skip the decoder.
        const cloud = (await first(
          "/lidar/points",
          (message, schemaName) =>
            schemaName === CLOUDINI_SCHEMA && (message as { row_step: number }).row_step > 0,
        )) as { format: string; row_step: number; compressed_data: Uint8Array };
        expect(cloud.format).toBe("cloudini");
        await loadCloudini();
        expect(decodeCloudini(cloud.compressed_data, cloud.row_step).byteLength).toBe(
          cloud.row_step,
        );
        const image = (await first("/camera/depth")) as Parameters<typeof decodeCompressedDepth>[0];
        await expect(decodeCompressedDepth(image)).resolves.toMatchObject({ encoding: "16UC1" });
      });
    }
  });
}
