export interface BridgePair {
  discordChannelId: string;
  qqGroupId: string;
}

export interface AppConfig {
  discordToken: string;
  napcatWsUrl: string;
  napcatAccessToken?: string;
  bridgePairs: BridgePair[];
  discordChannelToQqGroup: Map<string, string>;
  qqGroupToDiscordChannel: Map<string, string>;
  qqToDiscordUserMap: Map<string, string>;
  discordToQqUserMap: Map<string, string>;
  cqFaceEmojiMap: Map<string, string>;
  discordEmojiToCqFaceMap: Map<string, string>;
  showSenderName: boolean;
  bridgeBotMessages: boolean;
  allowEveryoneMentions: boolean;
  napcatReconnectMs: number;
}

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
