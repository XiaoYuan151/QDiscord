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
  replyToMessageId?: string;
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

export interface DiscordStickerLike {
  name: string;
  url?: string | null;
}

export interface DiscordEmbedLike {
  title?: string | null;
  description?: string | null;
  url?: string | null;
  author?: { name?: string | null; url?: string | null } | null;
  fields?: Array<{ name: string; value: string; inline?: boolean }> | null;
  image?: { url?: string | null } | null;
  thumbnail?: { url?: string | null } | null;
  video?: { url?: string | null } | null;
  footer?: { text?: string | null } | null;
}

export interface DiscordMessageToQqInput {
  content: string;
  senderLabel?: string;
  replyToQqMessageId?: string;
  replyFallbackText?: string;
  attachments?: Iterable<DiscordAttachmentLike>;
  stickers?: Iterable<DiscordStickerLike>;
  embeds?: Iterable<DiscordEmbedLike>;
}

export interface DiscordReactionToQqInput {
  action: "added" | "removed";
  emojiText: string;
  userLabel?: string;
  replyToQqMessageId?: string;
}

export interface QqReactionToDiscordInput {
  action: "added" | "removed";
  emojiId?: string;
  userId?: string;
}

export function qqSegmentsToDiscord(
  segments: CqSegment[],
  options: QqToDiscordOptions
): QqToDiscordResult {
  const parts: string[] = [];
  const files: string[] = [];
  const mentionUserIds: string[] = [];
  let mentionEveryone = false;
  let replyToMessageId: string | undefined;

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
        appendOneBotMedia(segment, files, parts, "image");
        break;
      }
      case "video": {
        appendOneBotMedia(segment, files, parts, "video");
        break;
      }
      case "record": {
        appendOneBotMedia(segment, files, parts, "voice");
        break;
      }
      case "file": {
        appendOneBotMedia(segment, files, parts, "file");
        break;
      }
      case "reply": {
        replyToMessageId = segment.data.id ?? segment.data.message_id ?? replyToMessageId;
        break;
      }
      case "share": {
        const title = firstValue(segment.data.title, segment.data.content) ?? "share";
        const url = firstValue(segment.data.url);
        parts.push(url ? `[QQ share: ${title} ${url}]` : `[QQ share: ${title}]`);
        break;
      }
      case "location": {
        const title = firstValue(segment.data.title, segment.data.content);
        const lat = firstValue(segment.data.lat, segment.data.latitude);
        const lon = firstValue(segment.data.lon, segment.data.lng, segment.data.longitude);
        parts.push(`[QQ location${title ? `: ${title}` : ""}${lat && lon ? ` (${lat}, ${lon})` : ""}]`);
        break;
      }
      case "music": {
        const title = firstValue(segment.data.title, segment.data.content) ?? "music";
        const url = firstValue(segment.data.url, segment.data.jumpUrl);
        parts.push(url ? `[QQ music: ${title} ${url}]` : `[QQ music: ${title}]`);
        break;
      }
      case "json":
      case "xml": {
        parts.push(`[QQ ${segment.type}: ${summarizeRichPayload(segment.type, segment.data)}]`);
        break;
      }
      case "forward":
      case "node": {
        parts.push(`[QQ forwarded message${segment.data.id ? ` ${segment.data.id}` : ""}]`);
        break;
      }
      case "dice":
      case "rps":
      case "poke": {
        parts.push(`[QQ ${segment.type}]`);
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
    mentionEveryone,
    replyToMessageId
  };
}

export function discordMessageToQqSegments(
  input: DiscordMessageToQqInput,
  options: DiscordTextToQqOptions
): CqSegment[] {
  const bodySegments: CqSegment[] = [];
  appendSegments(bodySegments, discordTextToQqSegments(input.content, options));
  appendDiscordAttachmentsToQqSegments(bodySegments, input.attachments ?? []);
  appendDiscordStickersToQqSegments(bodySegments, input.stickers ?? []);
  appendDiscordEmbedsToQqSegments(bodySegments, input.embeds ?? []);

  if (bodySegments.length === 0) {
    return [];
  }

  const segments: CqSegment[] = [];

  if (input.replyToQqMessageId) {
    segments.push({ type: "reply", data: { id: input.replyToQqMessageId } });
  } else if (input.replyFallbackText) {
    appendTextSegment(segments, `${input.replyFallbackText}\n`);
  }

  if (input.senderLabel) {
    appendTextSegment(segments, `${input.senderLabel}: `);
  }

  appendSegments(segments, bodySegments);

  return segments;
}

