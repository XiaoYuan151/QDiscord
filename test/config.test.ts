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

    expect(config.allowEveryoneMentions).toBe(false);
    expect(config.bridgeBotMessages).toBe(false);
    expect(config.bridgeMemberEvents).toBe(true);
    expect(config.bridgeTypingIndicators).toBe(true);
    expect(config.uploadQqFiles).toBe(true);
    expect(config.statusCommandName).toBe("bridge");
    expect(config.statusCommandGuildIds.size).toBe(0);
    expect(config.healthPort).toBe(8787);
    expect(config.napcatReconnectInitialMs).toBe(1000);
    expect(config.napcatReconnectMaxMs).toBe(30000);
    expect(config.napcatHeartbeatIntervalMs).toBe(30000);
    expect(config.napcatHeartbeatTimeoutMs).toBe(10000);
    expect(config.messageLinkTtlMs).toBe(86400000);
    expect(config.messageLinkMaxEntries).toBe(10000);
    expect(config.shutdownDrainTimeoutMs).toBe(10000);
    expect(config.discordChannelToQqGroup.get("111")).toBe("222");
    expect(config.discordChannelToBridgePair.get("111")?.direction).toBe("both");
  });

  it("parses maps, filters, and operational settings", () => {
    const config = loadConfig({
      ...baseEnv,
      BRIDGE_PAIRS: "111:222:discord-to-qq",
      QQ_TO_DISCORD_USER_MAP: "1:2",
      DISCORD_TO_QQ_USER_MAP: "2:1",
      CQ_FACE_EMOJI_MAP: "14:🙂",
      DISCORD_EMOJI_CQ_FACE_MAP: "🙂:14",
      STATUS_COMMAND_NAME: "qbridge",
      STATUS_COMMAND_GUILD_IDS: "777,888",
      ALLOWED_DISCORD_CHANNEL_IDS: "111,333",
      BLOCKED_DISCORD_USER_IDS: "444",
      BLOCKED_QQ_USER_IDS: "555",
      NAPCAT_HEARTBEAT_INTERVAL_MS: "0",
      NAPCAT_HEARTBEAT_TIMEOUT_MS: "0",
      BRIDGE_TYPING_INDICATORS: "false",
      LOG_LEVEL: "debug",
      UPLOAD_QQ_FILES: "false",
      QUEUE_MAX_RETRIES: "0",
      SHUTDOWN_DRAIN_TIMEOUT_MS: "0",
      MESSAGE_LINK_TTL_MS: "5000",
      MESSAGE_LINK_MAX_ENTRIES: "100",
      MESSAGE_LINK_STORE_PATH: ".links.json",
      HEALTH_PORT: "0"
    });

    expect(config.qqToDiscordUserMap.get("1")).toBe("2");
    expect(config.discordToQqUserMap.get("2")).toBe("1");
    expect(config.cqFaceEmojiMap.get("14")).toBe("🙂");
    expect(config.discordEmojiToCqFaceMap.get("🙂")).toBe("14");
    expect(config.statusCommandName).toBe("qbridge");
    expect([...config.statusCommandGuildIds]).toEqual(["777", "888"]);
    expect(config.allowedDiscordChannelIds.has("333")).toBe(true);
    expect(config.blockedDiscordUserIds.has("444")).toBe(true);
    expect(config.blockedQqUserIds.has("555")).toBe(true);
    expect(config.napcatHeartbeatIntervalMs).toBe(0);
    expect(config.napcatHeartbeatTimeoutMs).toBe(0);
    expect(config.bridgeTypingIndicators).toBe(false);
    expect(config.logLevel).toBe("debug");
    expect(config.uploadQqFiles).toBe(false);
    expect(config.queueMaxRetries).toBe(0);
    expect(config.shutdownDrainTimeoutMs).toBe(0);
    expect(config.messageLinkTtlMs).toBe(5000);
    expect(config.messageLinkMaxEntries).toBe(100);
    expect(config.messageLinkStorePath).toBe(".links.json");
    expect(config.healthPort).toBe(0);
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
});
