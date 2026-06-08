import { describe, expect, it } from "vitest";

import { normalizeOneBotMessage, parseCqMessage, stringifyCqSegments } from "../src/cq.js";
import {
  appendDiscordAttachmentsToQqSegments,
  discordTextToQqSegments,
  qqSegmentsToDiscord
} from "../src/converters.js";
import type { CqSegment } from "../src/types.js";

describe("CQ parser", () => {
  it("parses and stringifies escaped CQ data", () => {
    const parsed = parseCqMessage("hi &#91;x&#93;[CQ:image,file=a&#44;b.png,url=https://x/y.png]");

    expect(parsed).toEqual([
      { type: "text", data: { text: "hi [x]" } },
      { type: "image", data: { file: "a,b.png", url: "https://x/y.png" } }
    ]);
    expect(stringifyCqSegments(parsed)).toBe(
      "hi &#91;x&#93;[CQ:image,file=a&#44;b.png,url=https://x/y.png]"
    );
  });

  it("normalizes OneBot array messages", () => {
    expect(
      normalizeOneBotMessage([
        { type: "text", data: { text: "hello" } },
        { type: "face", data: { id: 14 } }
      ])
    ).toEqual([
      { type: "text", data: { text: "hello" } },
      { type: "face", data: { id: "14" } }
    ]);
  });
});

describe("QQ to Discord conversion", () => {
  it("converts image, face, and at segments", () => {
    const result = qqSegmentsToDiscord(
      [
        { type: "text", data: { text: "hello " } },
        { type: "at", data: { qq: "123" } },
        { type: "face", data: { id: "14" } },
        { type: "image", data: { url: "https://example.com/a.png" } }
      ],
      {
        qqToDiscordUserMap: new Map([["123", "999"]]),
        cqFaceEmojiMap: new Map([["14", "<:qq_smile:888>"]])
      }
    );

    expect(result.content).toBe("hello <@999><:qq_smile:888>");
    expect(result.files).toEqual(["https://example.com/a.png"]);
    expect(result.mentionUserIds).toEqual(["999"]);
  });
});

describe("Discord to QQ conversion", () => {
  it("converts user mentions and mapped custom emoji", () => {
    expect(
      discordTextToQqSegments("hi <@111> <:qq_smile:222>", {
        discordToQqUserMap: new Map([["111", "123"]]),
        discordEmojiToCqFaceMap: new Map([["222", "14"]])
      })
    ).toEqual([
      { type: "text", data: { text: "hi " } },
      { type: "at", data: { qq: "123" } },
      { type: "text", data: { text: " " } },
      { type: "face", data: { id: "14" } }
    ]);
  });

  it("turns unmapped custom emoji into QQ images", () => {
    expect(
      discordTextToQqSegments("<a:dance:222>", {
        discordToQqUserMap: new Map(),
        discordEmojiToCqFaceMap: new Map()
      })
    ).toEqual([
      {
        type: "image",
        data: { file: "https://cdn.discordapp.com/emojis/222.gif?size=64&quality=lossless" }
      }
    ]);
  });

  it("adds image attachments as CQ image segments", () => {
    const segments: CqSegment[] = [];
    appendDiscordAttachmentsToQqSegments(segments, [
      { url: "https://example.com/a.webp", contentType: "image/webp", name: "a.webp" },
      { url: "https://example.com/file.zip", contentType: "application/zip", name: "file.zip" }
    ]);

    expect(segments).toEqual([
      { type: "image", data: { file: "https://example.com/a.webp" } },
      { type: "text", data: { text: " [attachment file.zip: https://example.com/file.zip]" } }
    ]);
  });
});