export function discordReactionToQqSegments(
  input: DiscordReactionToQqInput,
  options: DiscordTextToQqOptions
): CqSegment[] {
  const segments: CqSegment[] = [];
  if (input.replyToQqMessageId) {
    segments.push({ type: "reply", data: { id: input.replyToQqMessageId } });
  }

  appendTextSegment(
    segments,
    `[Discord reaction] ${input.userLabel ?? "A Discord user"} ${input.action} `
  );
  appendSegments(segments, discordTextToQqSegments(input.emojiText, options));
  return segments;
}

export function qqReactionToDiscordContent(
  input: QqReactionToDiscordInput,
  options: QqToDiscordOptions
): string {
  const emoji =
    input.emojiId && options.cqFaceEmojiMap.has(input.emojiId)
      ? options.cqFaceEmojiMap.get(input.emojiId)
      : `[QQ face ${input.emojiId ?? "unknown"}]`;
  return `[QQ reaction] User ${input.userId ?? "unknown"} ${input.action} ${emoji}`;
}

export function discordTextToQqSegments(text: string, options: DiscordTextToQqOptions): CqSegment[] {
  const segments: CqSegment[] = [];
  const tokenPattern = /<(a?):([A-Za-z0-9_~]+):(\d+)>|<@!?(\d+)>|<@&(\d+)>|<#(\d+)>/g;
  const emojiKeys = configuredUnicodeEmojiKeys(options.discordEmojiToCqFaceMap);
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) {
      appendTextWithEmojiMapping(segments, text.slice(cursor, matchIndex), emojiKeys, options.discordEmojiToCqFaceMap);
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
    appendTextWithEmojiMapping(segments, text.slice(cursor), emojiKeys, options.discordEmojiToCqFaceMap);
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

    if (attachment.contentType?.startsWith("audio/") || isLikelyAudioUrl(attachment.url)) {
      segments.push({ type: "record", data: { file: attachment.url } });
      continue;
    }

    if (attachment.contentType?.startsWith("video/")) {
      segments.push({ type: "video", data: { file: attachment.url } });
      continue;
    }

    segments.push({
      type: "file",
      data: {
        file: attachment.url,
        ...(attachment.name ? { name: sanitizeFileName(attachment.name) } : {})
      }
    });
  }
}

export function appendDiscordStickersToQqSegments(
  segments: CqSegment[],
  stickers: Iterable<DiscordStickerLike>
): void {
  for (const sticker of stickers) {
    if (sticker.url) {
      segments.push({ type: "image", data: { file: sticker.url } });
    } else {
      appendTextSegment(segments, ` [sticker: ${sticker.name}]`);
    }
  }
}

export function appendDiscordEmbedsToQqSegments(
  segments: CqSegment[],
  embeds: Iterable<DiscordEmbedLike>
): void {
  for (const embed of embeds) {
    const lines: string[] = [];
    if (embed.author?.name) {
      lines.push(`Author: ${embed.author.name}`);
    }
    if (embed.title) {
      lines.push(embed.url ? `${embed.title} (${embed.url})` : embed.title);
    } else if (embed.url) {
      lines.push(embed.url);
    }
    if (embed.description) {
      lines.push(embed.description);
    }
    for (const field of embed.fields ?? []) {
      lines.push(`${field.name}: ${field.value}`);
    }
    if (embed.footer?.text) {
      lines.push(embed.footer.text);
    }

    if (lines.length > 0) {
      appendTextSegment(segments, `\n[Embed]\n${lines.join("\n")}`);
    }

    for (const url of [
      embed.image?.url,
      embed.thumbnail?.url,
      embed.video?.url
    ]) {
      if (url) {
        segments.push({ type: isLikelyVideoUrl(url) ? "video" : "image", data: { file: url } });
      }
    }
  }
}

export function escapeDiscordMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

export function truncateDiscordContent(content: string, maxLength = 1900): string {
  return splitDiscordContent(content, maxLength)[0] ?? "";
}

export function splitDiscordContent(content: string, maxLength = 1900): string[] {
  if (!content) {
    return [];
  }

  if (content.length <= maxLength) {
    return [content];
  }

  const chunks = splitText(content, Math.max(1, maxLength - 18));
  return chunks.map((chunk, index) => `${chunk}\n[part ${index + 1}/${chunks.length}]`);
}

