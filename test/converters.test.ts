import { describe, expect, it } from "vitest";

import { normalizeOneBotMessage, parseCqMessage, stringifyCqSegments } from "../src/cq.js";
import {
  appendDiscordAttachmentsToQqSegments,
  chunkQqSegments,
  discordMessageToQqSegments,
  discordReactionToQqSegments,
  discordTextToQqSegments,
  formatDiscordReplyFallback,
  formatQqReplyFallback,
  qqReactionToDiscordContent,
  qqSegmentsToDiscord,
  splitDiscordContent
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

  it("extracts reply ids and forwards media urls as Discord files", () => {
    const result = qqSegmentsToDiscord(
      [
        { type: "reply", data: { id: "42" } },
        { type: "record", data: { url: "https://example.com/a.ogg" } },
        { type: "video", data: { file: "https://example.com/a.mp4" } },
        { type: "file", data: { file: "local-file.zip" } }
      ],
      {
        qqToDiscordUserMap: new Map(),
        cqFaceEmojiMap: new Map()
      }
    );

    expect(result.replyToMessageId).toBe("42");
    expect(result.files).toEqual(["https://example.com/a.ogg", "https://example.com/a.mp4"]);
    expect(result.content).toBe("[QQ file: local-file.zip]");
  });

  it("summarizes QQ json and xml rich payloads", () => {
    const result = qqSegmentsToDiscord(
      [
        {
          type: "json",
          data: {
            data: JSON.stringify({
              prompt: "[Share] Example",
              meta: { news: { title: "Title", desc: "Description" } }
            })
          }
        },
        {
          type: "xml",
          data: { data: "<msg><title>XML Title</title><summary>XML Summary</summary></msg>" }
        }
      ],
      {
        qqToDiscordUserMap: new Map(),
        cqFaceEmojiMap: new Map()
      }
    );

    expect(result.content).toBe(
      "[QQ json: [Share] Example | Title | Description][QQ xml: XML Title XML Summary]"
    );
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

  it("maps configured Unicode emoji to QQ faces", () => {
    expect(
      discordTextToQqSegments("ok 🙂 done", {
        discordToQqUserMap: new Map(),
        discordEmojiToCqFaceMap: new Map([["🙂", "14"]])
      })
    ).toEqual([
      { type: "text", data: { text: "ok " } },
      { type: "face", data: { id: "14" } },
      { type: "text", data: { text: " done" } }
    ]);
  });

  it("renders unmapped users, roles, and channels by resolved names", () => {
    expect(
      discordTextToQqSegments("<@111> <@&222> <#333>", {
        discordToQqUserMap: new Map(),
        discordEmojiToCqFaceMap: new Map(),
        resolveUserName: () => "Alice",
        resolveRoleName: () => "Mods",
        resolveChannelName: () => "general"
      })
    ).toEqual([{ type: "text", data: { text: "@Alice @Mods #general" } }]);
  });

  it("adds image attachments as CQ image segments", () => {
    const segments: CqSegment[] = [];
    appendDiscordAttachmentsToQqSegments(segments, [
      { url: "https://example.com/a.webp", contentType: "image/webp", name: "a.webp" },
      { url: "https://example.com/voice.ogg", contentType: "audio/ogg", name: "voice.ogg" },
      { url: "https://example.com/movie.mp4", contentType: "video/mp4", name: "movie.mp4" },
      { url: "https://example.com/file.zip", contentType: "application/zip", name: "file.zip" }
    ]);

    expect(segments).toEqual([
      { type: "image", data: { file: "https://example.com/a.webp" } },
      { type: "record", data: { file: "https://example.com/voice.ogg" } },
      { type: "video", data: { file: "https://example.com/movie.mp4" } },
      {
        type: "file",
        data: { file: "https://example.com/file.zip", name: "file.zip" }
      }
    ]);
  });

  it("classifies media attachments by URL or name when content type is missing", () => {
    const segments: CqSegment[] = [];
    appendDiscordAttachmentsToQqSegments(segments, [
      { url: "https://cdn.discordapp.com/attachments/a", name: "photo.png" },
      { url: "https://cdn.discordapp.com/attachments/video.mp4?ex=1", name: "download" },
      { url: "https://cdn.discordapp.com/attachments/a", name: "voice.opus" }
    ]);

    expect(segments).toEqual([
      { type: "image", data: { file: "https://cdn.discordapp.com/attachments/a" } },
      { type: "video", data: { file: "https://cdn.discordapp.com/attachments/video.mp4?ex=1" } },
      { type: "record", data: { file: "https://cdn.discordapp.com/attachments/a" } }
    ]);
  });

  it("sanitizes generic attachment names", () => {
    const segments: CqSegment[] = [];
    appendDiscordAttachmentsToQqSegments(segments, [
      {
        url: "https://example.com/file.zip",
        contentType: "application/zip",
        name: "../bad\u0000name.zip"
      }
    ]);

    expect(segments).toEqual([
      {
        type: "file",
        data: { file: "https://example.com/file.zip", name: ".._badname.zip" }
      }
    ]);
  });

  it("builds Discord message CQ segments with replies, stickers, embeds, and media", () => {
    expect(
      discordMessageToQqSegments(
        {
          content: "hello",
          senderLabel: "[Discord] Alice",
          replyToQqMessageId: "77",
          stickers: [{ name: "wave", url: "https://example.com/sticker.png" }],
          embeds: [
            {
              title: "Title",
              description: "Description",
              url: "https://example.com/post",
              image: { url: "https://example.com/image.png" }
            }
          ]
        },
        {
          discordToQqUserMap: new Map(),
          discordEmojiToCqFaceMap: new Map()
        }
      )
    ).toEqual([
      { type: "reply", data: { id: "77" } },
      { type: "text", data: { text: "[Discord] Alice: hello" } },
      { type: "image", data: { file: "https://example.com/sticker.png" } },
      {
        type: "text",
        data: {
          text: "\n[Embed]\nTitle (https://example.com/post)\nDescription"
        }
      },
      { type: "image", data: { file: "https://example.com/image.png" } }
    ]);
  });

  it("preserves Discord reply context when no QQ reply id is available", () => {
    expect(
      discordMessageToQqSegments(
        {
          content: "hello",
          senderLabel: "[Discord] Alice",
          replyFallbackText: "[Discord reply to 123]"
        },
        {
          discordToQqUserMap: new Map(),
          discordEmojiToCqFaceMap: new Map()
        }
      )
    ).toEqual([
      {
        type: "text",
        data: { text: "[Discord reply to 123]\n[Discord] Alice: hello" }
      }
    ]);
  });

  it("does not emit sender-only segments for empty Discord messages", () => {
    expect(
      discordMessageToQqSegments(
        {
          content: "",
          senderLabel: "[Discord] Alice",
          replyFallbackText: "[Discord reply to 123]",
          attachments: [],
          stickers: [],
          embeds: []
        },
        {
          discordToQqUserMap: new Map(),
          discordEmojiToCqFaceMap: new Map()
        }
      )
    ).toEqual([]);
  });

  it("formats Discord reply fallback previews", () => {
    expect(
      formatDiscordReplyFallback({
        messageId: "123",
        authorName: "Alice",
        content: "hello\nworld"
      })
    ).toBe("[Discord reply to Alice: hello\nworld]");

    expect(
      formatDiscordReplyFallback({
        messageId: "123",
        authorName: "Alice",
        attachmentCount: 2,
        embedCount: 1
      })
    ).toBe("[Discord reply to Alice: 2 attachment(s), 1 embed(s)]");

    expect(formatDiscordReplyFallback({ messageId: "123" })).toBe("[Discord reply to 123]");
  });

  it("formats QQ reply fallback previews", () => {
    expect(
      formatQqReplyFallback({
        messageId: "456",
        senderName: "Alice",
        content: "hello\nworld"
      })
    ).toBe("[reply to QQ Alice: hello\nworld]");

    expect(formatQqReplyFallback({ messageId: "456", fileCount: 2 })).toBe(
      "[reply to QQ message 456: 2 file(s)]"
    );

    expect(formatQqReplyFallback({ messageId: "456" })).toBe("[reply to QQ message 456]");
  });

  it("splits long Discord content and QQ text segments", () => {
    const discordChunks = splitDiscordContent("alpha beta gamma delta epsilon zeta eta", 32);
    expect(discordChunks.length).toBeGreaterThan(1);
    expect(discordChunks[0]).toContain("[part 1/");
    expect(discordChunks.every((chunk) => chunk.length <= 32)).toBe(true);

    const manyDiscordChunks = splitDiscordContent("x".repeat(280), 24);
    expect(manyDiscordChunks.length).toBeGreaterThan(9);
    expect(manyDiscordChunks.every((chunk) => chunk.length <= 24)).toBe(true);
    expect(manyDiscordChunks.at(-1)).toContain(`[part ${manyDiscordChunks.length}/${manyDiscordChunks.length}]`);

    expect(
      chunkQqSegments([{ type: "text", data: { text: "abcdef" } }], 3)
    ).toEqual([
      [{ type: "text", data: { text: "abc" } }],
      [{ type: "text", data: { text: "def" } }]
    ]);
  });

  it("converts Discord reactions to QQ reply segments", () => {
    expect(
      discordReactionToQqSegments(
        {
          action: "added",
          emojiText: "<:qq_smile:222>",
          userLabel: "Alice",
          replyToQqMessageId: "77"
        },
        {
          discordToQqUserMap: new Map(),
          discordEmojiToCqFaceMap: new Map([["222", "14"]])
        }
      )
    ).toEqual([
      { type: "reply", data: { id: "77" } },
      { type: "text", data: { text: "[Discord reaction] Alice added " } },
      { type: "face", data: { id: "14" } }
    ]);
  });

  it("converts QQ reactions to Discord content", () => {
    expect(
      qqReactionToDiscordContent(
        { action: "removed", emojiId: "14", userId: "123" },
        {
          qqToDiscordUserMap: new Map(),
          cqFaceEmojiMap: new Map([["14", "🙂"]])
        }
      )
    ).toBe("[QQ reaction] User 123 removed 🙂");
  });
});
