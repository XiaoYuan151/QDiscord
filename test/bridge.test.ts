import { describe, expect, it } from "vitest";

import {
  formatStatusForDiscord,
  formatOneBotGroupUpload,
  formatOneBotGroupMemberNotice,
  formatOneBotGroupNotice,
  formatOneBotGroupRequest,
  isBridgeRouteAllowed,
  isDiscordActorBridgeable,
  isOneBotNoticeBlocked,
  isOneBotRequestBlocked,
  isStatusCommandAuthorized,
  messageLinkMatchesBridgePairs,
  normalizeMessageLink,
  oneBotGroupUploadFileRequest,
  resolveDiscordBridgeRoute,
  statusCommandRegistrationGuildIds
} from "../src/bridge.js";
import type {
  BridgePair,
  BridgeRuntimeStatus,
  OneBotNoticeEvent,
  OneBotRequestEvent
} from "../src/types.js";

describe("bridge command authorization", () => {
  it("allows status command users by allow-list or Manage Server permission", () => {
    expect(
      isStatusCommandAuthorized({
        userId: "111",
        guildId: "guild-1",
        allowedUserIds: new Set(["111"]),
        allowedGuildIds: new Set(["guild-1"]),
        hasManageGuild: false
      })
    ).toBe(true);

    expect(
      isStatusCommandAuthorized({
        userId: "222",
        guildId: "guild-1",
        allowedUserIds: new Set(),
        allowedGuildIds: new Set(),
        hasManageGuild: true
      })
    ).toBe(true);

    expect(
      isStatusCommandAuthorized({
        userId: "333",
        guildId: "guild-1",
        allowedUserIds: new Set(["111"]),
        allowedGuildIds: new Set(["guild-1"]),
        hasManageGuild: false
      })
    ).toBe(false);
  });

  it("blocks status command use outside configured Discord guilds", () => {
    expect(
      isStatusCommandAuthorized({
        userId: "111",
        guildId: "guild-2",
        allowedUserIds: new Set(["111"]),
        allowedGuildIds: new Set(["guild-1"]),
        hasManageGuild: true
      })
    ).toBe(false);

    expect(
      isStatusCommandAuthorized({
        userId: "111",
        guildId: null,
        allowedUserIds: new Set(["111"]),
        allowedGuildIds: new Set(["guild-1"]),
        hasManageGuild: true
      })
    ).toBe(false);
  });
});

describe("bridge command registration scope", () => {
  it("registers globally when no guild scope is configured", () => {
    expect(
      statusCommandRegistrationGuildIds({
        statusCommandGuildIds: new Set(),
        allowedDiscordGuildIds: new Set()
      })
    ).toEqual([]);
  });

  it("uses allowed Discord guilds as the default guild registration scope", () => {
    expect(
      statusCommandRegistrationGuildIds({
        statusCommandGuildIds: new Set(),
        allowedDiscordGuildIds: new Set(["100", "200"])
      })
    ).toEqual(["100", "200"]);
  });

  it("prefers explicit status command guild ids over allowed Discord guilds", () => {
    expect(
      statusCommandRegistrationGuildIds({
        statusCommandGuildIds: new Set(["300"]),
        allowedDiscordGuildIds: new Set(["100", "200"])
      })
    ).toEqual(["300"]);
  });
});

describe("Discord actor filtering", () => {
  it("blocks the bridge bot, configured users, and bots by default", () => {
    expect(
      isDiscordActorBridgeable({
        userId: "bot-user",
        isBot: true,
        selfUserId: "bot-user",
        blockedDiscordUserIds: new Set(),
        bridgeBotMessages: true
      })
    ).toBe(false);

    expect(
      isDiscordActorBridgeable({
        userId: "blocked-user",
        isBot: false,
        selfUserId: "bot-user",
        blockedDiscordUserIds: new Set(["blocked-user"]),
        bridgeBotMessages: true
      })
    ).toBe(false);

    expect(
      isDiscordActorBridgeable({
        userId: "other-bot",
        isBot: true,
        selfUserId: "bot-user",
        blockedDiscordUserIds: new Set(),
        bridgeBotMessages: false
      })
    ).toBe(false);
  });

  it("allows humans and configured bot messages", () => {
    expect(
      isDiscordActorBridgeable({
        userId: "human",
        isBot: false,
        selfUserId: "bot-user",
        blockedDiscordUserIds: new Set(),
        bridgeBotMessages: false
      })
    ).toBe(true);

    expect(
      isDiscordActorBridgeable({
        userId: "other-bot",
        isBot: true,
        selfUserId: "bot-user",
        blockedDiscordUserIds: new Set(),
        bridgeBotMessages: true
      })
    ).toBe(true);
  });
});

