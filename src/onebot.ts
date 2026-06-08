import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import WebSocket from "ws";

import type { CqSegment, OneBotMessageEvent } from "./types.js";

interface OneBotClientOptions {
  wsUrl: string;
  accessToken?: string;
  reconnectMs: number;
  actionTimeoutMs?: number;
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
  private shouldReconnect = true;
  private selfQQIdValue?: string;

  constructor(private readonly options: OneBotClientOptions) {
    super();
  }

  get selfQQId(): string | undefined {
    return this.selfQQIdValue;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.openSocket();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.ws?.close();
    this.ws = undefined;
    this.rejectAllPending(new Error("OneBot client disconnected"));
  }

  async sendGroupMessage(groupId: string, message: CqSegment[]): Promise<unknown> {
    return this.sendAction("send_group_msg", {
      group_id: normalizeOneBotId(groupId),
      message,
      auto_escape: false
    });
  }

  async sendAction<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("NapCat OneBot WebSocket is not connected");
    }

    const echo = randomUUID();
    const timeoutMs = this.options.actionTimeoutMs ?? 15_000;
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
      this.emit("open");
      void this.refreshLoginInfo();
    });

    ws.on("message", (data) => {
      this.handlePacket(data.toString());
    });

    ws.on("close", (code, reason) => {
      this.emit("close", code, reason.toString());
      this.rejectAllPending(new Error(`OneBot WebSocket closed: ${code} ${reason.toString()}`));
      this.ws = undefined;
      this.scheduleReconnect();
    });

    ws.on("error", (error) => {
      this.emit("error", error);
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
    let packet: OneBotActionResponse | OneBotMessageEvent;
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

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket();
    }, this.options.reconnectMs);
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
}

function normalizeOneBotId(id: string): string | number {
  if (!/^\d+$/.test(id)) {
    return id;
  }

  const asNumber = Number(id);
  return Number.isSafeInteger(asNumber) ? asNumber : id;
}
