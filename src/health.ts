import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { Logger } from "./logger.js";
import type { BridgeRuntimeStatus } from "./types.js";

export interface HealthServerOptions {
  enabled: boolean;
  host: string;
  port: number;
  statusToken?: string;
  getStatus: () => BridgeRuntimeStatus;
  logger: Logger;
}

export class HealthServer {
  private server?: Server;

  constructor(private readonly options: HealthServerOptions) {}

  async start(): Promise<void> {
    if (!this.options.enabled) {
      return;
    }

    this.server = createServer((request, response) => {
      const status = this.options.getStatus();
      const path = request.url?.split("?")[0] ?? "/";

      if (path === "/healthz") {
        writeJson(response, 200, { ok: true });
        return;
      }

      if (path === "/readyz") {
        const ready = status.discord.ready && status.oneBot.connected;
        writeJson(response, ready ? 200 : 503, {
          ok: ready,
          discord: status.discord.ready,
          oneBot: status.oneBot.connected
        });
        return;
      }

      if (path === "/status") {
        const authorization = this.authorizeStatusRequest(request);
        if (!authorization.ok) {
          writeJson(response, authorization.statusCode, { error: authorization.error });
          return;
        }

        writeJson(response, 200, status);
        return;
      }

      writeJson(response, 404, { error: "not_found" });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.options.port, this.options.host, () => resolve());
    });

    this.options.logger.info("Health server listening", {
      host: this.options.host,
      port: this.options.port
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  address(): AddressInfo | undefined {
    const address = this.server?.address();
    return address && typeof address === "object" ? address : undefined;
  }

  private authorizeStatusRequest(
    request: IncomingMessage
  ): { ok: true } | { ok: false; statusCode: number; error: string } {
    const requiresToken = Boolean(this.options.statusToken) || !isLoopbackHost(this.options.host);
    if (!requiresToken) {
      return { ok: true };
    }

    if (!this.options.statusToken) {
      return { ok: false, statusCode: 403, error: "status_token_required" };
    }

    const requestToken = getStatusToken(request);
    if (!requestToken || !secretMatches(requestToken, this.options.statusToken)) {
      return { ok: false, statusCode: 401, error: "unauthorized" };
    }

    return { ok: true };
  }
}

function isLoopbackHost(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1", "[::1]", "::ffff:127.0.0.1"].includes(
    host.trim().toLowerCase()
  );
}

function getStatusToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  const header = request.headers["x-qdiscord-status-token"];
  if (Array.isArray(header)) {
    return header[0];
  }
  return header;
}

function secretMatches(input: string, expected: string): boolean {
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);
  return inputBuffer.length === expectedBuffer.length && timingSafeEqual(inputBuffer, expectedBuffer);
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}
