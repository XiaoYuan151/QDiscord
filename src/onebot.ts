import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import WebSocket from "ws";

import type {
  CqSegment,
  OneBotGetMessageData,
  OneBotMessageEvent,
  OneBotNoticeEvent,
  OneBotRequestEvent,
  OneBotSendMessageData
} from "./types.js";

interface OneBotClientOptions {
  wsUrl: string;
  accessToken?: string;
  reconnectInitialMs: number;
  reconnectMaxMs: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  actionTimeoutMs: number;
}

interface PendingAction<T = unknown> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface OneBotActionResponse<T = unknown> {
  status?: string;
  retcode?: number;
  data?: T;
  message?: string;
  wording?: string;
  echo?: string;
}

interface LoginInfo {
  user_id?: number | string;
  nickname?: string;
}

export class OneBotClient extends EventEmitter {
  private readonly pending = new Map<string, PendingAction>();
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private heartbeatTimeoutTimer?: NodeJS.Timeout;
  private readonly connectionWaiters = new Set<(connected: boolean) => void>();
  private shouldReconnect = true;
  private selfQQIdValue?: string;
  private reconnectAttemptsValue = 0;

  constructor(private readonly options: OneBotClientOptions) {
    super();
  }

  get selfQQId(): string | undefined {
    return this.selfQQIdValue;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get connecting(): boolean {
    return this.ws?.readyState === WebSocket.CONNECTING;
  }

  get reconnectAttempts(): number {
    return this.reconnectAttemptsValue;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.openSocket();
  }

  async waitUntilConnected(timeoutMs: number): Promise<boolean> {
    if (this.connected) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (connected: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        this.connectionWaiters.delete(finish);
        resolve(connected);
      };
      const timer = setTimeout(() => finish(this.connected), timeoutMs);
      this.connectionWaiters.add(finish);
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.clearHeartbeatTimers();

    this.ws?.close();
    this.ws = undefined;
    this.rejectAllPending(new Error("OneBot client disconnected"));
    this.notifyConnectionWaiters(false);
  }

  async sendGroupMessage(groupId: string, message: CqSegment[]): Promise<OneBotSendMessageData> {
    return this.sendAction("send_group_msg", {
      group_id: normalizeOneBotId(groupId),
      message,
      auto_escape: false
    });
  }

  async deleteMessage(messageId: string): Promise<unknown> {
    return this.sendAction("delete_msg", {
      message_id: normalizeOneBotId(messageId)
    });
  }

  async uploadGroupFile(groupId: string, file: string, name?: string): Promise<unknown> {
    return this.sendAction("upload_group_file", {
      group_id: normalizeOneBotId(groupId),
      file,
      ...(name ? { name } : {})
    });
  }

  async getMessage(messageId: string): Promise<OneBotGetMessageData> {
    return this.sendAction("get_msg", {
      message_id: normalizeOneBotId(messageId)
    });
  }

  async sendAction<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("NapCat OneBot WebSocket is not connected");
    }