describe("bridge status formatting", () => {
  it("includes completed queue counts", () => {
    const status: BridgeRuntimeStatus = {
      startedAt: "2026-06-09T00:00:00.000Z",
      uptimeSeconds: 30,
      discord: { ready: true, userTag: "bot#0000", guildCount: 1, pingMs: 42 },
      oneBot: { connected: true, connecting: false, selfQQId: "123", reconnectAttempts: 0 },
      queues: {
        "discord-to-qq": { pending: 1, running: 0, completed: 5, failed: 0, dropped: 0 }
      },
      bridgePairs: 1,
      messageLinks: { tracked: 2, maxEntries: 100, ttlMs: 1000 },
      routes: [{ discordChannelId: "111", qqGroupId: "222", direction: "both" }]
    };

    expect(formatStatusForDiscord(status)).toContain(
      "discord-to-qq: pending 1, running 0, completed 5, failed 0, dropped 0"
    );
  });
});

describe("bridge message link normalization", () => {
  it("deduplicates linked message ids while preserving first reply targets", () => {
    expect(
      normalizeMessageLink({
        discordMessageId: "d1",
        discordMessageIds: ["d1", "d2", "d2"],
        discordChannelId: "channel",
        qqGroupId: "group",
        qqMessageId: "q1",
        qqMessageIds: ["q1", "q2", "q2"],
        createdAt: 123
      })
    ).toEqual({
      discordMessageId: "d1",
      discordMessageIds: ["d1", "d2"],
      discordChannelId: "channel",
      qqGroupId: "group",
      qqMessageId: "q1",
      qqMessageIds: ["q1", "q2"],
      createdAt: 123
    });
  });

  it("upgrades legacy single-id links to multi-id shape", () => {
    expect(
      normalizeMessageLink({
        discordMessageId: "d1",
        discordChannelId: "channel",
        qqGroupId: "group",
        qqMessageId: "q1",
        createdAt: 123
      })
    ).toMatchObject({
      discordMessageIds: ["d1"],
      qqMessageIds: ["q1"]
    });
  });
});

describe("bridge message link route matching", () => {
  const link = {
    discordMessageId: "d1",
    discordChannelId: "100",
    qqGroupId: "200",
    qqMessageId: "q1",
    createdAt: 123
  };

  it("keeps persisted links that still match the configured route pair", () => {
    expect(
      messageLinkMatchesBridgePairs(
        link,
        new Map([
          [
            "200",
            {
              discordChannelId: "100",
              qqGroupId: "200",
              direction: "both"
            }
          ]
        ])
      )
    ).toBe(true);
  });

  it("drops persisted links for removed or remapped route pairs", () => {
    expect(messageLinkMatchesBridgePairs(link, new Map())).toBe(false);
    expect(
      messageLinkMatchesBridgePairs(
        link,
        new Map([
          [
            "200",
            {
              discordChannelId: "999",
              qqGroupId: "200",
              direction: "both"
            }
          ]
        ])
      )
    ).toBe(false);
  });
});

describe("Discord bridge route resolution", () => {
  const parentPair: BridgePair = {
    discordChannelId: "100",
    qqGroupId: "200",
    direction: "both"
  };

  it("resolves direct channel routes", () => {
    expect(
      resolveDiscordBridgeRoute({
        channelId: "100",
        bridgePairs: new Map([["100", parentPair]])
      })
    ).toEqual({ pair: parentPair, routeChannelId: "100" });
  });

  it("resolves thread messages through configured parent channels", () => {
    expect(
      resolveDiscordBridgeRoute({
        channelId: "300",
        threadParentId: "100",
        threadName: "incident",
        bridgePairs: new Map([["100", parentPair]])
      })
    ).toEqual({
      pair: parentPair,
      routeChannelId: "100",
      threadName: "incident"
    });
  });

  it("prefers direct routes over parent thread routes", () => {
    const threadPair: BridgePair = {
      discordChannelId: "300",
      qqGroupId: "400",
      direction: "discord-to-qq"
    };

    expect(
      resolveDiscordBridgeRoute({
        channelId: "300",
        threadParentId: "100",
        threadName: "incident",
        bridgePairs: new Map([
          ["100", parentPair],
          ["300", threadPair]
        ])
      })
    ).toEqual({ pair: threadPair, routeChannelId: "300" });
  });
});

