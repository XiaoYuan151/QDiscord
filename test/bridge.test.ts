import { describe, expect, it } from "vitest";

import { isStatusCommandAuthorized } from "../src/bridge.js";

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
