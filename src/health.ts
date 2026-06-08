import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { Logger } from "./logger.js";
import type { BridgeRuntimeStatus } from "./types.js";

export interface HealthServerOptions {
  enabled: boolean;
  host: string;
  port: number;
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
        writeJson(response, ready ? 200 : 503, { ok: ready, status });
        return;
      }

      if (path === "/status") {
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
