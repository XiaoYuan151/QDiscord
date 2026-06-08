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

QDiscord accepts OneBot messages in either string CQ format or array segment format.
