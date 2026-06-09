import {
  ApplicationCommandOptionType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  type ApplicationCommand,
  type ApplicationCommandDataResolvable,
  type ChatInputCommandInteraction,
  type Collection,
  type GuildMember,
  type Message,
  type MessageCreateOptions,
  type MessageReaction,
  type MessageSnapshot,
  type PartialPollAnswer,
  type PartialGuildMember,
  type PartialMessageReaction,
  type PartialMessage,
  type PollAnswer,
  type PartialUser,
  type Snowflake,
  type User
} from "discord.js";

import { normalizeOneBotMessage } from "./cq.js";
import {
  chunkQqSegments,
  discordMessageToQqSegments,
  discordPollVoteToQqSegments,
  discordReactionClearToQqSegments,
  discordReactionToQqSegments,
  escapeDiscordMarkdown,
  type DiscordForwardedMessageLike,
  type DiscordPollLike,
  formatDiscordReplyFallback,
  formatQqReplyFallback,
  qqReactionToDiscordContent,
  qqSegmentsToDiscord,
  splitDiscordContent
} from "./converters.js";
import { MessageLinkStore } from "./linkstore.js";
import { createLogger, type Logger } from "./logger.js";
import { OneBotClient } from "./onebot.js";
import { AsyncTaskQueue } from "./queue.js";
import type {
  AppConfig,
  BridgeRuntimeStatus,
  BridgePair,
  CqSegment,
  OneBotMetaEvent,
  OneBotMessageEvent,
  OneBotNoticeEvent,
  OneBotRequestEvent,
  OneBotSendMessageData
} from "./types.js";

type SendableTextChannel = {
  id: string;
  send(options: MessageCreateOptions): Promise<Message>;
  sendTyping?: () => Promise<void>;
};

type StatusCommandData = ApplicationCommandDataResolvable & { name: string };

type CommandManagerLike = {
  fetch(): Promise<Collection<Snowflake, ApplicationCommand>>;
  create(data: StatusCommandData): Promise<unknown>;
  edit(commandId: Snowflake, data: StatusCommandData): Promise<unknown>;
};

export interface MessageLink {
  discordMessageId: string;
  discordMessageIds?: string[];
  discordChannelId: string;
  qqGroupId: string;
  qqMessageId: string;
  qqMessageIds?: string[];
  createdAt: number;
}

interface ForwardOptions {
  edited?: boolean;
}

export interface DiscordBridgeRoute {
  pair: BridgePair;
  routeChannelId: string;
  threadName?: string;
}

