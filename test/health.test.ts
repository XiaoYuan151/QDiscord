import { describe, expect, it } from "vitest";

import { HealthServer } from "../src/health.js";
import { createLogger } from "../src/logger.js";
import type { BridgeRuntimeStatus } from "../src/types.js";

function status(overrides: Partial<BridgeRuntimeStatus> = {}): BridgeRuntimeStatus {
  return {
    startedAt: "2026-06-08T00:00:00.000Z",
    uptimeSeconds: 1,
    discord: {
      ready: false,
      userTag: "bot#0000",
      guildCount: 1,
      pingMs: 42
    },
    oneBot: {
      connected: false,
      connecting: false,
      selfQQId: "123",
      reconnectAttempts: 0
    },
    queues: {
      "discord-to-qq": { pending: 0, running: 0, completed: 0, failed: 0, dropped: 0 },
      "qq-to-discord": { pending: 0, running: 0, completed: 0, failed: 0, dropped: 0 }
    },
    bridgePairs: 1,
    messageLinks: {
      tracked: 0,
      maxEntries: 10000,
      ttlMs: 86400000
    },
    routes: [{ discordChannelId: "111", qqGroupId: "222", direction: "both" }],
    ...overrides
  };
}

describe("HealthServer", () => {
  it("serves liveness, readiness, and status JSON", async () => {
    const server = new HealthServer({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      getStatus: () => status(),
      logger: createLogger("silent")
    });

    await server.start();
    try {
      const address = server.address();
      expect(address).toBeDefined();
      const baseUrl = `http://127.0.0.1:${address?.port}`;

      await expect(fetchJson(`${baseUrl}/healthz`)).resolves.toEqual({
        status: 200,
        body: { ok: true }
      });
      await expect(fetchJson(`${baseUrl}/readyz`)).resolves.toMatchObject({
        status: 503,
        body: { ok: false, discord: false, oneBot: false }
      });
      await expect(fetchJson(`${baseUrl}/status`)).resolves.toMatchObject({
        status: 200,
        body: {
          bridgePairs: 1,
          routes: [{ discordChannelId: "111", qqGroupId: "222", direction: "both" }]
        }
      });
    } finally {
      await server.stop();
    }
  });

  it("blocks detailed status on non-loopback hosts without a token", async () => {
    const server = new HealthServer({
      enabled: true,
      host: "0.0.0.0",
      port: 0,
      getStatus: () => status(),
      logger: createLogger("silent")
    });

    await server.start();
    try {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address?.port}`;

      await expect(fetchJson(`${baseUrl}/readyz`)).resolves.toEqual({
        status: 503,
        body: { ok: false, discord: false, oneBot: false }
      });
      await expect(fetchJson(`${baseUrl}/status`)).resolves.toEqual({
        status: 403,
        body: { error: "status_token_required" }
      });
    } finally {
      await server.stop();
    }
  });

  it("requires the configured status token for detailed status", async () => {
    const server = new HealthServer({
      enabled: true,
      host: "0.0.0.0",
      port: 0,
      statusToken: "status-secret",
      getStatus: () => status(),
      logger: createLogger("silent")
    });

    await server.start();
    try {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address?.port}`;

      await expect(fetchJson(`${baseUrl}/status`)).resolves.toEqual({
        status: 401,
        body: { error: "unauthorized" }
      });
      await expect(
        fetchJson(`${baseUrl}/status`, {
          headers: { authorization: "Bearer status-secret" }
        })
      ).resolves.toMatchObject({
        status: 200,
        body: { routes: [{ discordChannelId: "111", qqGroupId: "222", direction: "both" }] }
      });
    } finally {
      await server.stop();
    }
  });
});

async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, init);
  return {
    status: response.status,
    body: await response.json()
  };
}
