import "dotenv/config";

import { z } from "zod";

import type { AppConfig, BridgeDirection, BridgePair, LogLevel } from "./types.js";

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
    BRIDGE_MEMBER_EVENTS: z.string().optional(),
    BRIDGE_TYPING_INDICATORS: z.string().optional(),
    UPLOAD_QQ_FILES: z.string().optional(),
    STATUS_COMMAND_ENABLED: z.string().optional(),
    STATUS_COMMAND_NAME: z.string().optional(),
    STATUS_COMMAND_GUILD_IDS: z.string().optional(),
    DISCORD_MAX_CONTENT_LENGTH: z.string().optional(),
    QQ_MAX_TEXT_SEGMENT_LENGTH: z.string().optional(),
    NAPCAT_RECONNECT_MS: z.string().optional(),
    NAPCAT_RECONNECT_INITIAL_MS: z.string().optional(),
    NAPCAT_RECONNECT_MAX_MS: z.string().optional(),
    NAPCAT_HEARTBEAT_INTERVAL_MS: z.string().optional(),
    NAPCAT_HEARTBEAT_TIMEOUT_MS: z.string().optional(),
    ONEBOT_ACTION_TIMEOUT_MS: z.string().optional(),
    QUEUE_CONCURRENCY: z.string().optional(),
    QUEUE_MIN_DELAY_MS: z.string().optional(),
    QUEUE_MAX_RETRIES: z.string().optional(),
    QUEUE_RETRY_BASE_DELAY_MS: z.string().optional(),
    SHUTDOWN_DRAIN_TIMEOUT_MS: z.string().optional(),
    MESSAGE_LINK_TTL_MS: z.string().optional(),
    MESSAGE_LINK_MAX_ENTRIES: z.string().optional(),
    MESSAGE_LINK_STORE_PATH: z.string().optional(),
    HEALTH_ENABLED: z.string().optional(),
    HEALTH_HOST: z.string().optional(),
    HEALTH_PORT: z.string().optional(),
    LOG_LEVEL: z.string().optional(),
    ALLOWED_DISCORD_CHANNEL_IDS: z.string().optional(),
    BLOCKED_DISCORD_USER_IDS: z.string().optional(),
    BLOCKED_QQ_USER_IDS: z.string().optional()
  })
  .passthrough();

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const bridgePairs = parseBridgePairs(parsed.data.BRIDGE_PAIRS);
  const discordChannelToQqGroup = new Map<string, string>();
  const qqGroupToDiscordChannel = new Map<string, string>();
  const discordChannelToBridgePair = new Map<string, BridgePair>();
  const qqGroupToBridgePair = new Map<string, BridgePair>();

  for (const pair of bridgePairs) {
    discordChannelToQqGroup.set(pair.discordChannelId, pair.qqGroupId);
    qqGroupToDiscordChannel.set(pair.qqGroupId, pair.discordChannelId);
    discordChannelToBridgePair.set(pair.discordChannelId, pair);
    qqGroupToBridgePair.set(pair.qqGroupId, pair);
  }

  const napcatReconnectInitialMs = parsePositiveInteger(
    parsed.data.NAPCAT_RECONNECT_INITIAL_MS ?? parsed.data.NAPCAT_RECONNECT_MS,
    1000
  );
  const napcatReconnectMaxMs = parsePositiveInteger(parsed.data.NAPCAT_RECONNECT_MAX_MS, 30_000);
  if (napcatReconnectMaxMs < napcatReconnectInitialMs) {
    throw new Error("NAPCAT_RECONNECT_MAX_MS must be greater than or equal to the initial delay");
  }

  return {
    discordToken: parseSecret(parsed.data.DISCORD_TOKEN, "DISCORD_TOKEN"),
    napcatWsUrl: parsed.data.NAPCAT_WS_URL,
    napcatAccessToken: parseOptionalSecret(parsed.data.NAPCAT_ACCESS_TOKEN, "NAPCAT_ACCESS_TOKEN"),
    bridgePairs,
    discordChannelToQqGroup,
    qqGroupToDiscordChannel,
    discordChannelToBridgePair,
    qqGroupToBridgePair,
    qqToDiscordUserMap: parseKeyValueMap(parsed.data.QQ_TO_DISCORD_USER_MAP),
    discordToQqUserMap: parseKeyValueMap(parsed.data.DISCORD_TO_QQ_USER_MAP),
    cqFaceEmojiMap: parseKeyValueMap(parsed.data.CQ_FACE_EMOJI_MAP),
    discordEmojiToCqFaceMap: parseKeyValueMap(parsed.data.DISCORD_EMOJI_CQ_FACE_MAP),
    showSenderName: parseBoolean(parsed.data.SHOW_SENDER_NAME, true),
    bridgeBotMessages: parseBoolean(parsed.data.BRIDGE_BOT_MESSAGES, false),
    allowEveryoneMentions: parseBoolean(parsed.data.ALLOW_EVERYONE_MENTIONS, false),
    bridgeMemberEvents: parseBoolean(parsed.data.BRIDGE_MEMBER_EVENTS, true),
    bridgeTypingIndicators: parseBoolean(parsed.data.BRIDGE_TYPING_INDICATORS, true),
    uploadQqFiles: parseBoolean(parsed.data.UPLOAD_QQ_FILES, true),
    statusCommandEnabled: parseBoolean(parsed.data.STATUS_COMMAND_ENABLED, true),
    statusCommandName: parseCommandName(parsed.data.STATUS_COMMAND_NAME, "bridge"),
    statusCommandGuildIds: parseSet(parsed.data.STATUS_COMMAND_GUILD_IDS),
    discordMaxContentLength: parseBoundedInteger(parsed.data.DISCORD_MAX_CONTENT_LENGTH, 1900, {
      min: 500,
      max: 2000
    }),
    qqMaxTextSegmentLength: parseBoundedInteger(parsed.data.QQ_MAX_TEXT_SEGMENT_LENGTH, 3500, {
      min: 500,
      max: 10_000
    }),
    napcatReconnectInitialMs,
    napcatReconnectMaxMs,
    napcatHeartbeatIntervalMs: parseNonNegativeInteger(
      parsed.data.NAPCAT_HEARTBEAT_INTERVAL_MS,
      30_000
    ),
    napcatHeartbeatTimeoutMs: parseNonNegativeInteger(
      parsed.data.NAPCAT_HEARTBEAT_TIMEOUT_MS,
      10_000
    ),
    oneBotActionTimeoutMs: parsePositiveInteger(parsed.data.ONEBOT_ACTION_TIMEOUT_MS, 15_000),
    queueConcurrency: parsePositiveInteger(parsed.data.QUEUE_CONCURRENCY, 1),
    queueMinDelayMs: parseNonNegativeInteger(parsed.data.QUEUE_MIN_DELAY_MS, 250),
    queueMaxRetries: parseNonNegativeInteger(parsed.data.QUEUE_MAX_RETRIES, 3),
    queueRetryBaseDelayMs: parsePositiveInteger(parsed.data.QUEUE_RETRY_BASE_DELAY_MS, 1000),
    shutdownDrainTimeoutMs: parseNonNegativeInteger(parsed.data.SHUTDOWN_DRAIN_TIMEOUT_MS, 10_000),
    messageLinkTtlMs: parsePositiveInteger(parsed.data.MESSAGE_LINK_TTL_MS, 86_400_000),
    messageLinkMaxEntries: parsePositiveInteger(parsed.data.MESSAGE_LINK_MAX_ENTRIES, 10_000),
    messageLinkStorePath: emptyToUndefined(parsed.data.MESSAGE_LINK_STORE_PATH),
    healthEnabled: parseBoolean(parsed.data.HEALTH_ENABLED, true),
    healthHost: emptyToUndefined(parsed.data.HEALTH_HOST) ?? "127.0.0.1",
    healthPort: parsePort(parsed.data.HEALTH_PORT, 8787),
    logLevel: parseLogLevel(parsed.data.LOG_LEVEL, "info"),
    allowedDiscordChannelIds: parseSet(parsed.data.ALLOWED_DISCORD_CHANNEL_IDS),
    blockedDiscordUserIds: parseSet(parsed.data.BLOCKED_DISCORD_USER_IDS),
    blockedQqUserIds: parseSet(parsed.data.BLOCKED_QQ_USER_IDS)
  };
}

