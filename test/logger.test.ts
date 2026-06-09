import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts secret-looking context keys", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const logger = createLogger("debug");

    logger.info("test", {
      discordToken: "secret",
      nested: { access_token: "napcat-secret" },
      visible: "value"
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;

    expect(payload.discordToken).toBe("[redacted]");
    expect(payload.nested).toEqual({ access_token: "[redacted]" });
    expect(payload.visible).toBe("value");
  });

  it("redacts token-like substrings in messages and errors", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger("debug");

    logger.error("failed bearer abc123", {
      url: "ws://127.0.0.1:3001/?access_token=napcat-token&token=other-token&x=1",
      error: new Error("Authorization: Bearer discord-token\nCookie: session=secret")
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0])) as {
      message: string;
      url: string;
      error: { message: string };
    };

    expect(payload.message).toBe("failed bearer [redacted]");
    expect(payload.url).toBe(
      "ws://127.0.0.1:3001/?access_token=[redacted]&token=[redacted]&x=1"
    );
    expect(payload.error.message).toBe("Authorization: Bearer [redacted]\nCookie: [redacted]");
  });

  it("does not redact ordinary bot log messages", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const logger = createLogger("debug");

    logger.info("Discord bot logged in", { userTag: "qdiscord#0000" });

    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload.message).toBe("Discord bot logged in");
    expect(payload.userTag).toBe("qdiscord#0000");
  });
});
