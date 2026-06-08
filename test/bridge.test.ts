import { describe, expect, it } from "vitest";

import { isStatusCommandAuthorized, resolveDiscordBridgeRoute } from "../src/bridge.js";
import type { BridgePair } from "../src/types.js";

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