    const echo = randomUUID();
    const timeoutMs = this.options.actionTimeoutMs;
    const payload = JSON.stringify({ action, params, echo });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`OneBot action timed out: ${action}`));
      }, timeoutMs);

      this.pending.set(echo, { resolve: resolve as (value: unknown) => void, reject, timer });
      ws.send(payload, (error) => {
        if (!error) {
          return;
        }

        clearTimeout(timer);
        this.pending.delete(echo);
        reject(error);
      });
    });
  }

  private openSocket(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const endpoint = this.buildEndpoint();
    const ws = new WebSocket(endpoint, {
      headers: this.options.accessToken
        ? { Authorization: `Bearer ${this.options.accessToken}` }
        : undefined
    });
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttemptsValue = 0;
      this.emit("open");
      this.notifyConnectionWaiters(true);
      this.scheduleHeartbeat();
      void this.refreshLoginInfo();
    });

    ws.on("message", (data) => {
      this.handlePacket(data.toString());
    });

    ws.on("close", (code, reason) => {
      this.emit("close", code, reason.toString());
      this.rejectAllPending(new Error(`OneBot WebSocket closed: ${code} ${reason.toString()}`));
      this.clearHeartbeatTimers();
      this.ws = undefined;
      this.scheduleReconnect();
    });

    ws.on("error", (error) => {
      this.emit("error", error);
    });

    ws.on("pong", () => {
      this.clearHeartbeatTimeout();
      this.scheduleHeartbeat();
    });
  }

  private async refreshLoginInfo(): Promise<void> {
    try {
      const info = await this.sendAction<LoginInfo>("get_login_info");
      if (info.user_id !== undefined) {
        this.selfQQIdValue = String(info.user_id);
      }
      this.emit("loginInfo", info);
    } catch (error) {
      this.emit("error", error);
    }
  }

  private handlePacket(rawPacket: string): void {
    let packet: OneBotActionResponse | OneBotMessageEvent | OneBotNoticeEvent | OneBotRequestEvent;
    try {
      packet = JSON.parse(rawPacket) as OneBotActionResponse | OneBotMessageEvent;
    } catch {
      this.emit("error", new Error(`Received invalid OneBot JSON: ${rawPacket}`));
      return;
    }

    if ("echo" in packet && packet.echo && this.pending.has(String(packet.echo))) {
      this.resolvePendingAction(packet as OneBotActionResponse);
      return;
    }

    this.emit("event", packet);
    if ((packet as OneBotMessageEvent).post_type === "message") {
      this.emit("message", packet as OneBotMessageEvent);
    }
    if ((packet as OneBotNoticeEvent).post_type === "notice") {
      this.emit("notice", packet as OneBotNoticeEvent);
    }
    if ((packet as OneBotRequestEvent).post_type === "request") {
      this.emit("request", packet as OneBotRequestEvent);
    }
  }

  private resolvePendingAction(packet: OneBotActionResponse): void {
    const echo = String(packet.echo);
    const pending = this.pending.get(echo);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(echo);

    if (packet.status === "ok" || packet.status === "async" || packet.retcode === 0) {
      pending.resolve(packet.data);
      return;
    }

    pending.reject(
      new Error(
        `OneBot action failed: ${packet.status ?? "unknown"} ${packet.retcode ?? ""} ${
          packet.wording ?? packet.message ?? ""
        }`.trim()
      )
    );
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) {
      return;
    }

    this.reconnectAttemptsValue += 1;
    const delayMs = Math.min(
      this.options.reconnectMaxMs,
      this.options.reconnectInitialMs * 2 ** Math.max(0, this.reconnectAttemptsValue - 1)
    );
    this.emit("reconnectScheduled", {
      attempt: this.reconnectAttemptsValue,
      delayMs
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket();
    }, delayMs);
  }

  private scheduleHeartbeat(): void {
    if (this.options.heartbeatIntervalMs <= 0 || this.options.heartbeatTimeoutMs <= 0) {
      return;
    }

    if (this.heartbeatTimer || this.heartbeatTimeoutTimer) {
      return;
    }

    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = undefined;
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      ws.ping();
      this.heartbeatTimeoutTimer = setTimeout(() => {
        this.heartbeatTimeoutTimer = undefined;
        this.emit("error", new Error("OneBot WebSocket heartbeat timed out"));
        ws.terminate();
      }, this.options.heartbeatTimeoutMs);
    }, this.options.heartbeatIntervalMs);
  }

  private clearHeartbeatTimers(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.clearHeartbeatTimeout();
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = undefined;
    }
  }

  private buildEndpoint(): string {
    const endpoint = new URL(this.options.wsUrl);
    if (this.options.accessToken && !endpoint.searchParams.has("access_token")) {
      endpoint.searchParams.set("access_token", this.options.accessToken);
    }

    return endpoint.toString();
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private notifyConnectionWaiters(connected: boolean): void {
    for (const waiter of this.connectionWaiters) {
      waiter(connected);
    }
  }
}

function normalizeOneBotId(id: string): string | number {
  if (!/^\d+$/.test(id)) {
    return id;
  }

  const asNumber = Number(id);
  return Number.isSafeInteger(asNumber) ? asNumber : id;
}