export class QDiscordBridge {
  private readonly discord: Client;
  private readonly oneBot: OneBotClient;
  private readonly discordToQqQueue: AsyncTaskQueue;
  private readonly qqToDiscordQueue: AsyncTaskQueue;
  private readonly discordLinks = new Map<string, MessageLink>();
  private readonly qqLinks = new Map<string, MessageLink>();
  private readonly startedAt = new Date();
  private readonly linkStore?: MessageLinkStore;
  private stopping = false;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger = createLogger(config.logLevel)
  ) {
    this.discord = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
      ],
      partials: [
        Partials.Channel,
        Partials.GuildMember,
        Partials.Message,
        Partials.Poll,
        Partials.PollAnswer,
        Partials.Reaction,
        Partials.User
      ]
    });

    this.oneBot = new OneBotClient({
      wsUrl: config.napcatWsUrl,
      accessToken: config.napcatAccessToken,
      reconnectInitialMs: config.napcatReconnectInitialMs,
      reconnectMaxMs: config.napcatReconnectMaxMs,
      heartbeatIntervalMs: config.napcatHeartbeatIntervalMs,
      heartbeatTimeoutMs: config.napcatHeartbeatTimeoutMs,
      actionTimeoutMs: config.oneBotActionTimeoutMs
    });

    this.discordToQqQueue = new AsyncTaskQueue({
      name: "discord-to-qq",
      concurrency: config.queueConcurrency,
      maxPending: config.queueMaxPending,
      minDelayMs: config.queueMinDelayMs,
      maxRetries: config.queueMaxRetries,
      retryBaseDelayMs: config.queueRetryBaseDelayMs
    });
    this.qqToDiscordQueue = new AsyncTaskQueue({
      name: "qq-to-discord",
      concurrency: config.queueConcurrency,
      maxPending: config.queueMaxPending,
      minDelayMs: config.queueMinDelayMs,
      maxRetries: config.queueMaxRetries,
      retryBaseDelayMs: config.queueRetryBaseDelayMs
    });

    if (config.messageLinkStorePath) {
      this.linkStore = new MessageLinkStore(config.messageLinkStorePath);
      this.loadStoredMessageLinks();
    }
  }

  async start(): Promise<void> {
    this.registerDiscordHandlers();
    this.registerOneBotHandlers();

    this.oneBot.connect();
    await this.discord.login(this.config.discordToken);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const [discordToQqDrained, qqToDiscordDrained] = await Promise.all([
      this.discordToQqQueue.waitForIdle(this.config.shutdownDrainTimeoutMs),
      this.qqToDiscordQueue.waitForIdle(this.config.shutdownDrainTimeoutMs)
    ]);
    if (!discordToQqDrained || !qqToDiscordDrained) {
      this.logger.warn("Bridge queues did not drain before shutdown timeout", {
        discordToQq: this.discordToQqQueue.stats(),
        qqToDiscord: this.qqToDiscordQueue.stats()
      });
    }

    this.oneBot.disconnect();
    this.discord.destroy();
  }

  getStatus(): BridgeRuntimeStatus {
    const now = Date.now();
    return {
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.floor((now - this.startedAt.getTime()) / 1000),
      discord: {
        ready: this.discord.isReady(),
        userTag: this.discord.user?.tag,
        guildCount: this.discord.guilds.cache.size,
        pingMs: this.discord.ws.ping
      },
      oneBot: {
        connected: this.oneBot.connected,
        connecting: this.oneBot.connecting,
        selfQQId: this.oneBot.selfQQId,
        reconnectAttempts: this.oneBot.reconnectAttempts,
        lastHeartbeat: this.oneBot.lastHeartbeat
          ? {
              at: this.oneBot.lastHeartbeat.at.toISOString(),
              online: this.oneBot.lastHeartbeat.online,
              good: this.oneBot.lastHeartbeat.good,
              intervalMs: this.oneBot.lastHeartbeat.intervalMs
            }
          : undefined,
        lastLifecycle: this.oneBot.lastLifecycle
          ? {
              at: this.oneBot.lastLifecycle.at.toISOString(),
              subType: this.oneBot.lastLifecycle.subType
            }
          : undefined
      },
      queues: {
        [this.discordToQqQueue.name]: this.discordToQqQueue.stats(),
        [this.qqToDiscordQueue.name]: this.qqToDiscordQueue.stats()
      },
      bridgePairs: this.config.bridgePairs.length,
      messageLinks: {
        tracked: this.uniqueMessageLinks().length,
        maxEntries: this.config.messageLinkMaxEntries,
        ttlMs: this.config.messageLinkTtlMs
      },
      routes: this.config.bridgePairs.map((pair) => ({
        discordChannelId: pair.discordChannelId,
        qqGroupId: pair.qqGroupId,
        direction: pair.direction
      }))
    };
  }

  private registerDiscordHandlers(): void {
    this.discord.once(Events.ClientReady, (client) => {
      this.logger.info("Discord bot logged in", {
        userTag: client.user.tag,
        bridgePairs: this.config.bridgePairs.length
      });
      if (this.config.statusCommandEnabled) {
        void this.registerStatusCommand().catch((error) => {
          this.logger.error("Failed to register Discord status command", { error });
        });
      }
      void this.validateBridgeRoutes().catch((error) => {
        this.logger.error("Failed to validate bridge routes", { error });
      });
    });

    this.discord.on(Events.MessageCreate, (message) => {
      this.enqueueDiscordToQq(`message:${message.id}`, () => this.handleDiscordMessage(message));
    });

    this.discord.on(Events.MessageUpdate, (_oldMessage, newMessage) => {
      this.enqueueDiscordToQq(`message-update:${newMessage.id}`, async () => {
        const message = await this.resolveFullMessage(newMessage);
        if (message) {
          await this.handleDiscordMessageUpdate(message);
        }
      });
    });

    this.discord.on(Events.MessageDelete, (message) => {
      this.enqueueDiscordToQq(`message-delete:${message.id}`, () =>
        this.handleDiscordMessageDelete(message)
      );
    });

    this.discord.on(Events.MessageBulkDelete, (messages) => {
      const messageIds = [...messages.keys()];
      this.enqueueDiscordToQq(
        `message-bulk-delete:${messageIds.length}:${messageIds[0] ?? "unknown"}`,
        () => this.handleDiscordMessageBulkDelete(messages.values())
      );
    });

    this.discord.on(Events.MessageReactionAdd, (reaction, user) => {
      this.enqueueDiscordToQq(`reaction-add:${reaction.message.id}:${user.id}`, () =>
        this.handleDiscordReaction(reaction, user, "added")
      );
    });

    this.discord.on(Events.MessageReactionRemove, (reaction, user) => {
      this.enqueueDiscordToQq(`reaction-remove:${reaction.message.id}:${user.id}`, () =>
        this.handleDiscordReaction(reaction, user, "removed")
      );
    });

    this.discord.on(Events.MessageReactionRemoveAll, (message, reactions) => {
      this.enqueueDiscordToQq(`reaction-clear-all:${message.id}`, () =>
        this.handleDiscordReactionClear(message, reactions.size)
      );
    });

    this.discord.on(Events.MessageReactionRemoveEmoji, (reaction) => {
      const emojiId = reaction.emoji.id ?? reaction.emoji.name ?? "emoji";
      this.enqueueDiscordToQq(`reaction-clear-emoji:${reaction.message.id}:${emojiId}`, () =>
        this.handleDiscordReactionEmojiClear(reaction)
      );
    });

    this.discord.on(Events.MessagePollVoteAdd, (pollAnswer, userId) => {
      this.enqueueDiscordToQq(
        `poll-vote-add:${pollAnswer.poll.message.id}:${pollAnswer.id}:${userId}`,
        () => this.handleDiscordPollVote(pollAnswer, userId, "added")
      );
    });

    this.discord.on(Events.MessagePollVoteRemove, (pollAnswer, userId) => {
      this.enqueueDiscordToQq(
        `poll-vote-remove:${pollAnswer.poll.message.id}:${pollAnswer.id}:${userId}`,
        () => this.handleDiscordPollVote(pollAnswer, userId, "removed")
      );
    });

    this.discord.on(Events.InteractionCreate, (interaction) => {
      if (!interaction.isChatInputCommand()) {
        return;
      }

      void this.handleChatInputCommand(interaction).catch((error) => {
        this.logger.error("Failed to handle Discord interaction", { error });
      });
    });

    this.discord.on(Events.GuildMemberAdd, (member) => {
      this.enqueueDiscordToQq(`guild-member-add:${member.id}`, () =>
        this.handleDiscordMemberEvent(member, "joined")
      );
    });

    this.discord.on(Events.GuildMemberRemove, (member) => {
      this.enqueueDiscordToQq(`guild-member-remove:${member.id}`, () =>
        this.handleDiscordMemberEvent(member, "left")
      );
    });

    this.discord.on(Events.Error, (error) => {
      this.logger.error("Discord client error", { error });
    });

    this.discord.on(Events.ShardReady, (id) => {
      this.logger.info("Discord shard ready", { shardId: id });
    });

    this.discord.on(Events.ShardDisconnect, (event, id) => {
      this.logger.warn("Discord shard disconnected", {
        shardId: id,
        code: event.code,
        reason: event.reason
      });
    });
  }

  private registerOneBotHandlers(): void {
    this.oneBot.on("open", () => {
      this.logger.info("Connected to NapCat OneBot WebSocket");
    });

    this.oneBot.on("close", (code, reason) => {
      this.logger.warn("NapCat OneBot WebSocket closed", { code, reason });
    });

    this.oneBot.on("reconnectScheduled", (event) => {
      this.logger.warn("NapCat reconnect scheduled", event as Record<string, unknown>);
    });

    this.oneBot.on("loginInfo", (info) => {
      const data = info as { nickname?: string; user_id?: number | string };
      this.logger.info("NapCat login info refreshed", {
        nickname: data.nickname ?? "unknown",
        userId: data.user_id ?? "unknown"
      });
    });

    this.oneBot.on("message", (event) => {
      this.enqueueQqToDiscord(`qq-message:${(event as OneBotMessageEvent).message_id ?? "unknown"}`, () =>
        this.handleOneBotMessage(event as OneBotMessageEvent)
      );
    });

    this.oneBot.on("notice", (event) => {
      this.enqueueQqToDiscord(
        `qq-notice:${(event as OneBotNoticeEvent).notice_type}:${(event as OneBotNoticeEvent).message_id ?? "unknown"}`,
        () => this.handleOneBotNotice(event as OneBotNoticeEvent)
      );
    });

    this.oneBot.on("request", (event) => {
      const data = event as OneBotRequestEvent;
      this.enqueueQqToDiscord(
        `qq-request:${data.request_type}:${data.group_id ?? "unknown"}:${data.user_id ?? "unknown"}`,
        () => this.handleOneBotRequest(data)
      );
    });

    this.oneBot.on("meta", (event) => {
      this.handleOneBotMetaEvent(event as OneBotMetaEvent);
    });

    this.oneBot.on("error", (error) => {
      this.logger.error("NapCat OneBot error", { error });
    });
  }

  private async registerStatusCommand(): Promise<void> {
    const commandData = {
      name: this.config.statusCommandName,
      description: "QDiscord bridge controls",
      dmPermission: false,
      defaultMemberPermissions:
        this.config.statusCommandAllowedUserIds.size === 0 ? PermissionFlagsBits.ManageGuild : null,
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "status",
          description: "Show Discord and QQ bridge health"
        }
      ]
    } satisfies ApplicationCommandDataResolvable;

    if (this.config.statusCommandGuildIds.size === 0) {
      if (!this.discord.application?.commands) {
        return;
      }

      await upsertStatusCommand(this.discord.application.commands, commandData);
      this.logger.info("Discord status command registered", {
        command: `/${this.config.statusCommandName} status`,
        scope: "global"
      });
      return;
    }

    for (const guildId of this.config.statusCommandGuildIds) {
      const guild = await this.discord.guilds.fetch(guildId as Snowflake);
      await upsertStatusCommand(guild.commands, commandData);
      this.logger.info("Discord status command registered", {
        command: `/${this.config.statusCommandName} status`,
        scope: "guild",
        guildId
      });
    }
  }

  private async validateBridgeRoutes(): Promise<void> {
    const selfUserId = this.discord.user?.id;
    if (!selfUserId) {
      return;
    }

    const requiredPermissions = [
      { name: "ViewChannel", flag: PermissionFlagsBits.ViewChannel },
      { name: "SendMessages", flag: PermissionFlagsBits.SendMessages },
      { name: "AttachFiles", flag: PermissionFlagsBits.AttachFiles },
      { name: "ReadMessageHistory", flag: PermissionFlagsBits.ReadMessageHistory }
    ];

    for (const pair of this.config.bridgePairs) {
      const channel = await this.discord.channels.fetch(pair.discordChannelId as Snowflake);
      if (!channel?.isTextBased() || !("send" in channel)) {
        this.logger.warn("Configured Discord route is not a sendable text channel", {
          discordChannelId: pair.discordChannelId,
          qqGroupId: pair.qqGroupId
        });
        continue;
      }

      const permissions = (
        channel as {
          permissionsFor?: (userId: string) => { has(permission: bigint): boolean } | null;
        }
      ).permissionsFor?.(selfUserId);
      const missing = requiredPermissions
        .filter((permission) => !permissions?.has(permission.flag))
        .map((permission) => permission.name);

      if (missing.length > 0) {
        this.logger.warn("Discord route is missing recommended permissions", {
          discordChannelId: pair.discordChannelId,
          qqGroupId: pair.qqGroupId,
          missing
        });
      }
    }
  }

  private async handleChatInputCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (
      !this.config.statusCommandEnabled ||
      interaction.commandName !== this.config.statusCommandName ||
      interaction.options.getSubcommand(false) !== "status"
    ) {
      return;
    }

    if (!this.canUseStatusCommand(interaction)) {
      await interaction.reply({
        content: "You do not have permission to use this bridge command.",
        ephemeral: true
      });
      return;
    }

    await interaction.reply({
      content: formatStatusForDiscord(this.getStatus()),
      ephemeral: true
    });
  }

  private canUseStatusCommand(interaction: ChatInputCommandInteraction): boolean {
    return isStatusCommandAuthorized({
      userId: interaction.user.id,
      allowedUserIds: this.config.statusCommandAllowedUserIds,
      hasManageGuild: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false
    });
  }

  private async handleDiscordMessage(message: Message, options: ForwardOptions = {}): Promise<void> {
    const route = this.resolveDiscordMessageRoute(message);
    if (
      !route ||
      route.pair.direction === "qq-to-discord" ||
      !this.shouldBridgeDiscordMessage(message, route.routeChannelId)
    ) {
      return;
    }
    const qqGroupId = route.pair.qqGroupId;

    const referencedDiscordMessageId = message.reference?.messageId;
    const replyToQqMessageId = referencedDiscordMessageId
      ? this.getLinkByDiscordMessageId(referencedDiscordMessageId)?.qqMessageId
      : undefined;
    const replyFallbackText =
      referencedDiscordMessageId && !replyToQqMessageId
        ? await this.createDiscordReplyFallback(message, referencedDiscordMessageId)
        : undefined;
    const senderName = getDiscordSenderName(message);
    const threadSource = route.threadName ? ` thread #${route.threadName}` : "";
    const senderLabel = this.config.showSenderName
      ? `[Discord${threadSource}${options.edited ? " edited" : ""}] ${senderName}`
      : options.edited
        ? "[Discord edited]"
        : undefined;
    const segments = discordMessageToQqSegments(
      {
        content: message.content,
        senderLabel,
        replyToQqMessageId,
        replyFallbackText,
        attachments: message.attachments.values(),
        stickers: message.stickers.values(),
        embeds: message.embeds,
        poll: discordPollToQqInput(message.poll),
        forwardedMessages: discordForwardedMessagesToQqInput(message.messageSnapshots.values())
      },
      {
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
      }
    );

    if (segments.length === 0) {
      return;
    }

    const results = await this.sendQqSegments(qqGroupId, segments);
    const qqMessageIds = results
      .map((item) => item.message_id)
      .filter((messageId) => messageId !== undefined)
      .map(String);
    if (qqMessageIds.length > 0) {
      this.rememberMessageLink({
        discordMessageId: message.id,
        discordMessageIds: [message.id],
        discordChannelId: message.channelId,
        qqGroupId,
        qqMessageId: qqMessageIds[0] ?? "",
        qqMessageIds,
        createdAt: Date.now()
      });
    }
  }

  private async handleDiscordMessageUpdate(message: Message): Promise<void> {
    if (message.author.id === this.discord.user?.id) {
      return;
    }

    const existing = this.getLinkByDiscordMessageId(message.id);
    if (existing) {
      if (!this.linkAllowsDiscordToQq(existing)) {
        return;
      }

      await this.deleteQqMessages(messageLinkQqIds(existing));
      this.forgetByDiscordMessageId(message.id);
      this.persistMessageLinks();
    }

    await this.handleDiscordMessage(message, { edited: true });
  }

  private async createDiscordReplyFallback(
    message: Message,
    referencedDiscordMessageId: string
  ): Promise<string> {
    try {
      const referenced = await message.fetchReference();
      return formatDiscordReplyFallback({
        messageId: referencedDiscordMessageId,
        authorName: getDiscordSenderName(referenced),
        content: referenced.content,
        attachmentCount: referenced.attachments.size,
        embedCount: referenced.embeds.length,
        stickerCount: referenced.stickers.size
      });
    } catch (error) {
      this.logger.debug("Failed to fetch Discord reply reference", {
        messageId: message.id,
        referencedDiscordMessageId,
        error
      });
      return formatDiscordReplyFallback({ messageId: referencedDiscordMessageId });
    }
  }

  private async handleDiscordMessageDelete(message: Message | PartialMessage): Promise<void> {
    const existing = this.getLinkByDiscordMessageId(message.id);
    if (!existing) {
      return;
    }

    if (!this.linkAllowsDiscordToQq(existing)) {
      return;
    }

    await this.deleteQqMessages(messageLinkQqIds(existing));
    this.forgetByDiscordMessageId(message.id);
    this.persistMessageLinks();
  }

  private async handleDiscordMessageBulkDelete(
    messages: Iterable<Message | PartialMessage>
  ): Promise<void> {
    let deleted = 0;
    for (const message of messages) {
      const existing = this.getLinkByDiscordMessageId(message.id);
      if (!existing || !this.linkAllowsDiscordToQq(existing)) {
        continue;
      }

      await this.deleteQqMessages(messageLinkQqIds(existing));
      this.forgetByDiscordMessageId(message.id);
      deleted += 1;
    }

    if (deleted > 0) {
      this.persistMessageLinks();
      this.logger.info("Synchronized Discord bulk delete to QQ", { deleted });
    }
  }

  private async handleDiscordMemberEvent(
    member: GuildMember | PartialGuildMember,
    action: "joined" | "left"
  ): Promise<void> {
    if (
      !this.config.bridgeMemberEvents ||
      member.user.bot ||
      this.config.blockedDiscordUserIds.has(member.user.id)
    ) {
      return;
    }

    for (const pair of this.config.bridgePairs) {
      if (
        pair.direction === "qq-to-discord" ||
        !this.discordRouteAllowed(pair.discordChannelId, pair.discordChannelId)
      ) {
        continue;
      }

      const channel = await this.discord.channels.fetch(pair.discordChannelId as Snowflake);
      if (!channel || !("guildId" in channel) || channel.guildId !== member.guild.id) {
        continue;
      }

      await this.sendQqSystemMessage(
        pair.qqGroupId,
        `[Discord] ${member.user.tag} ${action} ${member.guild.name}`
      );
    }
  }

  private async handleDiscordReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
    action: "added" | "removed"
  ): Promise<void> {
    const fullUser = user.partial ? await user.fetch() : user;
    if (fullUser.id === this.discord.user?.id || (!this.config.bridgeBotMessages && fullUser.bot)) {
      return;
    }

    const fullReaction = reaction.partial ? await reaction.fetch() : reaction;
    const destination = this.resolveDiscordReactionDestination(fullReaction.message);
    if (!destination) {
      return;
    }

    const segments = discordReactionToQqSegments(
      {
        action,
        emojiText: formatDiscordReactionEmoji(fullReaction),
        userLabel: fullUser.globalName ?? fullUser.username,
        replyToQqMessageId: destination.replyToQqMessageId
      },
      {
        discordToQqUserMap: this.config.discordToQqUserMap,
        discordEmojiToCqFaceMap: this.config.discordEmojiToCqFaceMap
      }
    );

    await this.sendQqSegments(destination.qqGroupId, segments);
  }

  private async handleDiscordReactionClear(
    message: Message | PartialMessage,
    reactionTypeCount: number
  ): Promise<void> {
    const destination = this.resolveDiscordReactionDestination(message);
    if (!destination) {
      return;
    }

    await this.sendQqSegments(
      destination.qqGroupId,
      discordReactionClearToQqSegments(
        {
          scope: "all",
          reactionCount: reactionTypeCount,
          replyToQqMessageId: destination.replyToQqMessageId
        },
        {
          discordToQqUserMap: this.config.discordToQqUserMap,
          discordEmojiToCqFaceMap: this.config.discordEmojiToCqFaceMap
        }
      )
    );
  }

  private async handleDiscordReactionEmojiClear(
    reaction: MessageReaction | PartialMessageReaction
  ): Promise<void> {
    const destination = this.resolveDiscordReactionDestination(reaction.message);
    if (!destination) {
      return;
    }

    await this.sendQqSegments(
      destination.qqGroupId,
      discordReactionClearToQqSegments(
        {
          scope: "emoji",
          emojiText: formatDiscordReactionEmoji(reaction),
          reactionCount: reaction.count,
          replyToQqMessageId: destination.replyToQqMessageId
        },
        {
          discordToQqUserMap: this.config.discordToQqUserMap,
          discordEmojiToCqFaceMap: this.config.discordEmojiToCqFaceMap
        }
      )
    );
  }

  private async handleDiscordPollVote(
    pollAnswer: PollAnswer | PartialPollAnswer,
    userId: string,
    action: "added" | "removed"
  ): Promise<void> {
    if (userId === this.discord.user?.id || this.config.blockedDiscordUserIds.has(userId)) {
      return;
    }

    const destination = this.resolveDiscordReactionDestination(pollAnswer.poll.message);
    if (!destination) {
      return;
    }

    const user = this.discord.users.cache.get(userId as Snowflake);
    await this.sendQqSegments(
      destination.qqGroupId,
      discordPollVoteToQqSegments(
        {
          action,
          userLabel: user?.globalName ?? user?.username ?? `User ${userId}`,
          answerId: pollAnswer.id,
          answerText: pollAnswer.text,
          answerEmojiText: formatDiscordPollEmoji(pollAnswer.emoji),
          replyToQqMessageId: destination.replyToQqMessageId
        },
        {
          discordToQqUserMap: this.config.discordToQqUserMap,
          discordEmojiToCqFaceMap: this.config.discordEmojiToCqFaceMap
        }
      )
    );
  }

  private async handleOneBotMessage(event: OneBotMessageEvent): Promise<void> {
    if (event.message_type !== "group" || event.group_id === undefined) {
      return;
    }

    if (this.oneBot.selfQQId && String(event.user_id) === this.oneBot.selfQQId) {
      return;
    }

    if (event.user_id !== undefined && this.config.blockedQqUserIds.has(String(event.user_id))) {
      return;
    }

    const qqGroupId = String(event.group_id);
    const pair = this.config.qqGroupToBridgePair.get(qqGroupId);
    if (!pair || pair.direction === "discord-to-qq") {
      return;
    }
    const discordChannelId = pair.discordChannelId;

    const channel = await this.fetchDiscordTextChannel(discordChannelId);
    if (!channel) {
      this.logger.warn("Discord channel is not text-sendable", { discordChannelId });
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
    const content = `${prefix}${converted.content}`.trim();
    const replyToDiscordMessageId = converted.replyToMessageId
      ? this.getLinkByQqMessageId(converted.replyToMessageId)?.discordMessageId
      : undefined;
    const replyFallback =
      converted.replyToMessageId && !replyToDiscordMessageId
        ? `${await this.createQqReplyFallback(converted.replyToMessageId)}\n`
        : "";
    const sentMessages = await this.sendDiscordMessage(
      channel,
      `${replyFallback}${content}`.trim(),
      converted.files,
      {
        users: converted.mentionUserIds,
        roles: [],
        parse:
          converted.mentionEveryone && this.config.allowEveryoneMentions ? ["everyone"] : []
      },
      replyToDiscordMessageId
    );

    const qqMessageId = event.message_id;
    if (qqMessageId !== undefined && sentMessages[0]) {
      const discordMessageIds = sentMessages.map((sentMessage) => sentMessage.id);
      this.rememberMessageLink({
        discordMessageId: sentMessages[0].id,
        discordMessageIds,
        discordChannelId,
        qqGroupId,
        qqMessageId: String(qqMessageId),
        qqMessageIds: [String(qqMessageId)],
        createdAt: Date.now()
      });
    }
  }

  private async handleOneBotNotice(event: OneBotNoticeEvent): Promise<void> {
    if (event.notice_type === "group_recall" && event.message_id !== undefined) {
      const link = this.getLinkByQqMessageId(String(event.message_id));
      if (!link) {
        return;
      }

      if (!this.routeAllowsQqToDiscord(link.qqGroupId)) {
        return;
      }

      await this.deleteDiscordMessages(link.discordChannelId, messageLinkDiscordIds(link));
      this.forgetByQqMessageId(link.qqMessageId);
      this.persistMessageLinks();
      return;
    }

    if (isOneBotNoticeBlocked(event, this.config.blockedQqUserIds)) {
      return;
    }

    if (this.config.bridgeTypingIndicators && isOneBotTypingNotice(event)) {
      await this.handleOneBotTypingNotice(event);
      return;
    }

    const reaction = extractOneBotReaction(event);
    if (reaction && event.group_id !== undefined) {
      const pair = this.config.qqGroupToBridgePair.get(String(event.group_id));
      if (!pair || pair.direction === "discord-to-qq") {
        return;
      }
      const discordChannelId = pair.discordChannelId;

      const channel = await this.fetchDiscordTextChannel(discordChannelId);
      if (!channel) {
        return;
      }

      const link =
        event.message_id !== undefined
          ? this.getLinkByQqMessageId(String(event.message_id))
          : undefined;
      await this.sendDiscordMessage(
        channel,
        qqReactionToDiscordContent(reaction, {
          qqToDiscordUserMap: this.config.qqToDiscordUserMap,
          cqFaceEmojiMap: this.config.cqFaceEmojiMap
        }),
        [],
        { users: [], roles: [], parse: [] },
        link?.discordMessageId
      );
      return;
    }

    if (event.notice_type === "group_upload" && event.group_id !== undefined) {
      const pair = this.config.qqGroupToBridgePair.get(String(event.group_id));
      if (!pair || pair.direction === "discord-to-qq") {
        return;
      }

      await this.sendDiscordSystemMessage(pair.discordChannelId, formatOneBotGroupUpload(event));
      return;
    }

    if (event.group_id !== undefined) {
      const content = formatOneBotGroupNotice(event);
      if (content) {
        const pair = this.config.qqGroupToBridgePair.get(String(event.group_id));
        if (!pair || pair.direction === "discord-to-qq") {
          return;
        }

        await this.sendDiscordSystemMessage(pair.discordChannelId, content);
        return;
      }
    }

    if (
      this.config.bridgeMemberEvents &&
      event.group_id !== undefined &&
      (event.notice_type === "group_increase" || event.notice_type === "group_decrease")
    ) {
      const pair = this.config.qqGroupToBridgePair.get(String(event.group_id));
      if (!pair || pair.direction === "discord-to-qq") {
        return;
      }
      const discordChannelId = pair.discordChannelId;

      const action = event.notice_type === "group_increase" ? "joined" : "left";
      const content = `[QQ] User ${event.user_id ?? "unknown"} ${action} group ${event.group_id}`;
      await this.sendDiscordSystemMessage(discordChannelId, content);
    }
  }

  private async handleOneBotRequest(event: OneBotRequestEvent): Promise<void> {
    if (
      event.request_type !== "group" ||
      event.group_id === undefined ||
      isOneBotRequestBlocked(event, this.config.blockedQqUserIds)
    ) {
      return;
    }

    const pair = this.config.qqGroupToBridgePair.get(String(event.group_id));
    if (!pair || pair.direction === "discord-to-qq") {
      return;
    }

    await this.sendDiscordSystemMessage(pair.discordChannelId, formatOneBotGroupRequest(event));
  }

  private handleOneBotMetaEvent(event: OneBotMetaEvent): void {
    if (event.meta_event_type === "heartbeat") {
      this.logger.debug("NapCat heartbeat received", {
        online: event.status?.online,
        good: event.status?.good,
        interval: event.interval
      });
      return;
    }

    if (event.meta_event_type === "lifecycle") {
      this.logger.info("NapCat lifecycle event received", {
        subType: event.sub_type ?? "unknown",
        selfId: event.self_id ?? "unknown"
      });
      return;
    }

    this.logger.debug("NapCat meta event received", {
      metaEventType: event.meta_event_type,
      subType: event.sub_type
    });
  }

  private async createQqReplyFallback(qqMessageId: string): Promise<string> {
    try {
      await this.waitForOneBotConnection();
      const message = await this.oneBot.getMessage(qqMessageId);
      const segments = normalizeOneBotMessage(message.message ?? message.raw_message);
      const converted = qqSegmentsToDiscord(segments, {
        qqToDiscordUserMap: this.config.qqToDiscordUserMap,
        cqFaceEmojiMap: this.config.cqFaceEmojiMap
      });
      const senderName =
        message.sender?.card?.trim() ||
        message.sender?.nickname?.trim() ||
        (message.user_id !== undefined ? `QQ ${message.user_id}` : undefined);
      return formatQqReplyFallback({
        messageId: qqMessageId,
        senderName,
        content: converted.content,
        fileCount: converted.files.length
      });
    } catch (error) {
      this.logger.debug("Failed to fetch QQ reply reference", {
        qqMessageId,
        error
      });
      return formatQqReplyFallback({ messageId: qqMessageId });
    }
  }

  private async handleOneBotTypingNotice(event: OneBotNoticeEvent): Promise<void> {
    if (event.group_id === undefined) {
      return;
    }

    const pair = this.config.qqGroupToBridgePair.get(String(event.group_id));
    if (!pair || pair.direction === "discord-to-qq") {
      return;
    }
    const discordChannelId = pair.discordChannelId;

    const channel = await this.fetchDiscordTextChannel(discordChannelId);
    await channel?.sendTyping?.();
  }

  private shouldBridgeDiscordMessage(message: Message, routeDiscordChannelId = message.channelId): boolean {
    if (
      !this.discordRouteAllowed(message.channelId, routeDiscordChannelId)
    ) {
      return false;
    }

    if (this.config.blockedDiscordUserIds.has(message.author.id)) {
      return false;
    }

    if (message.author.id === this.discord.user?.id) {
      return false;
    }

    return this.config.bridgeBotMessages || !message.author.bot;
  }

  private resolveDiscordMessageRoute(message: Message | PartialMessage): DiscordBridgeRoute | undefined {
    const thread = getDiscordThreadInfo(message);
    return resolveDiscordBridgeRoute({
      channelId: message.channelId,
      threadParentId: thread?.parentId,
      threadName: thread?.name,
      bridgePairs: this.config.discordChannelToBridgePair
    });
  }

  private linkAllowsDiscordToQq(link: MessageLink): boolean {
    const pair = this.config.qqGroupToBridgePair.get(link.qqGroupId);
    return pair !== undefined && pair.direction !== "qq-to-discord";
  }

  private resolveDiscordReactionDestination(
    message: Message | PartialMessage
  ): { qqGroupId: string; replyToQqMessageId?: string } | undefined {
    const link = this.getLinkByDiscordMessageId(message.id);
    if (link) {
      return this.linkAllowsDiscordToQq(link)
        ? { qqGroupId: link.qqGroupId, replyToQqMessageId: link.qqMessageId }
        : undefined;
    }

    const route = this.resolveDiscordMessageRoute(message);
    if (
      !route ||
      route.pair.direction === "qq-to-discord" ||
      !this.discordRouteAllowed(message.channelId, route.routeChannelId)
    ) {
      return undefined;
    }

    return { qqGroupId: route.pair.qqGroupId };
  }

  private discordRouteAllowed(discordChannelId: string, routeDiscordChannelId: string): boolean {
    return (
      this.config.allowedDiscordChannelIds.size === 0 ||
      this.config.allowedDiscordChannelIds.has(discordChannelId) ||
      this.config.allowedDiscordChannelIds.has(routeDiscordChannelId)
    );
  }

  private routeAllowsQqToDiscord(qqGroupId: string): boolean {
    const pair = this.config.qqGroupToBridgePair.get(qqGroupId);
    return pair !== undefined && pair.direction !== "discord-to-qq";
  }

  private async sendQqSystemMessage(qqGroupId: string, content: string): Promise<void> {
    const segments: CqSegment[] = [{ type: "text", data: { text: content } }];
    await this.sendQqSegments(qqGroupId, segments);
  }

  private async sendQqSegments(
    qqGroupId: string,
    segments: CqSegment[]
  ): Promise<OneBotSendMessageData[]> {
    const results: OneBotSendMessageData[] = [];
    for (const chunk of chunkQqSegments(segments, this.config.qqMaxTextSegmentLength)) {
      const messageSegments = chunk.filter((segment) => segment.type !== "file");
      const fileSegments = chunk.filter((segment) => segment.type === "file");

      if (messageSegments.length > 0) {
        await this.waitForOneBotConnection();
        results.push(await this.oneBot.sendGroupMessage(qqGroupId, messageSegments));
      }

      for (const fileSegment of fileSegments) {
        const fallbackResult = await this.sendQqFileSegment(qqGroupId, fileSegment);
        if (fallbackResult) {
          results.push(fallbackResult);
        }
      }
    }

    return results;
  }

  private async sendQqFileSegment(
    qqGroupId: string,
    segment: CqSegment
  ): Promise<OneBotSendMessageData | undefined> {
    const file = firstString(segment.data.file, segment.data.url, segment.data.path);
    const name = sanitizeFileName(firstString(segment.data.name, segment.data.file_name) ?? inferFileName(file));
    if (!file) {
      await this.waitForOneBotConnection();
      return this.oneBot.sendGroupMessage(qqGroupId, [
        { type: "text", data: { text: "[Discord file]" } }
      ]);
    }

    if (this.config.uploadQqFiles) {
      try {
        await this.waitForOneBotConnection();
        await this.oneBot.uploadGroupFile(qqGroupId, file, name);
        return undefined;
      } catch (error) {
        this.logger.warn("Failed to upload QQ group file, falling back to link text", {
          qqGroupId,
          name,
          error
        });
      }
    }

    await this.waitForOneBotConnection();
    return this.oneBot.sendGroupMessage(qqGroupId, [
      { type: "text", data: { text: `[Discord file${name ? ` ${name}` : ""}: ${file}]` } }
    ]);
  }

  private async sendDiscordSystemMessage(discordChannelId: string, content: string): Promise<void> {
    const channel = await this.fetchDiscordTextChannel(discordChannelId);
    if (!channel) {
      return;
    }

    await this.sendDiscordMessage(channel, content, [], { users: [], roles: [], parse: [] });
  }

  private async fetchDiscordTextChannel(channelId: string): Promise<SendableTextChannel | undefined> {
    const channel = await this.discord.channels.fetch(channelId as Snowflake);
    if (!channel?.isTextBased() || !("send" in channel) || typeof channel.send !== "function") {
      return undefined;
    }

    return channel as SendableTextChannel;
  }

  private async resolveFullMessage(message: Message | PartialMessage): Promise<Message | undefined> {
    if (!message.partial) {
      return message as Message;
    }

    try {
      return await message.fetch();
    } catch (error) {
      this.logger.warn("Failed to fetch partial Discord message", { messageId: message.id, error });
      return undefined;
    }
  }

  private async sendDiscordMessage(
    channel: SendableTextChannel,
    content: string,
    files: string[],
    allowedMentions: { users: string[]; roles: string[]; parse: Array<"everyone"> },
    replyToDiscordMessageId?: string
  ): Promise<Message[]> {
    const sent: Message[] = [];
    const contentChunks = splitDiscordContent(content, this.config.discordMaxContentLength);
    const fileBatches = chunk(files, 10);
    const firstOptions: MessageCreateOptions | undefined =
      contentChunks[0] || fileBatches[0]
        ? {
            content: contentChunks[0],
            files: fileBatches[0],
            allowedMentions,
            reply: replyToDiscordMessageId
              ? { messageReference: replyToDiscordMessageId, failIfNotExists: false }
              : undefined
          }
        : undefined;

    if (firstOptions) {
      sent.push(
        ...(await this.sendDiscordMessageOptions(channel, firstOptions, fileBatches[0] ?? []))
      );
    }

    for (const chunkContent of contentChunks.slice(1)) {
      sent.push(await channel.send({ content: chunkContent, allowedMentions }));
    }

    for (const batch of fileBatches.slice(firstOptions?.files ? 1 : 0)) {
      sent.push(
        ...(await this.sendDiscordMessageOptions(channel, { files: batch, allowedMentions }, batch))
      );
    }

    return sent;
  }

  private async sendDiscordMessageOptions(
    channel: SendableTextChannel,
    options: MessageCreateOptions,
    fallbackFiles: string[]
  ): Promise<Message[]> {
    try {
      return [await channel.send(options)];
    } catch (error) {
      if (fallbackFiles.length === 0) {
        throw error;
      }

      this.logger.warn("Failed to send Discord attachments, falling back to file links", {
        channelId: channel.id,
        fileCount: fallbackFiles.length,
        error
      });
      const fallbackContent = [
        options.content,
        ...fallbackFiles.map((file) => `[file] ${file}`)
      ]
        .filter(Boolean)
        .join("\n");
      const sent: Message[] = [];
      const chunks = splitDiscordContent(fallbackContent, this.config.discordMaxContentLength);
      for (const [index, chunkContent] of chunks.entries()) {
        sent.push(
          await channel.send({
            content: chunkContent,
            allowedMentions: options.allowedMentions,
            reply: index === 0 ? options.reply : undefined
          })
        );
      }

      return sent;
    }
  }

  private async deleteQqMessage(qqMessageId: string): Promise<void> {
    try {
      await this.waitForOneBotConnection();
      await this.oneBot.deleteMessage(qqMessageId);
    } catch (error) {
      this.logger.warn("Failed to delete QQ message", { qqMessageId, error });
    }
  }

  private async deleteQqMessages(qqMessageIds: string[]): Promise<void> {
    for (const qqMessageId of qqMessageIds) {
      await this.deleteQqMessage(qqMessageId);
    }
  }

  private async deleteDiscordMessage(channelId: string, messageId: string): Promise<void> {
    try {
      const channel = await this.discord.channels.fetch(channelId as Snowflake);
      const messageManager = (channel as { messages?: { fetch(id: string): Promise<Message> } } | null)
        ?.messages;
      const message = await messageManager?.fetch(messageId);
      await message?.delete();
    } catch (error) {
      this.logger.warn("Failed to delete Discord message", { channelId, messageId, error });
    }
  }

  private async deleteDiscordMessages(channelId: string, messageIds: string[]): Promise<void> {
    for (const messageId of messageIds) {
      await this.deleteDiscordMessage(channelId, messageId);
    }
  }

  private async waitForOneBotConnection(): Promise<void> {
    if (await this.oneBot.waitUntilConnected(this.config.oneBotActionTimeoutMs)) {
      return;
    }

    throw new Error("NapCat OneBot WebSocket did not reconnect before action timeout");
  }

  private rememberMessageLink(link: MessageLink): void {
    const normalized = normalizeMessageLink(link);
    this.pruneMessageLinks();
    for (const discordMessageId of messageLinkDiscordIds(normalized)) {
      this.forgetByDiscordMessageId(discordMessageId);
    }
    for (const qqMessageId of messageLinkQqIds(normalized)) {
      this.forgetByQqMessageId(qqMessageId);
    }
    this.indexMessageLink(normalized);
    this.pruneMessageLinks();
    this.persistMessageLinks();
  }

  private indexMessageLink(link: MessageLink): void {
    const normalized = normalizeMessageLink(link);
    for (const discordMessageId of messageLinkDiscordIds(normalized)) {
      this.discordLinks.set(discordMessageId, normalized);
    }
    for (const qqMessageId of messageLinkQqIds(normalized)) {
      this.qqLinks.set(qqMessageId, normalized);
    }
  }

  private getLinkByDiscordMessageId(discordMessageId: string): MessageLink | undefined {
    this.pruneMessageLinks();
    return this.discordLinks.get(discordMessageId);
  }

  private getLinkByQqMessageId(qqMessageId: string): MessageLink | undefined {
    this.pruneMessageLinks();
    return this.qqLinks.get(qqMessageId);
  }

  private forgetByDiscordMessageId(discordMessageId: string): void {
    const link = this.discordLinks.get(discordMessageId);
    if (!link) {
      return;
    }

    for (const id of messageLinkDiscordIds(link)) {
      this.discordLinks.delete(id);
    }
    for (const id of messageLinkQqIds(link)) {
      this.qqLinks.delete(id);
    }
  }

  private forgetByQqMessageId(qqMessageId: string): void {
    const link = this.qqLinks.get(qqMessageId);
    if (!link) {
      return;
    }

    for (const id of messageLinkDiscordIds(link)) {
      this.discordLinks.delete(id);
    }
    for (const id of messageLinkQqIds(link)) {
      this.qqLinks.delete(id);
    }
  }

  private pruneMessageLinks(): void {
    let removed = false;
    const expiresBefore = Date.now() - this.config.messageLinkTtlMs;
    for (const link of this.uniqueMessageLinks()) {
      if (link.createdAt < expiresBefore) {
        this.forgetByDiscordMessageId(link.discordMessageId);
        removed = true;
      }
    }

    while (this.uniqueMessageLinks().length > this.config.messageLinkMaxEntries) {
      const oldest = this.uniqueMessageLinks()[0];
      if (!oldest) {
        return;
      }
      this.forgetByDiscordMessageId(oldest.discordMessageId);
      removed = true;
    }

    if (removed) {
      this.persistMessageLinks();
    }
  }

  private loadStoredMessageLinks(): void {
    if (!this.linkStore) {
      return;
    }

    try {
      for (const link of this.linkStore.load()) {
        if (this.config.qqGroupToBridgePair.has(link.qqGroupId)) {
          this.indexMessageLink(link);
        }
      }
      this.pruneMessageLinks();
      this.logger.info("Loaded persisted message links", {
        count: this.uniqueMessageLinks().length
      });
    } catch (error) {
      this.logger.warn("Failed to load persisted message links", { error });
    }
  }

  private persistMessageLinks(): void {
    if (!this.linkStore) {
      return;
    }

    try {
      this.linkStore.save(this.uniqueMessageLinks());
    } catch (error) {
      this.logger.warn("Failed to persist message links", { error });
    }
  }

  private uniqueMessageLinks(): MessageLink[] {
    return [...new Set(this.discordLinks.values())];
  }

  private enqueueDiscordToQq(label: string, task: () => Promise<void>): void {
    if (this.stopping) {
      return;
    }

    void this.discordToQqQueue.add(label, task).catch((error) => {
      this.logger.error("Discord to QQ task failed", { label, error });
    });
  }

  private enqueueQqToDiscord(label: string, task: () => Promise<void>): void {
    if (this.stopping) {
      return;
    }

    void this.qqToDiscordQueue.add(label, task).catch((error) => {
      this.logger.error("QQ to Discord task failed", { label, error });
    });
  }
}

