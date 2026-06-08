import "dotenv/config";

import { z } from "zod";

import type { AppConfig, BridgePair } from "./types.js";

const envSchema = z
  .object({
    DISCORD_TOKEN: z.string().min(1),
    NAPCAT_WS_URL: z.string().min(1),
    NAPCAT_ACCESS_TOKEN: z.string().optional(),
    BRIDGE_PAIRS: z.string().min(1),
    QQ_TO_DISCORD_USER_MAP: z.string().optional(),
    DISCORD_TO_QQ_USER_MAP: z.string().optional(),
    CQ_FACE_EMOJI_MAP: z.string().optional(),
    DISCORD_EMOJI_CQ_FACE_MAP: z.string().optional(),
    SHOW_SENDER_NAME: z.string().optional(),
    BRIDGE_BOT_MESSAGES: z.string().optional(),
    ALLOW_EVERYONE_MENTIONS: z.string().optional(),
    NAPCAT_RECONNECT_MS: z.string().optional()
  })
  .passthrough();

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const bridgePairs = parseBridgePairs(parsed.data.BRIDGE_PAIRS);
  const discordChannelToQqGroup = new Map<string, string>();
  const qqGroupToDiscordChannel = new Map<string, string>();

  for (const pair of bridgePairs) {
    discordChannelToQqGroup.set(pair.discordChannelId, pair.qqGroupId);
    qqGroupToDiscordChannel.set(pair.qqGroupId, pair.discordChannelId);
  }

  return {
    discordToken: parsed.data.DISCORD_TOKEN,
    napcatWsUrl: parsed.data.NAPCAT_WS_URL,
    napcatAccessToken: emptyToUndefined(parsed.data.NAPCAT_ACCESS_TOKEN),
    bridgePairs,
    discordChannelToQqGroup,
    qqGroupToDiscordChannel,
    qqToDiscordUserMap: parseKeyValueMap(parsed.data.QQ_TO_DISCORD_USER_MAP),
    discordToQqUserMap: parseKeyValueMap(parsed.data.DISCORD_TO_QQ_USER_MAP),
    cqFaceEmojiMap: parseKeyValueMap(parsed.data.CQ_FACE_EMOJI_MAP),
    discordEmojiToCqFaceMap: parseKeyValueMap(parsed.data.DISCORD_EMOJI_CQ_FACE_MAP),
    showSenderName: parseBoolean(parsed.data.SHOW_SENDER_NAME, true),
    bridgeBotMessages: parseBoolean(parsed.data.BRIDGE_BOT_MESSAGES, false),
    allowEveryoneMentions: parseBoolean(parsed.data.ALLOW_EVERYONE_MENTIONS, false),
    napcatReconnectMs: parsePositiveInteger(parsed.data.NAPCAT_RECONNECT_MS, 5000)
  };
}

function parseBridgePairs(input: string): BridgePair[] {
  const pairs = splitList(input).map((entry) => {
    const [discordChannelId, qqGroupId] = splitKeyValue(entry);
    if (!discordChannelId || !qqGroupId) {
      throw new Error(`Invalid BRIDGE_PAIRS entry: ${entry}`);
    }

    return { discordChannelId, qqGroupId };
  });

  if (pairs.length === 0) {
    throw new Error("BRIDGE_PAIRS must contain at least one discordChannelId:qqGroupId pair");
  }

  return pairs;
}

function parseKeyValueMap(input: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of splitList(input ?? "")) {
    const [key, value] = splitKeyValue(entry);
    if (!key || !value) {
      throw new Error(`Invalid key/value mapping entry: ${entry}`);
    }

    map.set(key, value);
  }

  return map;
}

function splitList(input: string): string[] {
  return input
    .split(/[\n;,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitKeyValue(entry: string): [string, string] {
  const equalsIndex = entry.indexOf("=");
  const colonIndex = entry.indexOf(":");
  const separatorIndex =
    equalsIndex >= 0 && (colonIndex < 0 || equalsIndex < colonIndex) ? equalsIndex : colonIndex;

  if (separatorIndex < 0) {
    return [entry.trim(), ""];
  }

  return [entry.slice(0, separatorIndex).trim(), entry.slice(separatorIndex + 1).trim()];
}

function parseBoolean(input: string | undefined, defaultValue: boolean): boolean {
  if (input === undefined || input.trim() === "") {
    return defaultValue;
  }

  const normalized = input.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${input}`);
}

function parsePositiveInteger(input: string | undefined, defaultValue: number): number {
  if (input === undefined || input.trim() === "") {
    return defaultValue;
  }

  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected a positive integer, got: ${input}`);
  }

  return value;
}

function emptyToUndefined(input: string | undefined): string | undefined {
  const trimmed = input?.trim();
  return trimmed ? trimmed : undefined;
}
