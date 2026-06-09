import { describe, expect, it } from "vitest";

import {
  formatOneBotGroupNotice,
  formatOneBotGroupRequest,
  isOneBotNoticeBlocked,
  isOneBotRequestBlocked,
  isStatusCommandAuthorized,
  normalizeMessageLink,
  resolveDiscordBridgeRoute
} from "../src/bridge.js";
import type { BridgePair, OneBotNoticeEvent, OneBotRequestEvent } from "../src/types.js";

describe("bridge command authorization", () => {
  it("allows status command users by allow-list or Manage Server permission", () => {
    expect(
      isStatusCommandAuthorized({
        userId: "111",
        allowedUserIds: new Set(["111"]),
        hasManageGuild: false
      })
    ).toBe(true);

    expect(
      isStatusCommandAuthorized({
        userId: "222",
        allowedUserIds: new Set(),
        hasManageGuild: true
      })
    ).toBe(true);

    expect(
      isStatusCommandAuthorized({
        userId: "333",
        allowedUserIds: new Set(["111"]),
        hasManageGuild: false
      })
    ).toBe(false);
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

describe("OneBot group notice formatting", () => {
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

  it("ignores group notices that have dedicated bridge handling", () => {
    const upload: OneBotNoticeEvent = {
      post_type: "notice",
      notice_type: "group_upload",
      group_id: 100,
      user_id: 200
    };

    expect(formatOneBotGroupNotice(upload)).toBeUndefined();
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
