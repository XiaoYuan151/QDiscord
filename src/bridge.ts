import {
  Client,
  Events,
  GatewayIntentBits,
  type MessageCreateOptions,
  type Message,
  type Snowflake
} from "discord.js";

import { appendTextSegment, normalizeOneBotMessage } from "./cq.js";
import {
  appendDiscordAttachmentsToQqSegments,
  discordTextToQqSegments,
  escapeDiscordMarkdown,
  qqSegmentsToDiscord,
  truncateDiscordContent
} from "./converters.js";
import { OneBotClient } from "./onebot.js";
import type { AppConfig, CqSegment, OneBotMessageEvent } from "./types.js";

type SendableTextChannel = {
  send(options: MessageCreateOptions): Promise<unknown>;
};

export class QDiscordBridge {
  private readonly discord: Client;
  private readonly oneBot: OneBotClient;

  constructor(private readonly config: AppConfig) {
    this.discord = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
      ]
    });

    this.oneBot = new OneBotClient({
      wsUrl: config.napcatWsUrl,
      accessToken: config.napcatAccessToken,
      reconnectMs: config.napcatReconnectMs
    });
  }

  async start(): Promise<void> {
    this.registerDiscordHandlers();
    this.registerOneBotHandlers();

    this.oneBot.connect();
    await this.discord.login(this.config.discordToken);
  }

  stop(): void {
    this.oneBot.disconnect();
    this.discord.destroy();
  }

  private registerDiscordHandlers(): void {
    this.discord.once(Events.ClientReady, (client) => {
      console.log(`Discord bot logged in as ${client.user.tag}`);
      console.log(`Loaded ${this.config.bridgePairs.length} bridge pair(s)`);
    });

    this.discord.on(Events.MessageCreate, (message) => {
      void this.handleDiscordMessage(message).catch((error) => {
        console.error("Failed to bridge Discord message to QQ", error);
      });
    });
  }

  private registerOneBotHandlers(): void {
    this.oneBot.on("open", () => {
      console.log("Connected to NapCat OneBot WebSocket");
    });

    this.oneBot.on("close", (code, reason) => {
      console.warn(`NapCat OneBot WebSocket closed: ${code} ${reason}`);
    });

    this.oneBot.on("loginInfo", (info) => {
      console.log(`NapCat login: ${info.nickname ?? "unknown"} (${info.user_id ?? "unknown"})`);
    });

    this.oneBot.on("message", (event) => {
      void this.handleOneBotMessage(event as OneBotMessageEvent).catch((error) => {
        console.error("Failed to bridge QQ message to Discord", error);
      });
    });

    this.oneBot.on("error", (error) => {
      console.error("NapCat OneBot error", error);
    });
  }

  private async handleDiscordMessage(message: Message): Promise<void> {
    const qqGroupId = this.config.discordChannelToQqGroup.get(message.channelId);
    if (!qqGroupId) {
      return;
    }

    if (message.author.id === this.discord.user?.id) {
      return;
    }

    if (!this.config.bridgeBotMessages && message.author.bot) {
      return;
    }

    const segments = this.discordMessageToQqSegments(message);
    if (segments.length === 0) {
      return;
    }

    await this.oneBot.sendGroupMessage(qqGroupId, segments);
  }

  private async handleOneBotMessage(event: OneBotMessageEvent): Promise<void> {
    if (event.message_type !== "group" || event.group_id === undefined) {
      return;
    }

    if (this.oneBot.selfQQId && String(event.user_id) === this.oneBot.selfQQId) {
      return;
    }

    const discordChannelId = this.config.qqGroupToDiscordChannel.get(String(event.group_id));
    if (!discordChannelId) {
      return;
    }

    const channel = await this.fetchDiscordTextChannel(discordChannelId);
    if (!channel) {
      console.warn(`Discord channel is not text-sendable: ${discordChannelId}`);
      return;
    }

    const qqSegments = normalizeOneBotMessage(event.message ?? event.raw_message);
    const converted = qqSegmentsToDiscord(qqSegments, {
      qqToDiscordUserMap: this.config.qqToDiscordUserMap,
      cqFaceEmojiMap: this.config.cqFaceEmojiMap
    });

    if (!converted.content && converted.files.length === 0) {
      return;
    }

    const senderName = getQqSenderName(event);
    const prefix = this.config.showSenderName ? `**${escapeDiscordMarkdown(senderName)}**: ` : "";
    const content = truncateDiscordContent(`${prefix}${converted.content}`.trim());

    await this.sendDiscordMessage(channel, content, converted.files, {
      users: converted.mentionUserIds,
      roles: [],
      parse:
        converted.mentionEveryone && this.config.allowEveryoneMentions ? ["everyone"] : []
    });
  }

  private discordMessageToQqSegments(message: Message): CqSegment[] {
    const segments: CqSegment[] = [];

    if (this.config.showSenderName) {
      appendTextSegment(segments, `[Discord] ${getDiscordSenderName(message)}: `);
    }

    const contentSegments = discordTextToQqSegments(message.content, {
      discordToQqUserMap: this.config.discordToQqUserMap,
      discordEmojiToCqFaceMap: this.config.discordEmojiToCqFaceMap,
      resolveUserName: (userId) =>
        message.mentions.members?.get(userId)?.displayName ??
        message.mentions.users.get(userId)?.username,
      resolveChannelName: (channelId) => {
        const channel = message.mentions.channels.get(channelId as Snowflake);
        return channel && "name" in channel && typeof channel.name === "string"
          ? channel.name
          : undefined;
      },
      resolveRoleName: (roleId) => message.mentions.roles.get(roleId as Snowflake)?.name
    });

    segments.push(...contentSegments);
    appendDiscordAttachmentsToQqSegments(segments, message.attachments.values());

    for (const sticker of message.stickers.values()) {
      if (sticker.url) {
        segments.push({ type: "image", data: { file: sticker.url } });
      }
    }

    return segments;
  }

  private async fetchDiscordTextChannel(channelId: string): Promise<SendableTextChannel | undefined> {
    const channel = await this.discord.channels.fetch(channelId as Snowflake);
    if (!channel?.isTextBased() || !("send" in channel) || typeof channel.send !== "function") {
      return undefined;
    }

    return channel;
  }

  private async sendDiscordMessage(
    channel: SendableTextChannel,
    content: string,
    files: string[],
    allowedMentions: { users: string[]; roles: string[]; parse: Array<"everyone"> }
  ): Promise<void> {
    if (files.length === 0) {
      await channel.send({ content, allowedMentions });
      return;
    }

    const batches = chunk(files, 10);
    for (const [index, batch] of batches.entries()) {
      await channel.send({
        content: index === 0 && content ? content : undefined,
        files: batch,
        allowedMentions
      });
    }
  }
}

function getDiscordSenderName(message: Message): string {
  return message.member?.displayName ?? message.author.globalName ?? message.author.username;
}

function getQqSenderName(event: OneBotMessageEvent): string {
  const card = event.sender?.card?.trim();
  const nickname = event.sender?.nickname?.trim();
  return card || nickname || `QQ ${event.user_id ?? "unknown"}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
