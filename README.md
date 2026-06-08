# QDiscord

QDiscord bridges Discord channels and QQ groups through a Discord bot plus NapCat's OneBot v11 WebSocket server.

It supports:

- QQ group text to Discord channel text
- QQ images to Discord file attachments
- QQ `[CQ:face]` to Discord emoji text through configurable mappings
- QQ `[CQ:at]` to Discord user mentions through configurable mappings
- Discord text to QQ group text
- Discord user mentions to QQ `[CQ:at]` through configurable mappings
- Discord image attachments and unmapped custom emojis to QQ images
- Discord mapped custom emojis to QQ `[CQ:face]`
- Discord embeds, stickers, images, audio, video, and generic files to QQ segments
- Discord polls to QQ text fallbacks with answer and vote summaries
- QQ image, voice, video, and file segments to Discord attachments when OneBot exposes HTTP URLs
- Basic reply, edit, delete/recall, and Discord bulk-delete synchronization
- Discord and QQ reaction add/remove notices, including Discord reaction-clear summaries
- Discord thread messages through bridge pairs configured on the parent channel
- Join/leave notices, best-effort QQ typing notices, queue retries, health endpoints, and `/bridge status`

## Requirements

- Node.js 20 or newer
- A Discord application bot token
- Discord bot permissions: View Channel, Send Messages, Attach Files, Read Message History
- Discord Developer Portal: enable the Message Content Intent for the bot
- NapCat configured with a OneBot v11 WebSocket server, for example `ws://127.0.0.1:3001`

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```bash
DISCORD_TOKEN=your-token
NAPCAT_WS_URL=ws://127.0.0.1:3001
BRIDGE_PAIRS=discordChannelId:qqGroupId
```

Multiple bridge pairs can be separated by commas, semicolons, or newlines:

```bash
BRIDGE_PAIRS=123456789012345678:987654321,234567890123456789:876543210
```

Each pair can include an optional direction:

```bash
BRIDGE_PAIRS=123456789012345678:987654321:both
BRIDGE_PAIRS=123456789012345678:987654321:discord-to-qq
BRIDGE_PAIRS=123456789012345678:987654321:qq-to-discord
```

## Mention Mapping

Discord and QQ have different user IDs, so real mentions need explicit mapping:

```bash
QQ_TO_DISCORD_USER_MAP=123456789:111111111111111111
DISCORD_TO_QQ_USER_MAP=111111111111111111:123456789
```

Without a mapping, mentions are preserved as readable plain text like `@QQ:123456789` or `@username`.

## Face and Emoji Mapping

QQ face IDs and Discord custom emoji IDs are server-specific. Configure the mappings you want:

```bash
CQ_FACE_EMOJI_MAP=14:<:qq_smile:222222222222222222>
DISCORD_EMOJI_CQ_FACE_MAP=222222222222222222:14,qq_smile:14
```

If a Discord custom emoji is not mapped, QDiscord sends it to QQ as an image from Discord's CDN.
You can also map standard Unicode emoji by using the emoji itself as the key:

```bash
DISCORD_EMOJI_CQ_FACE_MAP=🙂:14
```

## Operational Settings

QDiscord queues outbound bridge work to avoid bursts against Discord or NapCat:

```bash
QUEUE_CONCURRENCY=1
QUEUE_MAX_PENDING=1000
QUEUE_MIN_DELAY_MS=250
QUEUE_MAX_RETRIES=3
QUEUE_RETRY_BASE_DELAY_MS=1000
SHUTDOWN_DRAIN_TIMEOUT_MS=10000
```

Reply/delete links are retained in memory with bounded cleanup:

```bash
MESSAGE_LINK_TTL_MS=86400000
MESSAGE_LINK_MAX_ENTRIES=10000
```

Set `MESSAGE_LINK_STORE_PATH` to persist reply/delete mappings across restarts:

```bash
MESSAGE_LINK_STORE_PATH=.qdiscord-links.json
```

NapCat reconnects use bounded exponential backoff:

```bash
NAPCAT_RECONNECT_INITIAL_MS=1000
NAPCAT_RECONNECT_MAX_MS=30000
NAPCAT_HEARTBEAT_INTERVAL_MS=30000
NAPCAT_HEARTBEAT_TIMEOUT_MS=10000
ONEBOT_ACTION_TIMEOUT_MS=15000
```

Local health endpoints are enabled by default:

```bash
HEALTH_HOST=127.0.0.1
HEALTH_PORT=8787
```

- `GET /healthz`: process liveness
- `GET /readyz`: Discord and NapCat readiness
- `GET /status`: structured bridge status

The Discord bot registers `/bridge status` by default. Change `STATUS_COMMAND_NAME` if that command name conflicts. Leave `STATUS_COMMAND_GUILD_IDS` empty for a global command, or set guild IDs for immediate guild-scoped registration:

```bash
STATUS_COMMAND_GUILD_IDS=123456789012345678
```

By default, `/bridge status` is limited to members with Manage Server. To allow specific Discord users without that permission, set:

```bash
STATUS_COMMAND_ALLOWED_USER_IDS=111111111111111111,222222222222222222
```

Generic Discord file attachments use NapCat's `upload_group_file` action by default:

```bash
UPLOAD_QQ_FILES=true
```

If your NapCat deployment cannot upload remote Discord CDN URLs, set this to `false`; QDiscord will send file links as text fallback messages.

## Filtering and Safety

Optional filters let you limit bridge traffic:

```bash
ALLOWED_DISCORD_CHANNEL_IDS=123456789012345678
BLOCKED_DISCORD_USER_IDS=
BLOCKED_QQ_USER_IDS=
```

`ALLOW_EVERYONE_MENTIONS=false` is the safe default. QQ `@all` is rendered visibly in Discord, but Discord mentions are restricted with `allowedMentions` unless you explicitly enable broad pings.

## Run

Development mode:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

Tests:

```bash
npm test
```

## NapCat Notes

In NapCat, enable the OneBot v11 WebSocket server and set the URL/port to match `NAPCAT_WS_URL`. If you configure an access token in NapCat, set the same value in `NAPCAT_ACCESS_TOKEN`; QDiscord sends it as both a WebSocket query parameter and `Authorization: Bearer ...` header for compatibility.

QDiscord accepts OneBot messages in either string CQ format or array segment format. Message reply, edit, and delete links are best-effort; they reset on restart unless `MESSAGE_LINK_STORE_PATH` is configured.