function getDiscordSenderName(message: Message): string {
  return message.member?.displayName ?? message.author.globalName ?? message.author.username;
}

export function isStatusCommandAuthorized(input: {
  userId: string;
  allowedUserIds: Set<string>;
  hasManageGuild: boolean;
}): boolean {
  return input.allowedUserIds.has(input.userId) || input.hasManageGuild;
}

export function isOneBotNoticeBlocked(
  event: OneBotNoticeEvent,
  blockedQqUserIds: Set<string>
): boolean {
  return event.user_id !== undefined && blockedQqUserIds.has(String(event.user_id));
}

export function isOneBotRequestBlocked(
  event: OneBotRequestEvent,
  blockedQqUserIds: Set<string>
): boolean {
  return event.user_id !== undefined && blockedQqUserIds.has(String(event.user_id));
}

export function normalizeMessageLink(link: MessageLink): MessageLink {
  const discordMessageIds = messageLinkDiscordIds(link);
  const qqMessageIds = messageLinkQqIds(link);
  return {
    ...link,
    discordMessageId: discordMessageIds[0] ?? link.discordMessageId,
    discordMessageIds,
    qqMessageId: qqMessageIds[0] ?? link.qqMessageId,
    qqMessageIds
  };
}

function messageLinkDiscordIds(link: MessageLink): string[] {
  return uniqueIds(link.discordMessageId, link.discordMessageIds);
}

