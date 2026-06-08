import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MessageLinkStore } from "../src/linkstore.js";

const tempDirs: string[] = [];

describe("MessageLinkStore", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads an empty list when the store does not exist", () => {
    const store = new MessageLinkStore(join(createTempDir(), "links.json"));

    expect(store.load()).toEqual([]);
  });

  it("saves and loads message links atomically", () => {
    const path = join(createTempDir(), "nested", "links.json");
    const store = new MessageLinkStore(path);

    store.save([
      {
        discordMessageId: "1",
        discordMessageIds: ["1", "1b"],
        discordChannelId: "2",
        qqGroupId: "3",
        qqMessageId: "4",
        qqMessageIds: ["4", "4b"],
        createdAt: 123
      }
    ]);

    expect(new MessageLinkStore(path).load()).toEqual([
      {
        discordMessageId: "1",
        discordMessageIds: ["1", "1b"],
        discordChannelId: "2",
        qqGroupId: "3",
        qqMessageId: "4",
        qqMessageIds: ["4", "4b"],
        createdAt: 123
      }
    ]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "qdiscord-linkstore-"));
  tempDirs.push(dir);
  return dir;
}
