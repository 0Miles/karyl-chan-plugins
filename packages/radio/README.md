# @karyl-chan/plugin-radio

Voice/audio plugin for [karyl-chan](https://github.com/0Miles/karyl-chan):
internet radio + a YouTube/HTTP audio library, with a queue, an
auto-advance loop, and a small management WebUI. The only stateful
plugin in the family — it holds per-guild voice-channel state, the queue,
and the advance loop, so it keeps its own package and docker service.

## `/radio`

| Sub-command | What it does |
|---|---|
| `play <source>` | Join your voice channel and play a station / library track / http(s) URL / YouTube playlist (replaces current) |
| `queue <source>` | Append to the queue (also expands a YouTube playlist) |
| `download <url>` | Download audio from a URL (YouTube, SoundCloud, direct media…) into the library |
| `skip` / `back` | Skip to next / go back to the previous track |
| `loop <off\|track\|queue>` | Set the loop mode |
| `stop` | Stop, clear the queue, leave voice |
| `np` / `queuelist` | Now-playing (+ WebUI link) / show the queue |
| `stations` | List the built-in radio stations |
| `manage` | Get a private link to the admin WebUI (requires the `plugin:karyl-radio:webui.access` capability — bot owners/admins exempt) |

`source` for `play`/`queue` auto-resolves a station key, a library track
title/ID, an http(s) media URL, or a YouTube URL.

## WebUI

`/radio np`, `/radio manage`, and the play replies hand back a link
(`RADIO_PUBLIC_URL`, default `http://localhost:903`) carrying a short-lived
`plugin-session` JWT. The WebUI server (in `src/web-routes.ts`) verifies
that token **offline** with the bot's Ed25519 public key (the SDK's
`verifyPluginSession`) — there's no shared secret; the bot signs with a
private key that never leaves it. `manage` tokens carry the user's
capabilities and gate the library-management routes; session tokens are
guild-scoped and gate playback control. An admin rotating the bot's JWT
signing key invalidates outstanding links; the plugin picks up the new
public key on its next heartbeat.

## Runtime dependencies

- the bot's voice RPC (`voice.join` / `voice.play` / `voice.status` / …) — the plugin does no audio I/O of its own beyond resolving/downloading
- `ffmpeg` and `yt-dlp` in the container (see `Dockerfile.radio`)
- volumes for the library and cover images (`MUSIC_DIR` / `COVER_DIR`; mapped in the monorepo `docker-compose.yml`)

## Setup

1. Bring up the bot first (creates the `karyl-chan-net` network). Have an
   admin run `POST /api/plugins/setup-secret { pluginKey: "karyl-radio" }`
   and put the returned cleartext in `KARYL_PLUGIN_SETUP_SECRET_RADIO` in
   the monorepo's root `.env`.
2. `COMPOSE_PROFILES` (root `.env`) must include `radio`.
3. `pnpm docker:up` (from the monorepo root) — or `docker compose up --build -d karyl-radio-plugin`.

On startup the plugin registers with the bot, gets a token + the dispatch
HMAC key + the JWT verify public key, and starts a ~30 s heartbeat; the
bot then registers the `/radio` command with Discord.

Edit `src/stations.ts` to change the built-in station list — each URL must
serve `Content-Type: audio/*` directly (HLS / playlist URLs aren't
supported by the ffmpeg pipeline).

## License

MIT (matches karyl-chan).
