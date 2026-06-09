export interface BridgePair {
  discordChannelId: string;
  qqGroupId: string;
  direction: BridgeDirection;
}

export type BridgeDirection = "both" | "discord-to-qq" | "qq-to-discord";

export type DiscordPermissionName =
  | "ViewChannel"
  | "SendMessages"
  | "AttachFiles"
  | "ReadMessageHistory"
  | "EmbedLinks"
  | "UseExternalEmojis"
  | "ManageMessages";

export interface AppConfig {
  discordToken: string;
  discordPermissions: Set<DiscordPermissionName>;
  napcatWsUrl: string;
  napcatAccessToken?: string;
  bridgePairs: BridgePair[];
  discordChannelToQqGroup: Map<string, string>;
  qqGroupToDiscordChannel: Map<string, string>;
  discordChannelToBridgePair: Map<string, BridgePair>;
  qqGroupToBridgePair: Map<string, BridgePair>;
  qqToDiscordUserMap: Map<string, string>;
  discordToQqUserMap: Map<string, string>;
  cqFaceEmojiMap: Map<string, string>;
  discordEmojiToCqFaceMap: Map<string, string>;
  showSenderName: boolean;
  bridgeBotMessages: boolean;
  allowEveryoneMentions: boolean;
  bridgeMemberEvents: boolean;
  bridgeTypingIndicators: boolean;
  uploadQqFiles: boolean;
  resolveQqMediaUrls: boolean;
  statusCommandEnabled: boolean;
  statusCommandName: string;
  statusCommandGuildIds: Set<string>;
  statusCommandAllowedUserIds: Set<string>;
  discordMaxContentLength: number;
  qqMaxTextSegmentLength: number;
  napcatReconnectInitialMs: number;
  napcatReconnectMaxMs: number;
  napcatReconnectJitterMs: number;
  napcatHeartbeatIntervalMs: number;
  napcatHeartbeatTimeoutMs: number;
  oneBotActionTimeoutMs: number;
  queueConcurrency: number;
  queueMaxPending: number;
  queueMinDelayMs: number;
  queueMaxRetries: number;
  queueRetryBaseDelayMs: number;
  queueRetryJitterMs: number;
  shutdownDrainTimeoutMs: number;
  messageLinkTtlMs: number;
  messageLinkMaxEntries: number;
  messageLinkStorePath?: string;
  healthEnabled: boolean;
  healthHost: string;
  healthPort: number;
  healthStatusToken?: string;
  logLevel: LogLevel;
  allowedDiscordGuildIds: Set<string>;
  allowedDiscordChannelIds: Set<string>;
  allowedQqGroupIds: Set<string>;
  blockedDiscordUserIds: Set<string>;
  blockedQqUserIds: Set<string>;
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface CqSegment {
  type: string;
  data: Record<string, string>;
}

export type OneBotMessagePayload =
  | string
  | Array<{
      type: string;
      data?: Record<string, unknown>;
    }>;

export interface OneBotMessageEvent {
  post_type: string;
  message_type: string;
  sub_type?: string;
  group_id?: number | string;
  user_id?: number | string;
  message_id?: number | string;
  message?: OneBotMessagePayload;
  raw_message?: string;
  sender?: {
    user_id?: number | string;
    nickname?: string;
    card?: string;
    role?: string;
    title?: string;
  };
  [key: string]: unknown;
}

export interface OneBotNoticeEvent {
  post_type: "notice";
  notice_type: string;
  sub_type?: string;
  group_id?: number | string;
  user_id?: number | string;
  operator_id?: number | string;
  message_id?: number | string;
  [key: string]: unknown;
}

export interface OneBotRequestEvent {
  post_type: "request";
  request_type: string;
  sub_type?: string;
  group_id?: number | string;
  user_id?: number | string;
  comment?: string;
  flag?: string;
  [key: string]: unknown;
}

export interface OneBotMetaEvent {
  post_type: "meta_event";
  meta_event_type: string;
  sub_type?: string;
  time?: number | string;
  self_id?: number | string;
  interval?: number | string;
  status?: {
    online?: boolean;
    good?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface OneBotSendMessageData {
  message_id?: number | string;
}

export interface OneBotGetMessageData {
  message_id?: number | string;
  user_id?: number | string;
  message?: OneBotMessagePayload;
  raw_message?: string;
  sender?: {
    user_id?: number | string;
    nickname?: string;
    card?: string;
  };
  [key: string]: unknown;
}

export interface BridgeRuntimeStatus {
  startedAt: string;
  uptimeSeconds: number;
  discord: {
    ready: boolean;
    userTag?: string;
    guildCount: number;
    pingMs: number;
  };
  oneBot: {
    connected: boolean;
    connecting: boolean;
    selfQQId?: string;
    reconnectAttempts: number;
    lastHeartbeat?: {
      at: string;
      online?: boolean;
      good?: boolean;
      intervalMs?: number;
    };
    lastLifecycle?: {
      at: string;
      subType?: string;
    };
  };
  queues: Record<
    string,
    {
      pending: number;
      running: number;
      completed: number;
      failed: number;
      dropped: number;
    }
  >;
  bridgePairs: number;
  messageLinks: {
    tracked: number;
    maxEntries: number;
    ttlMs: number;
  };
  routes: Array<{
    discordChannelId: string;
    qqGroupId: string;
    direction: BridgeDirection;
  }>;
}