export function chunkQqSegments(segments: CqSegment[], maxTextLength = 3500): CqSegment[][] {
  const chunks: CqSegment[][] = [];
  let current: CqSegment[] = [];
  let currentTextLength = 0;

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = [];
      currentTextLength = 0;
    }
  };

  for (const segment of segments) {
    if (segment.type !== "text") {
      current.push(segment);
      continue;
    }

    const text = segment.data.text ?? "";
    for (const textChunk of splitText(text, maxTextLength)) {
      if (currentTextLength > 0 && currentTextLength + textChunk.length > maxTextLength) {
        flush();
      }
      appendTextSegment(current, textChunk);
      currentTextLength += textChunk.length;
      if (currentTextLength >= maxTextLength) {
        flush();
      }
    }
  }

  flush();
  return chunks;
}

function appendSegments(target: CqSegment[], source: CqSegment[]): void {
  for (const segment of source) {
    if (segment.type === "text") {
      appendTextSegment(target, segment.data.text ?? "");
    } else {
      target.push(segment);
    }
  }
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

function appendOneBotMedia(
  segment: CqSegment,
  files: string[],
  parts: string[],
  label: string
): void {
  const url = firstValue(segment.data.url, segment.data.file, segment.data.path);
  if (url && isHttpUrl(url)) {
    files.push(url);
  } else {
    parts.push(url ? `[QQ ${label}: ${url}]` : `[QQ ${label}]`);
  }
}

function appendTextWithEmojiMapping(
  segments: CqSegment[],
  text: string,
  emojiKeys: string[],
  map: Map<string, string>
): void {
  if (emojiKeys.length === 0) {
    appendTextSegment(segments, text);
    return;
  }

  let cursor = 0;
  while (cursor < text.length) {
    const key = emojiKeys.find((candidate) => text.startsWith(candidate, cursor));
    if (!key) {
      appendTextSegment(segments, text[cursor] ?? "");
      cursor += 1;
      continue;
    }

    const faceId = map.get(key);
    if (faceId) {
      segments.push({ type: "face", data: { id: faceId } });
    }
    cursor += key.length;
  }
}

function configuredUnicodeEmojiKeys(map: Map<string, string>): string[] {
  return [...map.keys()]
    .filter((key) => /\p{Extended_Pictographic}/u.test(key))
    .sort((left, right) => right.length - left.length);
}

function isImageAttachment(attachment: DiscordAttachmentLike): boolean {
  if (attachment.contentType?.startsWith("image/")) {
    return true;
  }

  return isLikelyImageUrl(attachment.url);
}

function isLikelyAudioUrl(url: string): boolean {
  return /\.(mp3|m4a|wav|ogg|oga|opus|flac|aac)(?:$|[?#])/i.test(url);
}

function isLikelyVideoUrl(url: string): boolean {
  return /\.(mp4|mov|m4v|webm|mkv)(?:$|[?#])/i.test(url);
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

function splitText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength + 1);
    const breakpoint = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    const chunkLength = breakpoint > Math.floor(maxLength * 0.6) ? breakpoint : maxLength;
    chunks.push(remaining.slice(0, chunkLength).trimEnd());
    remaining = remaining.slice(chunkLength).trimStart();
  }
  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function truncateInline(text: string, maxLength = 160): string {
  if (!text) {
    return "payload omitted";
  }

  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function summarizeRichPayload(type: string, data: Record<string, string>): string {
  const payload = firstValue(data.data, data.content, data.text);
  if (!payload) {
    return "payload omitted";
  }

  if (type === "json") {
    return summarizeJsonPayload(payload);
  }

  return summarizeXmlPayload(payload);
}

function summarizeJsonPayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as unknown;
    const values = collectJsonSummaryValues(parsed);
    if (values.length > 0) {
      return truncateInline(values.join(" | "));
    }
  } catch {
    // Fall through to raw payload summary.
  }

  return truncateInline(payload);
}

function collectJsonSummaryValues(value: unknown): string[] {
  const values: string[] = [];
  const visit = (current: unknown): void => {
    if (!current || typeof current !== "object" || values.length >= 6) {
      return;
    }

    const record = current as Record<string, unknown>;
    for (const key of ["prompt", "title", "desc", "description", "summary"]) {
      const entry = record[key];
      if (typeof entry === "string" && entry.trim()) {
        values.push(entry.trim());
      }
    }

    for (const entry of Object.values(record)) {
      if (values.length >= 6) {
        return;
      }
      if (Array.isArray(entry)) {
        for (const item of entry) {
          visit(item);
        }
      } else {
        visit(entry);
      }
    }
  };

  visit(value);
  return [...new Set(values)];
}

function summarizeXmlPayload(payload: string): string {
  const text = payload
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncateInline(text || payload);
}

function sanitizeFileName(name: string): string {
  const sanitized = name
    .replace(/[/\\]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 120);
  return sanitized || "attachment";
}

function normalizeWhitespace(text: string): string {
  return text.replace(/[ \t]+\n/g, "\n").trim();
}