function parseBridgePairs(input: string): BridgePair[] {
  const pairs = splitList(input).map((entry) => {
    const [discordChannelId, qqGroupId, direction] = splitBridgePair(entry);
    if (!discordChannelId || !qqGroupId) {
      throw new Error(`Invalid BRIDGE_PAIRS entry: ${entry}`);
    }

    return { discordChannelId, qqGroupId, direction };
  });

  if (pairs.length === 0) {
    throw new Error("BRIDGE_PAIRS must contain at least one discordChannelId:qqGroupId pair");
  }

  assertUnique(pairs.map((pair) => pair.discordChannelId), "Discord channel in BRIDGE_PAIRS");
  assertUnique(pairs.map((pair) => pair.qqGroupId), "QQ group in BRIDGE_PAIRS");

  return pairs;
}

function splitBridgePair(entry: string): [string, string, BridgeDirection] {
  const parts = entry.split(":").map((part) => part.trim());
  if (parts.length === 1) {
    const [discordChannelId, qqGroupId] = splitKeyValue(entry);
    return [discordChannelId, qqGroupId, "both"];
  }
  if (parts.length === 2) {
    return [parts[0] ?? "", parts[1] ?? "", "both"];
  }
  if (parts.length === 3) {
    return [parts[0] ?? "", parts[1] ?? "", parseBridgeDirection(parts[2] ?? "")];
  }

  throw new Error(`Invalid BRIDGE_PAIRS entry: ${entry}`);
}

