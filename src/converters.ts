import { appendTextSegment, normalizeOneBotMessage } from "./cq.js";
import type { CqSegment, OneBotMessagePayload } from "./types.js";

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

export interface DiscordPollAnswerLike {
  id?: number | string | null;
  text?: string | null;
  emojiText?: string | null;
  voteCount?: number | null;
}

export interface DiscordPollLike {
  questionText?: string | null;
  answers?: Iterable<DiscordPollAnswerLike>;
  allowMultiselect?: boolean | null;
  expiresTimestamp?: number | null;
  resultsFinalized?: boolean | null;
}

export interface DiscordForwardedMessageLike {
  content?: string | null;
  attachments?: Iterable<DiscordAttachmentLike>;
  stickers?: Iterable<DiscordStickerLike>;
  embeds?: Iterable<DiscordEmbedLike>;
}

export interface DiscordMessageToQqInput {
  content: string;
  senderLabel?: string;
  replyToQqMessageId?: string;
  replyFallbackText?: string;
  attachments?: Iterable<DiscordAttachmentLike>;
  stickers?: Iterable<DiscordStickerLike>;
  embeds?: Iterable<DiscordEmbedLike>;
  poll?: DiscordPollLike | null;
  forwardedMessages?: Iterable<DiscordForwardedMessageLike>;
}

export interface DiscordReplyPreviewLike {
  messageId: string;
  authorName?: string;
  content?: string;
  attachmentCount?: number;
  embedCount?: number;
  stickerCount?: number;
}

export interface DiscordReactionToQqInput {
  action: "added" | "removed";
  emojiText: string;
  userLabel?: string;
  replyToQqMessageId?: string;
}

export interface DiscordReactionClearToQqInput {
  scope: "all" | "emoji";
  emojiText?: string;
  reactionCount?: number | null;
  replyToQqMessageId?: string;
}

export interface DiscordPollVoteToQqInput {
  action: "added" | "removed";
  userLabel?: string;
  answerId?: number | string | null;
  answerText?: string | null;
  answerEmojiText?: string | null;
  replyToQqMessageId?: string;
}

export interface QqReactionToDiscordInput {
  action: "added" | "removed";
  emojiId?: string;
  userId?: string;
}

export interface QqReplyPreviewLike {
  messageId: string;
  senderName?: string;
  content?: string;
  fileCount?: number;
}

