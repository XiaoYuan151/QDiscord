import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const baseEnv = {
  DISCORD_TOKEN: "discord-token",
  NAPCAT_WS_URL: "ws://127.0.0.1:3001",
  BRIDGE_PAIRS: "111:222"
};

describe("config", () => {
  it("loads production defaults safely", () => {
    const config = loadConfig(baseEnv);

    expect([...config.discordPermissions]).toEqual([
      "ViewChannel",
      "SendMessages",
      "AttachFiles",
      "ReadMessageHistory"
    ]);
    expect(config.allowEveryoneMentions).toBe(false);
    expect(config.bridgeBotMessages).toBe(false);
    expect(config.bridgeMemberEvents).toBe(true);
    expect(config.bridgeTypingIndicators).toBe(true);
    expect(config.uploadQqFiles).toBe(true);
    expect(config.resolveQqMediaUrls).toBe(true);
    expect(config.statusCommandName).toBe("bridge");
    expect(config.statusCommandGuildIds.size).toBe(0);
    expect(config.statusCommandAllowedUserIds.size).toBe(0);
    expect(config.healthPort).toBe(8787);
    expect(config.healthStatusToken).toBeUndefined();
    expect(config.napcatReconnectInitialMs).toBe(1000);
    expect(config.napcatReconnectMaxMs).toBe(30000);
    expect(config.napcatReconnectJitterMs).toBe(0);
    expect(config.napcatHeartbeatIntervalMs).toBe(30000);
    expect(config.napcatHeartbeatTimeoutMs).toBe(10000);
    expect(config.messageLinkTtlMs).toBe(86400000);
    expect(config.messageLinkMaxEntries).toBe(10000);
    expect(config.shutdownDrainTimeoutMs).toBe(10000);
    expect(config.queueMaxPending).toBe(1000);
    expect(config.discordChannelToQqGroup.get("111")).toBe("222");
    expect(config.discordChannelToBridgePair.get("111")?.direction).toBe("both");
  });

  it("parses maps, filters, and operational settings", () => {
    const config = loadConfig({
      ...baseEnv,
      BRIDGE_PAIRS: "111:222:discord-to-qq",
      DISCORD_PERMISSIONS: "ViewChannel,SendMessages,EmbedLinks",
      QQ_TO_DISCORD_USER_MAP: "1:2",
      DISCORD_TO_QQ_USER_MAP: "2:1",
      CQ_FACE_EMOJI_MAP: "14:🙂",
      DISCORD_EMOJI_CQ_FACE_MAP: "🙂:14",
      STATUS_COMMAND_NAME: "qbridge",
      STATUS_COMMAND_GUILD_IDS: "777,888",
      STATUS_COMMAND_ALLOWED_USER_IDS: "999,1000",
      ALLOWED_DISCORD_CHANNEL_IDS: "111,333",
      BLOCKED_DISCORD_USER_IDS: "444",
      BLOCKED_QQ_USER_IDS: "555",
      NAPCAT_RECONNECT_JITTER_MS: "250",
      NAPCAT_HEARTBEAT_INTERVAL_MS: "0",
      NAPCAT_HEARTBEAT_TIMEOUT_MS: "0",
      BRIDGE_TYPING_INDICATORS: "false",
      LOG_LEVEL: "debug",
      UPLOAD_QQ_FILES: "false",
      RESOLVE_QQ_MEDIA_URLS: "false",
      QUEUE_MAX_PENDING: "50",
      QUEUE_MAX_RETRIES: "0",
      SHUTDOWN_DRAIN_TIMEOUT_MS: "0",
      MESSAGE_LINK_TTL_MS: "5000",
      MESSAGE_LINK_MAX_ENTRIES: "100",
      MESSAGE_LINK_STORE_PATH: ".links.json",
      HEALTH_PORT: "0",
      HEALTH_STATUS_TOKEN: "status-secret"
    });

    expect(config.qqToDiscordUserMap.get("1")).toBe("2");
    expect([...config.discordPermissions]).toEqual([
      "ViewChannel",
      "SendMessages",
      "EmbedLinks"
    ]);
    expect(config.discordToQqUserMap.get("2")).toBe("1");
    expect(config.cqFaceEmojiMap.get("14")).toBe("🙂");
    expect(config.discordEmojiToCqFaceMap.get("🙂")).toBe("14");
    expect(config.statusCommandName).toBe("qbridge");
    expect([...config.statusCommandGuildIds]).toEqual(["777", "888"]);
    expect([...config.statusCommandAllowedUserIds]).toEqual(["999", "1000"]);
    expect(config.allowedDiscordChannelIds.has("333")).toBe(true);
    expect(config.blockedDiscordUserIds.has("444")).toBe(true);
    expect(config.blockedQqUserIds.has("555")).toBe(true);
    expect(config.napcatReconnectJitterMs).toBe(250);
    expect(config.napcatHeartbeatIntervalMs).toBe(0);
    expect(config.napcatHeartbeatTimeoutMs).toBe(0);
    expect(config.bridgeTypingIndicators).toBe(false);
    expect(config.logLevel).toBe("debug");
    expect(config.uploadQqFiles).toBe(false);
    expect(config.resolveQqMediaUrls).toBe(false);
    expect(config.queueMaxPending).toBe(50);
    expect(config.queueMaxRetries).toBe(0);
    expect(config.shutdownDrainTimeoutMs).toBe(0);
    expect(config.messageLinkTtlMs).toBe(5000);
    expect(config.messageLinkMaxEntries).toBe(100);
    expect(config.messageLinkStorePath).toBe(".links.json");
    expect(config.healthPort).toBe(0);
    expect(config.healthStatusToken).toBe("status-secret");
    expect(config.discordChannelToBridgePair.get("111")?.direction).toBe("discord-to-qq");
    expect(config.qqGroupToBridgePair.get("222")?.direction).toBe("discord-to-qq");
  });

  it("rejects invalid command names", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        STATUS_COMMAND_NAME: "Bridge Status"
      })
    ).toThrow("Invalid Discord command name");
  });

  it("rejects invalid Discord permission names", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        DISCORD_PERMISSIONS: "ViewChannel,Administrator"
      })
    ).toThrow("Invalid DISCORD_PERMISSIONS entry");
  });

  it("rejects duplicate bridge routes", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        BRIDGE_PAIRS: "111:222,111:333"
      })
    ).toThrow("Discord channel in BRIDGE_PAIRS is duplicated");

    expect(() =>
      loadConfig({
        ...baseEnv,
        BRIDGE_PAIRS: "111:222,333:222"
      })
    ).toThrow("QQ group in BRIDGE_PAIRS is duplicated");
  });

  it("rejects reconnect max lower than initial delay", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        NAPCAT_RECONNECT_INITIAL_MS: "5000",
        NAPCAT_RECONNECT_MAX_MS: "1000"
      })
    ).toThrow("NAPCAT_RECONNECT_MAX_MS");
  });

  it("rejects invalid bridge directions", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        BRIDGE_PAIRS: "111:222:sideways"
      })
    ).toThrow("Invalid bridge direction");
  });

  it("rejects placeholder secrets", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        DISCORD_TOKEN: "replace-with-your-discord-bot-token"
      })
    ).toThrow("DISCORD_TOKEN must be set to a real secret");

    expect(() =>
      loadConfig({
        ...baseEnv,
        NAPCAT_ACCESS_TOKEN: "changeme"
      })
    ).toThrow("NAPCAT_ACCESS_TOKEN must be set to a real secret");

    expect(() =>
      loadConfig({
        ...baseEnv,
        HEALTH_STATUS_TOKEN: "example"
      })
    ).toThrow("HEALTH_STATUS_TOKEN must be set to a real secret");
  });

  it("rejects invalid NapCat WebSocket URLs", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        NAPCAT_WS_URL: "http://127.0.0.1:3001"
      })
    ).toThrow("NAPCAT_WS_URL must use ws:// or wss://");

    expect(() =>
      loadConfig({
        ...baseEnv,
        NAPCAT_WS_URL: "not a url"
      })
    ).toThrow("NAPCAT_WS_URL must be a valid");
  });

  it("rejects non-numeric route, mapping, filter, and guild ids", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        BRIDGE_PAIRS: "abc:222"
      })
    ).toThrow("BRIDGE_PAIRS Discord channel id must be numeric");

    expect(() =>
      loadConfig({
        ...baseEnv,
        QQ_TO_DISCORD_USER_MAP: "1:discord-user"
      })
    ).toThrow("QQ_TO_DISCORD_USER_MAP Discord user id must be numeric");

    expect(() =>
      loadConfig({
        ...baseEnv,
        STATUS_COMMAND_GUILD_IDS: "guild"
      })
    ).toThrow("STATUS_COMMAND_GUILD_IDS must be numeric");

    expect(() =>
      loadConfig({
        ...baseEnv,
        STATUS_COMMAND_ALLOWED_USER_IDS: "user"
      })
    ).toThrow("STATUS_COMMAND_ALLOWED_USER_IDS must be numeric");

    expect(() =>
      loadConfig({
        ...baseEnv,
        BLOCKED_QQ_USER_IDS: "qq-user"
      })
    ).toThrow("BLOCKED_QQ_USER_IDS must be numeric");
  });

  it("validates CQ face ids while allowing flexible Discord emoji keys", () => {
    const config = loadConfig({
      ...baseEnv,
      CQ_FACE_EMOJI_MAP: "14:<:qq_smile:222>",
      DISCORD_EMOJI_CQ_FACE_MAP: "qq_smile:14,🙂:15,222:16"
    });

    expect(config.cqFaceEmojiMap.get("14")).toBe("<:qq_smile:222>");
    expect(config.discordEmojiToCqFaceMap.get("qq_smile")).toBe("14");
    expect(config.discordEmojiToCqFaceMap.get("🙂")).toBe("15");
    expect(config.discordEmojiToCqFaceMap.get("222")).toBe("16");

    expect(() =>
      loadConfig({
        ...baseEnv,
        CQ_FACE_EMOJI_MAP: "smile:🙂"
      })
    ).toThrow("CQ_FACE_EMOJI_MAP QQ face id must be numeric");

    expect(() =>
      loadConfig({
        ...baseEnv,
        DISCORD_EMOJI_CQ_FACE_MAP: "🙂:smile"
      })
    ).toThrow("DISCORD_EMOJI_CQ_FACE_MAP QQ face id must be numeric");
  });
});
