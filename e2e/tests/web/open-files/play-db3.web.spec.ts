// SPDX-License-Identifier: MPL-2.0

import { expect, Page, TestInfo, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { PlayerControls } from "../../../page-objects";

async function verifyDb3Playback(
  page: Page,
  testInfo: TestInfo,
  mode: "single-file" | "split",
): Promise<void> {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const start: [bigint, string] = [100_000_000_000n, "first example"];
  const end: [bigint, string] = [103_000_000_000n, "last example"];
  const firstFile = testInfo.outputPath("example_0.db3");
  const secondFile = testInfo.outputPath("example_1.db3");
  if (mode === "split") {
    createDb3(firstFile, [start]);
    createDb3(secondFile, [end]);
  } else {
    createDb3(firstFile, [start, end]);
  }

  await page
    .locator("[data-puppeteer-file-upload]")
    .setInputFiles(mode === "split" ? [firstFile, secondFile] : [firstFile]);

  const player = new PlayerControls(page);
  await expect(player.getPlayButton()).toBeEnabled();
  const rawMessages = page.getByTestId(/^panel-mouseenter-container RawMessages!/).first();
  await rawMessages.getByPlaceholder("/some/topic.msgs[0].field").fill("/example");
  const firstMessage = rawMessages.getByText('"first example"', { exact: true });
  await expect(firstMessage).toBeVisible();

  await player.play();
  await expect(rawMessages.getByText('"last example"', { exact: true })).toBeVisible();
  await expect(player.getPlayButton()).toHaveAccessibleName("Play");

  // Seek back into the first segment and confirm the panel receives its decoded message again.
  await player.getSlider().click({ position: { x: 3, y: 3 } });
  await expect(firstMessage).toBeVisible();
}

function createDb3(path: string, messages: readonly [bigint, string][]): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE topics(id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      serialization_format TEXT NOT NULL, offered_qos_profiles TEXT NOT NULL);
    CREATE TABLE messages(id INTEGER PRIMARY KEY, topic_id INTEGER NOT NULL,
      timestamp INTEGER NOT NULL, data BLOB NOT NULL);
    CREATE INDEX timestamp_idx ON messages (timestamp ASC);
    INSERT INTO topics VALUES (1, '/example', 'std_msgs/msg/String', 'cdr', '[]');
  `);
  const insert = db.prepare("INSERT INTO messages(topic_id, timestamp, data) VALUES (1, ?, ?)");
  for (const [time, message] of messages) {
    // Little-endian CDR encapsulation followed by the string byte length, including the NUL.
    const bytes = Buffer.from(message, "utf8");
    const cdr = Buffer.alloc(8 + bytes.length + 1);
    cdr[1] = 1;
    cdr.writeUInt32LE(bytes.length + 1, 4);
    bytes.copy(cdr, 8);
    insert.run(time, cdr);
  }
  db.close();
}

for (const mode of ["single-file", "split"] as const) {
  test(
    `plays and seeks a ${mode} ROS 2 DB3 bag`,
    {
      tag: "@regression",
    },
    async ({ page }, testInfo) => {
      await page.goto("/");
      await verifyDb3Playback(page, testInfo, mode);
    },
  );
}