export interface OneBotForwardMessageToSegmentsOptions {
  forwardId?: string;
  maxNodes?: number;
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
      case "contact": {
        const contactType = firstValue(segment.data.type, segment.data.contact_type) ?? "unknown";
        const contactId = firstValue(segment.data.id, segment.data.qq, segment.data.group_id);
        parts.push(
          `[QQ contact: ${contactType}${contactId ? ` ${contactId}` : ""}]`
        );
        break;
      }
      case "tts": {
        parts.push(`[QQ TTS: ${firstValue(segment.data.text, segment.data.content) ?? "empty"}]`);
        break;
      }
      case "markdown": {
        const markdown = firstValue(segment.data.content, segment.data.text, segment.data.markdown);
        parts.push(markdown ? `[QQ markdown]\n${markdown}` : "[QQ markdown]");
        break;
      }
      case "keyboard": {
        const labels = summarizeKeyboardLabels(segment.data);
        parts.push(labels ? `[QQ keyboard: ${labels}]` : "[QQ keyboard]");
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
      case "redbag":
      case "gift":
      case "basketball": {
        parts.push(`[QQ ${segment.type}: ${summarizeSegmentData(segment.data)}]`);
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

export function oneBotForwardMessageToSegments(
  input: unknown,
  options: OneBotForwardMessageToSegmentsOptions = {}
): CqSegment[] {
  const nodes = extractForwardNodes(input);
  if (nodes.length === 0) {
    return [
      {
        type: "text",
        data: { text: `[QQ forwarded message${options.forwardId ? ` ${options.forwardId}` : ""}]` }
      }
    ];
  }

  const maxNodes = options.maxNodes ?? 10;
  const segments: CqSegment[] = [];
  appendTextSegment(segments, "[QQ forwarded message]");
  for (const [index, node] of nodes.slice(0, maxNodes).entries()) {
    appendTextSegment(segments, `\n${index + 1}. ${forwardNodeSenderLabel(node)}: `);
    const contentSegments = forwardNodeContentSegments(node);
    if (contentSegments.length > 0) {
      appendSegments(segments, contentSegments);
    } else {
      appendTextSegment(segments, "[empty]");
    }
  }

  const remaining = nodes.length - maxNodes;
  if (remaining > 0) {
    appendTextSegment(segments, `\n... ${remaining} more forwarded message(s)`);
  }

  return segments;
}

export function discordMessageToQqSegments(
  input: DiscordMessageToQqInput,
  options: DiscordTextToQqOptions
): CqSegment[] {
  const bodySegments: CqSegment[] = [];
  appendSegments(bodySegments, discordTextToQqSegments(input.content, options));
  appendDiscordPollToQqSegments(bodySegments, input.poll);
  appendDiscordForwardedMessagesToQqSegments(bodySegments, input.forwardedMessages ?? []);
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

export function formatDiscordReplyFallback(input: DiscordReplyPreviewLike): string {
  const preview = replyPreviewText(input);
  return `[Discord reply to ${preview || input.messageId}]`;
}

export function formatQqReplyFallback(input: QqReplyPreviewLike): string {
  const content = normalizeWhitespace(input.content ?? "");
  const preview = truncateInline(
    content || (input.fileCount ? `${input.fileCount} file(s)` : ""),
    120
  );
  if (input.senderName && preview && preview !== "payload omitted") {
    return `[reply to QQ ${input.senderName}: ${preview}]`;
  }
  if (preview && preview !== "payload omitted") {
    return `[reply to QQ message ${input.messageId}: ${preview}]`;
  }

  return `[reply to QQ message ${input.messageId}]`;
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

export function discordReactionClearToQqSegments(
  input: DiscordReactionClearToQqInput,
  options: DiscordTextToQqOptions
): CqSegment[] {
  const segments: CqSegment[] = [];
  if (input.replyToQqMessageId) {
    segments.push({ type: "reply", data: { id: input.replyToQqMessageId } });
  }

  if (input.scope === "emoji") {
    appendTextSegment(segments, "[Discord reaction] cleared all ");
    appendSegments(segments, discordTextToQqSegments(input.emojiText ?? "emoji", options));
    appendTextSegment(segments, ` reactions${formatReactionCount(input.reactionCount)}`);
    return segments;
  }

  appendTextSegment(
    segments,
    `[Discord reaction] cleared all reactions${formatReactionCount(input.reactionCount, "emoji type")}`
  );
  return segments;
}

export function discordPollVoteToQqSegments(
  input: DiscordPollVoteToQqInput,
  options: DiscordTextToQqOptions
): CqSegment[] {
  const segments: CqSegment[] = [];
  if (input.replyToQqMessageId) {
    segments.push({ type: "reply", data: { id: input.replyToQqMessageId } });
  }

  const verb = input.action === "added" ? "voted for" : "removed vote from";
  appendTextSegment(
    segments,
    `[Discord poll] ${input.userLabel ?? "A Discord user"} ${verb} `
  );

  const answerPrefix =
    input.answerId !== undefined && input.answerId !== null ? `${input.answerId}. ` : "";
  const answerText = input.answerText?.trim();
  const answerEmojiText = input.answerEmojiText?.trim();
  if (!answerText && !answerEmojiText) {
    appendTextSegment(
      segments,
      input.answerId !== undefined && input.answerId !== null
        ? `answer ${input.answerId}`
        : "an answer"
    );
    return segments;
  }

  appendTextSegment(segments, answerPrefix);
  if (answerEmojiText) {
    appendSegments(segments, discordTextToQqSegments(answerEmojiText, options));
  }
  if (answerText) {
    appendTextSegment(segments, `${answerEmojiText ? " " : ""}${answerText}`);
  }
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
  const userLabel =
    input.userId && options.qqToDiscordUserMap.has(input.userId)
      ? `<@${options.qqToDiscordUserMap.get(input.userId)}>`
      : `User ${input.userId ?? "unknown"}`;
  return `[QQ reaction] ${userLabel} ${input.action} ${emoji}`;
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

    if (
      attachment.contentType?.startsWith("audio/") ||
      isLikelyAudioUrl(attachment.url) ||
      (attachment.name ? isLikelyAudioUrl(attachment.name) : false)
    ) {
      segments.push({ type: "record", data: { file: attachment.url } });
      continue;
    }

    if (
      attachment.contentType?.startsWith("video/") ||
      isLikelyVideoUrl(attachment.url) ||
      (attachment.name ? isLikelyVideoUrl(attachment.name) : false)
    ) {
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

export function appendDiscordPollToQqSegments(
  segments: CqSegment[],
  poll: DiscordPollLike | null | undefined
): void {
  if (!poll) {
    return;
  }

  const text = formatDiscordPollToQqText(poll);
  if (!text) {
    return;
  }

  appendTextSegment(segments, `${segments.length > 0 ? "\n" : ""}${text}`);
}

export function appendDiscordForwardedMessagesToQqSegments(
  segments: CqSegment[],
  forwardedMessages: Iterable<DiscordForwardedMessageLike>
): void {
  for (const forwarded of forwardedMessages) {
    const content = normalizeWhitespace(forwarded.content ?? "");
    appendTextSegment(
      segments,
      `${segments.length > 0 ? "\n" : ""}[Discord forwarded message]${
        content ? `\n${truncateInline(content, 300)}` : ""
      }`
    );
    appendDiscordAttachmentsToQqSegments(segments, forwarded.attachments ?? []);
    appendDiscordStickersToQqSegments(segments, forwarded.stickers ?? []);
    appendDiscordEmbedsToQqSegments(segments, forwarded.embeds ?? []);
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

  let reserveLength = partSuffix(1, 1).length;
  let chunks = splitText(content, Math.max(1, maxLength - reserveLength));

  while (true) {
    const nextReserveLength = partSuffix(chunks.length, chunks.length).length;
    if (nextReserveLength === reserveLength) {
      break;
    }

    reserveLength = nextReserveLength;
    chunks = splitText(content, Math.max(1, maxLength - reserveLength));
  }

  return chunks.map((chunk, index) => `${chunk}${partSuffix(index + 1, chunks.length)}`);
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

function summarizeKeyboardLabels(data: Record<string, string>): string | undefined {
  const payload = firstValue(data.content, data.data, data.rows, data.buttons);
  if (!payload) {
    return firstValue(data.label, data.text, data.name);
  }

  try {
    const parsed = JSON.parse(payload) as unknown;
    const labels = collectKeyboardLabels(parsed);
    return labels.length > 0 ? truncateInline(labels.join(", "), 160) : undefined;
  } catch {
    return truncateInline(payload, 160);
  }
}

function collectKeyboardLabels(value: unknown): string[] {
  const labels: string[] = [];
  const visit = (current: unknown): void => {
    if (!current || labels.length >= 8) {
      return;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }

    if (typeof current !== "object") {
      return;
    }

    const record = current as Record<string, unknown>;
    for (const key of ["label", "text", "name"]) {
      const label = record[key];
      if (typeof label === "string" && label.trim()) {
        labels.push(label.trim());
      }
    }

    for (const child of Object.values(record)) {
      visit(child);
    }
  };

  visit(value);
  return [...new Set(labels)];
}

function summarizeSegmentData(data: Record<string, string>): string {
  const values = Object.entries(data)
    .filter(([, value]) => value.trim() !== "")
    .map(([key, value]) => `${key}=${value}`);
  return values.length > 0 ? truncateInline(values.join(", ")) : "payload omitted";
}

function extractForwardNodes(input: unknown): Array<Record<string, unknown>> {
  const root = isRecord(input) && isRecord(input.data) ? input.data : input;
  const nodes = Array.isArray(root)
    ? root
    : isRecord(root) && Array.isArray(root.messages)
      ? root.messages
      : undefined;

  return nodes?.filter(isRecord) ?? [];
}

function forwardNodeData(node: Record<string, unknown>): Record<string, unknown> {
  return node.type === "node" && isRecord(node.data) ? node.data : node;
}

function forwardNodeSenderLabel(node: Record<string, unknown>): string {
  const data = forwardNodeData(node);
  const sender = isRecord(data.sender) ? data.sender : undefined;
  return (
    firstUnknownString(
      data.name,
      data.nickname,
      sender?.card,
      sender?.nickname,
      sender?.user_id,
      data.uin,
      data.user_id
    ) ?? "unknown"
  );
}

function forwardNodeContentSegments(node: Record<string, unknown>): CqSegment[] {
  const data = forwardNodeData(node);
  return normalizeForwardContent(data.content ?? data.message ?? data.raw_message);
}

function normalizeForwardContent(content: unknown): CqSegment[] {
  if (typeof content === "string") {
    return normalizeOneBotMessage(content);
  }

  if (isOneBotMessageSegmentArray(content)) {
    return normalizeOneBotMessage(content);
  }

  const text = isRecord(content)
    ? firstUnknownString(content.text, content.content, content.summary)
    : firstUnknownString(content);
  return text ? [{ type: "text", data: { text } }] : [];
}

function isOneBotMessageSegmentArray(input: unknown): input is Exclude<OneBotMessagePayload, string> {
  return (
    Array.isArray(input) &&
    input.every(
      (segment) =>
        isRecord(segment) &&
        typeof segment.type === "string" &&
        (segment.data === undefined || isRecord(segment.data))
    )
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function firstUnknownString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }

  return undefined;
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

  return isLikelyImageUrl(attachment.url) || (attachment.name ? isLikelyImageUrl(attachment.name) : false);
}

function formatReactionCount(
  count: number | null | undefined,
  label = "reaction"
): string {
  if (count === undefined || count === null || !Number.isFinite(count)) {
    return "";
  }

  return ` (${count} ${label}${count === 1 ? "" : "s"})`;
}

function formatDiscordPollToQqText(poll: DiscordPollLike): string {
  const question = normalizeWhitespace(poll.questionText ?? "") || "Untitled poll";
  const lines = [`[Discord poll] ${truncateInline(question, 300)}`];
  const answers = [...(poll.answers ?? [])];

  for (const [index, answer] of answers.entries()) {
    const id = answer.id !== undefined && answer.id !== null ? String(answer.id) : String(index + 1);
    const emoji = normalizeWhitespace(answer.emojiText ?? "");
    const text = normalizeWhitespace(answer.text ?? "");
    const label = truncateInline([emoji, text].filter(Boolean).join(" ") || "Option", 160);
    const votes =
      answer.voteCount !== undefined && answer.voteCount !== null && Number.isFinite(answer.voteCount)
        ? ` (${answer.voteCount} vote${answer.voteCount === 1 ? "" : "s"})`
        : "";
    lines.push(`${id}. ${label}${votes}`);
  }

  if (poll.allowMultiselect) {
    lines.push("Multiple selections allowed");
  }

  if (poll.expiresTimestamp !== undefined && poll.expiresTimestamp !== null) {
    const expiresAt = new Date(poll.expiresTimestamp);
    if (!Number.isNaN(expiresAt.getTime())) {
      lines.push(`Ends: ${expiresAt.toISOString()}`);
    }
  }

  if (poll.resultsFinalized) {
    lines.push("Results finalized");
  }

  return lines.join("\n");
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

function partSuffix(index: number, total: number): string {
  return `\n[part ${index}/${total}]`;
}

function truncateInline(text: string, maxLength = 160): string {
  if (!text) {
    return "payload omitted";
  }

  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function replyPreviewText(input: DiscordReplyPreviewLike): string {
  const content = normalizeWhitespace(input.content ?? "");
  const mediaParts = [
    input.attachmentCount ? `${input.attachmentCount} attachment(s)` : undefined,
    input.embedCount ? `${input.embedCount} embed(s)` : undefined,
    input.stickerCount ? `${input.stickerCount} sticker(s)` : undefined
  ].filter(Boolean);
  const rawPreview = content || mediaParts.join(", ");
  const preview = rawPreview ? truncateInline(rawPreview, 120) : "";
  const author = input.authorName?.trim();
  if (author && preview) {
    return `${author}: ${preview}`;
  }

  return author || preview;
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