function parseBridgeDirection(input: string): BridgeDirection {
  const normalized = input.trim().toLowerCase();
  if (["both", "bidirectional", "bi"].includes(normalized)) {
    return "both";
  }
  if (["discord-to-qq", "discord", "d2q"].includes(normalized)) {
    return "discord-to-qq";
  }
  if (["qq-to-discord", "qq", "q2d"].includes(normalized)) {
    return "qq-to-discord";
  }

  throw new Error(`Invalid bridge direction: ${input}`);
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

function parseNonNegativeInteger(input: string | undefined, defaultValue: number): number {
  if (input === undefined || input.trim() === "") {
    return defaultValue;
  }

  const value = Number(input);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Expected a non-negative integer, got: ${input}`);
  }

  return value;
}

function parseBoundedInteger(
  input: string | undefined,
  defaultValue: number,
  bounds: { min: number; max: number }
): number {
  const value = parsePositiveInteger(input, defaultValue);
  if (value < bounds.min || value > bounds.max) {
    throw new Error(`Expected an integer between ${bounds.min} and ${bounds.max}, got: ${value}`);
  }

  return value;
}

function parsePort(input: string | undefined, defaultValue: number): number {
  const value = parseNonNegativeInteger(input, defaultValue);
  if (value > 65_535) {
    throw new Error(`Expected a TCP port between 0 and 65535, got: ${input}`);
  }

  return value;
}

function parseLogLevel(input: string | undefined, defaultValue: LogLevel): LogLevel {
  const normalized = input?.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  if (["debug", "info", "warn", "error", "silent"].includes(normalized)) {
    return normalized as LogLevel;
  }

  throw new Error(`Invalid log level: ${input}`);
}

function parseCommandName(input: string | undefined, defaultValue: string): string {
  const commandName = emptyToUndefined(input) ?? defaultValue;
  if (!/^[a-z0-9_-]{1,32}$/.test(commandName)) {
    throw new Error(`Invalid Discord command name: ${commandName}`);
  }

  return commandName;
}

function parseOptionalSecret(input: string | undefined, label: string): string | undefined {
  const secret = emptyToUndefined(input);
  return secret ? parseSecret(secret, label) : undefined;
}

function parseSecret(input: string, label: string): string {
  const secret = input.trim();
  if (!secret || /^(replace|replace-with|your-|changeme|change-me|example)/i.test(secret)) {
    throw new Error(`${label} must be set to a real secret, not a placeholder`);
  }

  return secret;
}

function parseSet(input: string | undefined): Set<string> {
  return new Set(splitList(input ?? ""));
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`${label} is duplicated: ${value}`);
    }
    seen.add(value);
  }
}

function emptyToUndefined(input: string | undefined): string | undefined {
  const trimmed = input?.trim();
  return trimmed ? trimmed : undefined;
}
