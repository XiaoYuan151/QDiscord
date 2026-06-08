import { appendTextSegment } from "./cq.js";
import type { CqSegment } from "./types.js";

export interface QqToDiscordOptions {
  qqToDiscordUserMap: Map<string, string>;
  cqFaceEmojiMap: Map<string, string>;
}

export interface QqToDiscordResult {
  content: string;
  files: string[];
  mentionUserIds: string[];
  mentionEveryone: boolean;
}

export interface DiscordTextToQqOptions {
  discordToQqUserMap: Map<string, string>;
  discordEmojiToCqFaceMap: Map<string, string>;
  resolveUserName?: (discordUserId: string) => string | undefined;
  resolveChannelName?: (discordChannelId: string) => string | undefined;
  resolveRoleName?: (discordRoleId: string) => string | undefined;
}

export interface DiscordAttachmentLike {
  url: string;
  name?: string | null;
  contentType?: string | null;
}

export function qqSegmentsToDiscord(
  segments: CqSegment[],
  options: QqToDiscordOptions
): QqToDiscordResult {
  const parts: string[] = [];
  const files: string[] = [];
  const mentionUserIds: string[] = [];
  let mentionEveryone = false;

  for (const segment of segments) {
    switch (segment.type) {
      case "text": {
        parts.push(segment.data.text ?? "");
        break;
      }
      case "face": {
        const faceId = segment.data.id ?? segment.data.face;
        parts.push((faceId && options.cqFaceEmojiMap.get(faceId)) ?? `[QQ face ${faceId ?? "unknown"}]`);
        break;
      }
      case "at": {
        const qqId = segment.data.qq ?? segment.data.id;
        if (qqId === "all") {
          parts.push("@everyone");
          mentionEveryone = true;
          break;
        }

        const discordUserId = qqId ? options.qqToDiscordUserMap.get(qqId) : undefined;
        if (discordUserId) {
          parts.push(`<@${discordUserId}>`);
          mentionUserIds.push(discordUserId);
        } else {
          parts.push(`@QQ:${qqId ?? "unknown"}`);
        }
        break;
      }
      case "image":
      case "mface": {
        const url = firstValue(segment.data.url, segment.data.file, segment.data.path);
        if (url && isHttpUrl(url)) {
          files.push(url);
        } else {
          parts.push(url ? `[QQ image: ${url}]` : "[QQ image]");
        }
        break;
      }
      case "record":
      case "video": {
        const url = firstValue(segment.data.url, segment.data.file, segment.data.path);
        parts.push(url ? `[QQ ${segment.type}: ${url}]` : `[QQ ${segment.type}]`);
        break;
      }
      case "reply": {
        break;
      }
      default: {
        parts.push(`[QQ ${segment.type}]`);
      }
    }
  }

  return {
    content: normalizeWhitespace(parts.join("")),
    files,
    mentionUserIds: [...new Set(mentionUserIds)],
    mentionEveryone
  };
}

export function discordTextToQqSegments(text: string, options: DiscordTextToQqOptions): CqSegment[] {
  const segments: CqSegment[] = [];
  const tokenPattern = /<(a?):([A-Za-z0-9_~]+):(\d+)>|<@!?(\d+)>|<@&(\d+)>|<#(\d+)>/g;
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) {
      appendTextSegment(segments, text.slice(cursor, matchIndex));
    }

    if (match[3]) {
      const animated = match[1] === "a";
      const emojiName = match[2] ?? "emoji";
      const emojiId = match[3];
      const qqFaceId = findDiscordEmojiFaceId(options.discordEmojiToCqFaceMap, emojiId, emojiName);
      if (qqFaceId) {
        segments.push({ type: "face", data: { id: qqFaceId } });
      } else {
        segments.push({
          type: "image",
          data: { file: discordEmojiCdnUrl(emojiId, animated) }
        });
      }
    } else if (match[4]) {
      const discordUserId = match[4];
      const qqId = options.discordToQqUserMap.get(discordUserId);
      if (qqId) {
        segments.push({ type: "at", data: { qq: qqId } });
      } else {
        appendTextSegment(segments, `@${options.resolveUserName?.(discordUserId) ?? discordUserId}`);
      }
    } else if (match[5]) {
      const roleId = match[5];
      appendTextSegment(segments, `@${options.resolveRoleName?.(roleId) ?? roleId}`);
    } else if (match[6]) {
      const channelId = match[6];
      appendTextSegment(segments, `#${options.resolveChannelName?.(channelId) ?? channelId}`);
    }

    cursor = matchIndex + match[0].length;
  }

  if (cursor < text.length) {
    appendTextSegment(segments, text.slice(cursor));
  }

  return segments;
}

export function appendDiscordAttachmentsToQqSegments(
  segments: CqSegment[],
  attachments: Iterable<DiscordAttachmentLike>
): void {
  for (const attachment of attachments) {
    if (isImageAttachment(attachment)) {
      segments.push({ type: "image", data: { file: attachment.url } });
      continue;
    }

    if (attachment.contentType?.startsWith("video/")) {
      segments.push({ type: "video", data: { file: attachment.url } });
      continue;
    }

    const label = attachment.name ? `attachment ${attachment.name}` : "attachment";
    appendTextSegment(segments, ` [${label}: ${attachment.url}]`);
  }
}

export function escapeDiscordMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

export function truncateDiscordContent(content: string, maxLength = 1900): string {
  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength - 16)}... [truncated]`;
}

function findDiscordEmojiFaceId(
  map: Map<string, string>,
  emojiId: string,
  emojiName: string
): string | undefined {
  return map.get(emojiId) ?? map.get(emojiName) ?? map.get(emojiName.toLowerCase());
}

function discordEmojiCdnUrl(emojiId: string, animated: boolean): string {
  const extension = animated ? "gif" : "png";
  return `https://cdn.discordapp.com/emojis/${emojiId}.${extension}?size=64&quality=lossless`;
}

function isImageAttachment(attachment: DiscordAttachmentLike): boolean {
  if (attachment.contentType?.startsWith("image/")) {
    return true;
  }

  return isLikelyImageUrl(attachment.url);
}

function isLikelyImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(parsed.pathname);
  } catch {
    return /\.(png|jpe?g|gif|webp|bmp|avif)(?:$|[?#])/i.test(url);
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function firstValue(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== "");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/[ \t]+\n/g, "\n").trim();
}
