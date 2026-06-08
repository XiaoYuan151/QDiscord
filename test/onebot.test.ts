import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { IncomingMessage } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { OneBotClient } from "../src/onebot.js";

interface TestServer {
  server: WebSocketServer;
  url: string;
  requests: IncomingMessage[];
  received: Array<Record<string, unknown>>;
  close(): Promise<void>;
}

const servers: TestServer[] = [];
const clients: OneBotClient[] = [];

describe("OneBotClient", () => {
  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
    for (const server of servers.splice(0)) {
      await server.close();
    }
  });

  it("connects with access token, refreshes login info, and sends group messages", async () => {
    const testServer = await createOneBotServer((socket, packet) => {
      if (packet.action === "get_login_info") {
        sendActionResponse(socket, packet.echo, { user_id: 12345, nickname: "bot" });
      }
      if (packet.action === "send_group_msg") {
        sendActionResponse(socket, packet.echo, { message_id: 99 });
      }
    });
    const client = createClient(`${testServer.url}?existing=1`, {
      accessToken: "secret"
    });

    client.connect();
    const [loginInfo] = (await once(client, "loginInfo")) as [{ user_id: number; nickname: string }];
    const result = await client.sendGroupMessage("123456", [
      { type: "text", data: { text: "hello" } }
    ]);

    expect(loginInfo).toEqual({ user_id: 12345, nickname: "bot" });
    expect(client.selfQQId).toBe("12345");
    expect(result).toEqual({ message_id: 99 });
    expect(testServer.requests[0]?.headers.authorization).toBe("Bearer secret");
    expect(testServer.requests[0]?.url).toContain("existing=1");
    expect(testServer.requests[0]?.url).toContain("access_token=secret");
    expect(testServer.received).toMatchObject([
      { action: "get_login_info" },
      {
        action: "send_group_msg",
        params: {
          group_id: 123456,
          message: [{ type: "text", data: { text: "hello" } }],
          auto_escape: false
        }
      }
    ]);
  });

  it("sends delete and upload actions", async () => {
    const testServer = await createOneBotServer((socket, packet) => {
      sendActionResponse(socket, packet.echo, {});
    });
    const client = createClient(testServer.url);

    client.connect();
    await once(client, "loginInfo");
    await client.deleteMessage("9007199254740995");
    await client.uploadGroupFile("123", "https://example.com/file.zip", "file.zip");

    expect(testServer.received).toMatchObject([
      { action: "get_login_info" },
      { action: "delete_msg", params: { message_id: "9007199254740995" } },
      {
        action: "upload_group_file",
        params: {
          group_id: 123,
          file: "https://example.com/file.zip",
          name: "file.zip"
        }
      }
    ]);
  });

  it("emits message and notice events from OneBot packets", async () => {
    const testServer = await createOneBotServer((socket, packet) => {
      if (packet.action === "get_login_info") {
        sendActionResponse(socket, packet.echo, { user_id: 1 });
        socket.send(
          JSON.stringify({
            post_type: "message",
            message_type: "group",
            group_id: 123,
            message_id: 456,
            message: "hi"
          })
        );
        socket.send(
          JSON.stringify({
            post_type: "notice",
            notice_type: "group_recall",
            group_id: 123,
            message_id: 456
          })
        );
      }
    });
    const client = createClient(testServer.url);
    const messageEvent = once(client, "message");
    const noticeEvent = once(client, "notice");

    client.connect();
    const [message] = await messageEvent;
    const [notice] = await noticeEvent;

    expect(message).toMatchObject({ post_type: "message", message_id: 456 });
    expect(notice).toMatchObject({ post_type: "notice", notice_type: "group_recall" });
  });

  it("schedules bounded reconnects after close", async () => {
    let connections = 0;
    let resolveSecondConnection: (() => void) | undefined;
    const secondConnection = new Promise<void>((resolve) => {
      resolveSecondConnection = resolve;
    });
    const testServer = await createOneBotServer((socket, packet) => {
      if (packet.action === "get_login_info") {
        sendActionResponse(socket, packet.echo, { user_id: 1 });
      }
    });
    testServer.server.on("connection", (socket) => {
      connections += 1;
      if (connections === 1) {
        socket.close();
      } else {
        resolveSecondConnection?.();
      }
    });
    const client = createClient(testServer.url, {
      reconnectInitialMs: 5,
      reconnectMaxMs: 20
    });

    client.connect();
    const [schedule] = (await once(client, "reconnectScheduled")) as [
      { attempt: number; delayMs: number }
    ];
    await secondConnection;

    expect(schedule).toEqual({ attempt: 1, delayMs: 5 });
    expect(connections).toBeGreaterThanOrEqual(2);
  });

  it("sends heartbeat pings", async () => {
    let resolvePing: (() => void) | undefined;
    const ping = new Promise<void>((resolve) => {
      resolvePing = resolve;
    });
    const testServer = await createOneBotServer((socket, packet) => {
      if (packet.action === "get_login_info") {
        sendActionResponse(socket, packet.echo, { user_id: 1 });
      }
    });
    testServer.server.on("connection", (socket) => {
      socket.once("ping", () => resolvePing?.());
    });
    const client = createClient(testServer.url, {
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 1000
    });

    client.connect();
    await ping;

    expect(client.connected).toBe(true);
  });
});

async function createOneBotServer(
  onPacket: (socket: WebSocket, packet: Record<string, unknown>) => void
): Promise<TestServer> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const requests: IncomingMessage[] = [];
  const received: Array<Record<string, unknown>> = [];

  server.on("connection", (socket, request) => {
    requests.push(request);
    socket.on("message", (data) => {
      const packet = JSON.parse(data.toString()) as Record<string, unknown>;
      received.push(packet);
      onPacket(socket, packet);
    });
  });

  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const testServer = {
    server,
    url: `ws://127.0.0.1:${address.port}`,
    requests,
    received,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
  servers.push(testServer);
  return testServer;
}

function createClient(
  wsUrl: string,
  overrides: Partial<ConstructorParameters<typeof OneBotClient>[0]> = {}
): OneBotClient {
  const client = new OneBotClient({
    wsUrl,
    reconnectInitialMs: 100,
    reconnectMaxMs: 1000,
    heartbeatIntervalMs: 0,
    heartbeatTimeoutMs: 0,
    actionTimeoutMs: 1000,
    ...overrides
  });
  client.on("error", () => undefined);
  clients.push(client);
  return client;
}

function sendActionResponse(socket: WebSocket, echo: unknown, data: unknown): void {
  socket.send(
    JSON.stringify({
      status: "ok",
      retcode: 0,
      echo,
      data
    })
  );
}