function messageLinkQqIds(link: MessageLink): string[] {
  return uniqueIds(link.qqMessageId, link.qqMessageIds);
}

function uniqueIds(primary: string, ids: string[] | undefined): string[] {
  return [...new Set([primary, ...(ids ?? [])].filter((id) => id.trim() !== ""))];
}

export function resolveDiscordBridgeRoute(input: {
  channelId: string;
  threadParentId?: string | null;
  threadName?: string;
  bridgePairs: Map<string, BridgePair>;
}): DiscordBridgeRoute | undefined {
  const directPair = input.bridgePairs.get(input.channelId);
  if (directPair) {
    return { pair: directPair, routeChannelId: input.channelId };
  }

  if (!input.threadParentId) {
    return undefined;
  }

  const parentPair = input.bridgePairs.get(input.threadParentId);
  if (!parentPair) {
    return undefined;
  }

  return {
    pair: parentPair,
    routeChannelId: input.threadParentId,
    threadName: input.threadName
  };
}

function getQqSenderName(event: OneBotMessageEvent): string {
  const card = event.sender?.card?.trim();
  const nickname = event.sender?.nickname?.trim();
  return card || nickname || `QQ ${event.user_id ?? "unknown"}`;
}

function getDiscordThreadInfo(
  message: Message | PartialMessage
): { parentId: string; name: string } | undefined {
  if (!message.channel.isThread() || !message.channel.parentId) {
    return undefined;
  }

  return {
    parentId: message.channel.parentId,
    name: message.channel.name
  };
}