describe("Bridge route allow-list filtering", () => {
  it("allows routes when allow-lists are empty", () => {
    expect(
      isBridgeRouteAllowed({
        discordChannelIds: ["100"],
        qqGroupId: "200",
        allowedDiscordChannelIds: new Set(),
        allowedQqGroupIds: new Set()
      })
    ).toBe(true);
  });

  it("allows thread routes when either actual or configured Discord channel is listed", () => {
    expect(
      isBridgeRouteAllowed({
        discordChannelIds: ["thread-300", "100"],
        qqGroupId: "200",
        allowedDiscordChannelIds: new Set(["100"]),
        allowedQqGroupIds: new Set(["200"])
      })
    ).toBe(true);

    expect(
      isBridgeRouteAllowed({
        discordChannelIds: ["thread-300", "100"],
        qqGroupId: "200",
        allowedDiscordChannelIds: new Set(["thread-300"]),
        allowedQqGroupIds: new Set(["200"])
      })
    ).toBe(true);
  });

  it("blocks routes unless both Discord channel and QQ group pass allow-lists", () => {
    expect(
      isBridgeRouteAllowed({
        discordChannelIds: ["100"],
        qqGroupId: "200",
        allowedDiscordChannelIds: new Set(["999"]),
        allowedQqGroupIds: new Set(["200"])
      })
    ).toBe(false);

    expect(
      isBridgeRouteAllowed({
        discordChannelIds: ["100"],
        qqGroupId: "200",
        allowedDiscordChannelIds: new Set(["100"]),
        allowedQqGroupIds: new Set(["999"])
      })
    ).toBe(false);
  });
});

describe("OneBot group notice formatting", () => {
  it("formats QQ upload notices and extracts file URL lookup data", () => {
    const event: OneBotNoticeEvent = {
      post_type: "notice",
      notice_type: "group_upload",
      group_id: 100,
      user_id: 200,
      file: {
        id: "file-id",
        busid: 102,
        name: "report.zip",
        size: 2048
      }
    };

    expect(formatOneBotGroupUpload(event)).toBe(
      "[QQ file upload] User 200 uploaded report.zip (2.0 KB)"
    );
    expect(oneBotGroupUploadFileRequest(event)).toEqual({
      fileId: "file-id",
      busid: "102"
    });
  });

  it("formats QQ admin and mute notices", () => {
    expect(
      formatOneBotGroupNotice({
        post_type: "notice",
        notice_type: "group_admin",
        sub_type: "set",
        group_id: 100,
        user_id: 200,
        operator_id: 300
      })
    ).toBe("[QQ admin] User 200 was made admin in group 100 by operator 300");

    expect(
      formatOneBotGroupNotice({
        post_type: "notice",
        notice_type: "group_ban",
        sub_type: "ban",
        group_id: 100,
        user_id: 200,
        operator_id: 300,
        duration: 3660
      })
    ).toBe("[QQ mute] User 200 was muted in group 100 by operator 300 for 1h 1m");

    expect(
      formatOneBotGroupNotice({
        post_type: "notice",
        notice_type: "group_ban",
        sub_type: "lift_ban",
        group_id: 100,
        user_id: 200
      })
    ).toBe("[QQ mute] User 200 was unmuted in group 100");
  });

  it("formats QQ notify notices", () => {
    expect(
      formatOneBotGroupNotice({
        post_type: "notice",
        notice_type: "notify",
        sub_type: "poke",
        group_id: 100,
        user_id: 200,
        target_id: 300
      })
    ).toBe("[QQ poke] User 200 poked user 300 in group 100");

    expect(
      formatOneBotGroupNotice({
        post_type: "notice",
        notice_type: "notify",
        sub_type: "honor",
        group_id: 100,
        user_id: 200,
        honor_type: "talkative"
      })
    ).toBe("[QQ honor] User 200 received talkative in group 100");
  });

  it("formats QQ member join and leave notices", () => {
    expect(
      formatOneBotGroupMemberNotice({
        post_type: "notice",
        notice_type: "group_increase",
        sub_type: "approve",
        group_id: 100,
        user_id: 200,
        operator_id: 300
      })
    ).toBe("[QQ member] User 200 joined group 100 by operator 300");

    expect(
      formatOneBotGroupMemberNotice({
        post_type: "notice",
        notice_type: "group_increase",
        sub_type: "invite",
        group_id: 100,
        user_id: 200,
        operator_id: 300
      })
    ).toBe("[QQ member] User 200 was invited to group 100 by operator 300");

    expect(
      formatOneBotGroupMemberNotice({
        post_type: "notice",
        notice_type: "group_decrease",
        sub_type: "leave",
        group_id: 100,
        user_id: 200
      })
    ).toBe("[QQ member] User 200 left group 100");

    expect(
      formatOneBotGroupMemberNotice({
        post_type: "notice",
        notice_type: "group_decrease",
        sub_type: "kick",
        group_id: 100,
        user_id: 200,
        operator_id: 300
      })
    ).toBe("[QQ member] User 200 was removed from group 100 by operator 300");
  });

  it("ignores group notices that have dedicated bridge handling", () => {
    const upload: OneBotNoticeEvent = {
      post_type: "notice",
      notice_type: "group_upload",
      group_id: 100,
      user_id: 200
    };
    const memberIncrease: OneBotNoticeEvent = {
      post_type: "notice",
      notice_type: "group_increase",
      group_id: 100,
      user_id: 200
    };

    expect(formatOneBotGroupNotice(upload)).toBeUndefined();
    expect(formatOneBotGroupNotice(memberIncrease)).toBeUndefined();
  });
});

