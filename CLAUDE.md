# chat-summary-tg-bot

Telegram bot that stores group messages in MongoDB Atlas and writes summaries on demand
(`/summary [N]`, `/summary_m|_h|_d [N]`) with Gemini, in Ukrainian. NestJS 10 + nestjs-telegraf.
User-facing text is Ukrainian; code, comments and commits are English.

## How it works

- `messages/`: every non-command group message is stored (`MessageIngestHandler` calls `next()`);
  daily cleanup by age, per-chat and total caps (Atlas M0 is 512 MB); admin alert near the cap.
- `transcription/`: voices are transcribed lazily, only when they fall into a summary: first from
  the external transcription bot's reply in the chat, else via audio-transcription-bot's HTTP API
  (`TRANSCRIPTION_SERVICE_URL`, `TRANSCRIPTION_SERVICE_TOKEN`). A voice that cannot be transcribed
  is left out and counted in the note, it does not fail the summary.
- `summary/`: one summary per chat at a time (`SummaryLockService`); limits drop the oldest
  messages. `ai/`: Gemini with a `GEMINI_TIMEOUT_MS` timeout (a hung call held the chat's lock
  forever) and one retry on network errors; quota errors are not retried.
- Env aliases: `TELEGRAM_BOT_TOKEN` → `BOT_TOKEN`, `MONGODB_URI` → `DB_URL`. Port 4206.

## Shared plumbing: @randan/tg-bot-kit

`BotKitModule.forRoot({ name, commands })` in `app.module.ts` gives `GET /health` (503 when a
registered check fails; the Docker healthcheck uses it), the admin-only unlisted **`/diag`**
(version from `GIT_SHA`, start time, checks, the sections services register through
`BotKitRegistry`) and the command menu, written to Telegram on startup (do not edit it in
BotFather). Env parsing, `FailureAlert` (admin alert once per hour + one "✅" on recovery),
`retry`, `withTimeout`, `createLimiter`, `isChatGone` come from the kit too: fix shared
behaviour there, not by copying code into a bot. `BotKitModule` must stay in the Telegraf
`include` list, or `/diag` is not picked up.

## Running, testing, deploying

- `npm run lint`, `npm run format:check`, `npm run build`, `npm test` (`npm run test:cov` enforces
  the coverage threshold). Unit tests use fakes, no network or database; `src/app.wiring.spec.ts`
  builds the real module graph, so a provider Nest cannot resolve fails in CI, not on the Pi.
- Every push to `master` runs the shared workflow `Randan/tg-bot-kit/.github/workflows/bot.yml@v1`:
  the checks, then the deploy to the Pi (R5oRR) over Tailscale. Nothing deploys if a check fails.
- `package-lock.json`: regenerate it on Linux (e.g. `docker run --rm -v "$PWD":/app -w /app
  node:24-alpine npm install --package-lock-only`). A lockfile written on macOS can miss Linux-only
  optional packages, and `npm ci` in CI then fails.
- On the Pi in `~/projects/<repo>`; `.env` exists **only on the Pi** (see `.env.example`).
  Logs go to journald and survive deploys: `docker logs <container>`.

## Debugging without shell access (cloud session, phone)

Send `/diag` to the bot as the admin (`ADMIN_TELEGRAM_ID`). The Pi is reachable only over
Tailscale; sudo needs the user's password. Say what could not be verified instead of guessing.