async function upsertStatusCommand(
  manager: unknown,
  commandData: StatusCommandData
): Promise<void> {
  const commandManager = manager as CommandManagerLike;
  const commands = await commandManager.fetch();
  const existing = commands.find((command) => command.name === commandData.name);
  if (existing) {
    await commandManager.edit(existing.id, commandData);
    return;
  }

  await commandManager.create(commandData);
}

function formatStatusForDiscord(status: BridgeRuntimeStatus): string {
  const queueLines = Object.entries(status.queues)
    .map(
      ([name, stats]) =>
        `${name}: pending ${stats.pending}, running ${stats.running}, failed ${stats.failed}, dropped ${stats.dropped}`
    )
    .join("\n");

  return [
    `Discord: ${status.discord.ready ? "ready" : "not ready"} (${status.discord.userTag ?? "unknown"})`,
    `QQ: ${status.oneBot.connected ? "connected" : status.oneBot.connecting ? "connecting" : "disconnected"} (${status.oneBot.selfQQId ?? "unknown"})`,
    status.oneBot.lastHeartbeat
      ? `QQ heartbeat: ${status.oneBot.lastHeartbeat.good === false ? "degraded" : "ok"} at ${status.oneBot.lastHeartbeat.at}`
      : undefined,
    status.oneBot.lastLifecycle
      ? `QQ lifecycle: ${status.oneBot.lastLifecycle.subType ?? "unknown"} at ${status.oneBot.lastLifecycle.at}`
      : undefined,
    `Bridge pairs: ${status.bridgePairs}`,
    `Tracked links: ${status.messageLinks.tracked}/${status.messageLinks.maxEntries}`,
    `Uptime: ${status.uptimeSeconds}s`,
    queueLines
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDiscordReactionEmoji(
  reaction: MessageReaction | PartialMessageReaction
): string {
  if (reaction.emoji.id) {
    return `<${reaction.emoji.animated ? "a" : ""}:${reaction.emoji.name ?? "emoji"}:${reaction.emoji.id}>`;
  }

  return reaction.emoji.name ?? "emoji";
}

function discordPollToQqInput(poll: Message["poll"]): DiscordPollLike | undefined {
  if (!poll) {
    return undefined;
  }

  return {
    questionText: poll.question.text,
    answers: [...poll.answers.values()].map((answer) => ({
      id: answer.id,
      text: answer.text,
      emojiText: formatDiscordPollEmoji(answer.emoji),
      voteCount: answer.voteCount
    })),
    allowMultiselect: poll.allowMultiselect,
    expiresTimestamp: poll.expiresTimestamp,
    resultsFinalized: poll.resultsFinalized
  };
}

function discordForwardedMessagesToQqInput(
  snapshots: Iterable<MessageSnapshot>
): DiscordForwardedMessageLike[] {
  return [...snapshots].map((snapshot) => ({
    content: snapshot.content,
    attachments: snapshot.attachments.values(),
    stickers: snapshot.stickers.values(),
    embeds: snapshot.embeds
  }));
}

function formatDiscordPollEmoji(
  emoji: { id: string | null; name: string | null; animated?: boolean | null } | null
): string | undefined {
  if (!emoji) {
    return undefined;
  }

  if (emoji.id) {
    return `<${emoji.animated ? "a" : ""}:${emoji.name ?? "emoji"}:${emoji.id}>`;
  }

  return emoji.name ?? undefined;
}

function extractOneBotReaction(
  event: OneBotNoticeEvent
): { action: "added" | "removed"; emojiId?: string; userId?: string } | undefined {
  const noticeType = event.notice_type.toLowerCase();
  if (!noticeType.includes("reaction") && !noticeType.includes("emoji")) {
    return undefined;
  }

  const emojiId = firstString(
    event.emoji_id,
    event.emojiId,
    event.face_id,
    event.faceId,
    event.id
  );
  const subType = firstString(event.sub_type, event.action, event.operator_type)?.toLowerCase() ?? "";
  const action = /remove|delete|unset|unlike|cancel/.test(subType) ? "removed" : "added";

  return {
    action,
    emojiId,
    userId: event.user_id !== undefined ? String(event.user_id) : undefined
  };
}

function isOneBotTypingNotice(event: OneBotNoticeEvent): boolean {
  const noticeType = event.notice_type.toLowerCase();
  const subType = firstString(event.sub_type, event.action, event.status)?.toLowerCase() ?? "";
  return (
    noticeType.includes("typing") ||
    noticeType.includes("input") ||
    subType.includes("typing") ||
    subType.includes("input")
  );
}

function formatOneBotGroupUpload(event: OneBotNoticeEvent): string {
  const file =
    event.file && typeof event.file === "object"
      ? (event.file as Record<string, unknown>)
      : {};
  const name = firstString(file.name, file.file_name, file.id, event.file_id) ?? "unknown file";
  const size = firstString(file.size, event.file_size);
  const uploader = event.user_id ?? "unknown";
  const details = size ? `${name} (${formatBytes(size)})` : name;
  return `[QQ file upload] User ${uploader} uploaded ${details}`;
}

export function formatOneBotGroupNotice(event: OneBotNoticeEvent): string | undefined {
  const groupId = event.group_id ?? "unknown";
  const userId = firstString(event.user_id, event.target_id) ?? "unknown";
  const operatorId = firstString(event.operator_id);
  const operator = operatorId ? ` by operator ${operatorId}` : "";
  const subType = firstString(event.sub_type, event.action, event.operator_type)?.toLowerCase() ?? "";

  if (event.notice_type === "group_admin") {
    const action = /unset|remove|cancel|off/.test(subType) ? "removed as admin" : "made admin";
    return `[QQ admin] User ${userId} was ${action} in group ${groupId}${operator}`;
  }

  if (event.notice_type === "group_ban") {
    const lifted = /lift|unset|remove|cancel|off/.test(subType);
    if (lifted) {
      return `[QQ mute] User ${userId} was unmuted in group ${groupId}${operator}`;
    }

    const duration = firstString(event.duration);
    const detail = duration ? ` for ${formatDurationSeconds(duration)}` : "";
    return `[QQ mute] User ${userId} was muted in group ${groupId}${operator}${detail}`;
  }

  if (event.notice_type === "notify") {
    if (subType === "poke") {
      const targetId = firstString(event.target_id, event.receiver_id) ?? "unknown";
      return `[QQ poke] User ${userId} poked user ${targetId} in group ${groupId}`;
    }

    if (subType === "lucky_king") {
      return `[QQ notice] User ${userId} was the lucky king in group ${groupId}`;
    }

    if (subType === "honor") {
      const honorType = firstString(event.honor_type, event.title) ?? "honor";
      return `[QQ honor] User ${userId} received ${honorType} in group ${groupId}`;
    }
  }

  return undefined;
}

export function formatOneBotGroupRequest(event: OneBotRequestEvent): string {
  const groupId = event.group_id ?? "unknown";
  const userId = event.user_id ?? "unknown";
  const subType = firstString(event.sub_type, event.action)?.toLowerCase() ?? "";
  const action = subType === "invite" ? "invited the bot to group" : "requested to join group";
  const comment = firstString(event.comment);
  const flag = firstString(event.flag);
  return [
    `[QQ group request] User ${userId} ${action} ${groupId}`,
    comment ? `Comment: ${comment}` : undefined,
    flag ? `Flag: ${flag}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return value;
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1024;
  for (const unit of units) {
    if (amount < 1024) {
      return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${unit}`;
    }
    amount /= 1024;
  }

  return `${amount.toFixed(0)} PB`;
}

function formatDurationSeconds(value: string): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return value;
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }

  return undefined;
}

function inferFileName(file: string | undefined): string | undefined {
  if (!file) {
    return undefined;
  }

  try {
    const parsed = new URL(file);
    const name = parsed.pathname.split("/").filter(Boolean).at(-1);
    return name ? decodeURIComponent(name) : undefined;
  } catch {
    return file.split("/").filter(Boolean).at(-1);
  }
}

function sanitizeFileName(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }

  const sanitized = name
    .replace(/[/\\]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 120);
  return sanitized || undefined;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