describe("OneBot notice filtering", () => {
  it("blocks notices from configured QQ user ids", () => {
    expect(
      isOneBotNoticeBlocked(
        {
          post_type: "notice",
          notice_type: "group_upload",
          group_id: 100,
          user_id: 200
        },
        new Set(["200"])
      )
    ).toBe(true);

    expect(
      isOneBotNoticeBlocked(
        {
          post_type: "notice",
          notice_type: "group_upload",
          group_id: 100,
          user_id: 201
        },
        new Set(["200"])
      )
    ).toBe(false);

    expect(
      isOneBotNoticeBlocked(
        {
          post_type: "notice",
          notice_type: "group_upload",
          group_id: 100
        },
        new Set(["200"])
      )
    ).toBe(false);
  });

  it("blocks notices involving configured QQ operator or target ids", () => {
    expect(
      isOneBotNoticeBlocked(
        {
          post_type: "notice",
          notice_type: "group_ban",
          group_id: 100,
          user_id: 201,
          operator_id: 200
        },
        new Set(["200"])
      )
    ).toBe(true);

    expect(
      isOneBotNoticeBlocked(
        {
          post_type: "notice",
          notice_type: "notify",
          sub_type: "poke",
          group_id: 100,
          user_id: 201,
          target_id: 200
        },
        new Set(["200"])
      )
    ).toBe(true);
  });
});

describe("OneBot group request formatting", () => {
  it("formats QQ group join and invite requests", () => {
    expect(
      formatOneBotGroupRequest({
        post_type: "request",
        request_type: "group",
        sub_type: "add",
        group_id: 100,
        user_id: 200,
        comment: "please approve",
        flag: "flag-1"
      })
    ).toBe(
      [
        "[QQ group request] User 200 requested to join group 100",
        "Comment: please approve",
        "Flag: flag-1"
      ].join("\n")
    );

    expect(
      formatOneBotGroupRequest({
        post_type: "request",
        request_type: "group",
        sub_type: "invite",
        group_id: 100,
        user_id: 200
      })
    ).toBe("[QQ group request] User 200 invited the bot to group 100");
  });

  it("blocks requests from configured QQ user ids", () => {
    const request: OneBotRequestEvent = {
      post_type: "request",
      request_type: "group",
      group_id: 100,
      user_id: 200
    };

    expect(isOneBotRequestBlocked(request, new Set(["200"]))).toBe(true);
    expect(isOneBotRequestBlocked(request, new Set(["201"]))).toBe(false);
  });
});
