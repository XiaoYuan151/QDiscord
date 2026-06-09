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
      if (packet.action === "get_image") {
        sendActionResponse(socket, packet.echo, { url: "https://example.com/image.png" });
        return;
      }
      if (packet.action === "get_record") {
        sendActionResponse(socket, packet.echo, { url: "https://example.com/voice.mp3" });
        return;
      }
      if (packet.action === "get_file") {
        sendActionResponse(socket, packet.echo, { url: "https://example.com/video.mp4" });
        return;
      }
      if (packet.action === "get_group_file_url") {
        sendActionResponse(socket, packet.echo, { url: "https://example.com/file.zip" });
        return;
      }
      if (packet.action === "get_forward_msg") {
        sendActionResponse(socket, packet.echo, {
          messages: [{ sender: { nickname: "Alice" }, content: "hello" }]
        });
        return;
      }
      sendActionResponse(socket, packet.echo, {});
    });
    const client = createClient(testServer.url);

    client.connect();
    await once(client, "loginInfo");
    await client.deleteMessage("9007199254740995");
    await client.uploadGroupFile("123", "https://example.com/file.zip", "file.zip");
    await client.getMessage("456");
    await expect(client.getImage("image-file-id")).resolves.toEqual({
      url: "https://example.com/image.png"
    });
    await expect(client.getRecord("voice-file-id")).resolves.toEqual({
      url: "https://example.com/voice.mp3"
    });
    await expect(client.getFile("video-file-id")).resolves.toEqual({
      url: "https://example.com/video.mp4"
    });
    await expect(client.getGroupFileUrl("123", "group-file-id", "102")).resolves.toEqual({
      url: "https://example.com/file.zip"
    });
    await expect(client.getForwardMessage("forward-id")).resolves.toEqual({
      messages: [{ sender: { nickname: "Alice" }, content: "hello" }]
    });

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
      },
      {
        action: "get_msg",
        params: { message_id: 456 }
      },
      {
        action: "get_image",
        params: { file: "image-file-id" }
      },
      {
        action: "get_record",
        params: { file: "voice-file-id", out_format: "mp3" }
      },
      {
        action: "get_file",
        params: { file_id: "video-file-id" }
      },
      {
        action: "get_group_file_url",
        params: { group_id: 123, file_id: "group-file-id", busid: 102 }
      },
      {
        action: "get_forward_msg",
        params: { id: "forward-id" }
      }
    ]);
  });

  it("emits message, notice, request, and meta events from OneBot packets", async () => {
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
        socket.send(
          JSON.stringify({
            post_type: "request",
            request_type: "group",
            sub_type: "add",
            group_id: 123,
            user_id: 789,
            comment: "hello"
          })
        );
        socket.send(
          JSON.stringify({
            post_type: "meta_event",
            meta_event_type: "lifecycle",
            sub_type: "connect",
            self_id: 1,
            time: 1_800_000_000
          })
        );
        socket.send(
          JSON.stringify({
            post_type: "meta_event",
            meta_event_type: "heartbeat",
            status: { online: true, good: true },
            interval: 5000,
            time: 1_800_000_001
          })
        );
      }
    });
    const client = createClient(testServer.url);
    const messageEvent = once(client, "message");
    const noticeEvent = once(client, "notice");
    const requestEvent = once(client, "request");
    const metaEvents: unknown[] = [];
    const metaEventsReceived = new Promise<void>((resolve) => {
      client.on("meta", (event) => {
        metaEvents.push(event);
        if (metaEvents.length === 2) {
          resolve();
        }
      });
    });

    client.connect();
    const [message] = await messageEvent;
    const [notice] = await noticeEvent;
    const [request] = await requestEvent;
    await metaEventsReceived;

    expect(message).toMatchObject({ post_type: "message", message_id: 456 });
    expect(notice).toMatchObject({ post_type: "notice", notice_type: "group_recall" });
    expect(request).toMatchObject({ post_type: "request", request_type: "group" });
    expect(metaEvents).toMatchObject([
      { post_type: "meta_event", meta_event_type: "lifecycle", sub_type: "connect" },
      { post_type: "meta_event", meta_event_type: "heartbeat" }
    ]);
    expect(client.lastLifecycle).toEqual({
      at: new Date("2027-01-15T08:00:00.000Z"),
      subType: "connect"
    });
    expect(client.lastHeartbeat).toEqual({
      at: new Date("2027-01-15T08:00:01.000Z"),
      online: true,
      good: true,
      intervalMs: 5000
    });
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

  it("adds bounded reconnect jitter", async () => {
    const testServer = await createOneBotServer((socket, packet) => {
      if (packet.action === "get_login_info") {
        sendActionResponse(socket, packet.echo, { user_id: 1 });
      }
    });
    testServer.server.on("connection", (socket) => socket.close());
    const client = createClient(testServer.url, {
      reconnectInitialMs: 10,
      reconnectMaxMs: 15,
      reconnectJitterMs: 10,
      random: () => 0.75
    });

    client.connect();
    const [schedule] = (await once(client, "reconnectScheduled")) as [
      { attempt: number; delayMs: number }
    ];

    expect(schedule).toEqual({ attempt: 1, delayMs: 15 });
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

  it("waits until the WebSocket is connected", async () => {
    const testServer = await createOneBotServer((socket, packet) => {
      if (packet.action === "get_login_info") {
        sendActionResponse(socket, packet.echo, { user_id: 1 });
      }
    });
    const client = createClient(testServer.url);
    const connected = client.waitUntilConnected(1000);

    client.connect();

    await expect(connected).resolves.toBe(true);
  });

  it("reports false when waiting for connection times out", async () => {
    const client = createClient("ws://127.0.0.1:1");

    await expect(client.waitUntilConnected(1)).resolves.toBe(false);
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
    reconnectJitterMs: 0,
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
