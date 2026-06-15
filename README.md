# Chat Summary Telegram Bot

Telegram bot that stores group chat messages in MongoDB Atlas and generates summaries on demand with lazy transcription.

## Commands

- `/summary [count]` — summary for the last N messages
- `/summary_m [minutes]` — summary for the last N minutes
- `/summary_h [hours]` — summary for the last N hours
- `/summary_d [days]` — summary for the last N days

If a parameter is omitted, the default value from env is used.

## Setup

1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies: `npm install`
3. Run in development: `npm run start:dev`

## AI provider

Summaries are generated via a pluggable AI provider. Default:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
```

## Docker (separate containers on the same server)

Start `audio-transcription-bot` first, then this bot:

```bash
# in audio-transcription-bot/
docker compose up -d --build

# in chat-summary-tg-bot/
docker compose up -d --build
```

Default in `.env.example`:

```env
TRANSCRIPTION_SERVICE_URL=http://host.docker.internal:4205
```

`docker-compose.yml` adds `extra_hosts: host.docker.internal:host-gateway` so the summary container can reach the transcription HTTP API via the host's published port.

## Notes

- Disable Telegram group privacy mode for the bot to receive all group messages.
- Voice transcription runs lazily only when a message is included in a summary request.
- Transcription results are cached in MongoDB.
- Set `TRANSCRIPTION_BOT_USERNAME` if a Telegram transcription bot is also present in the chat.
