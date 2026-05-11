import {
  type CommandContext,
  type CommandReply,
  definePlugin,
  definePluginCapability,
  definePluginCommand,
  defineGuildFeature,
} from "@karyl-chan/plugin-sdk";
import {
  type Track,
  advance,
  enqueue,
  previous,
  requeueFront,
  reset,
  setCurrent,
  setLoop,
} from "./queue.js";
import {
  formatNowPlaying,
  formatQueueList,
  formatStationList,
  loopBadge,
} from "./format.js";
import { isHttpUrl, isYouTubePlaylistUrl } from "./downloader.js";
import { downloadAndStore } from "./library.js";
import {
  registerWebRoutes,
  setRadioBotRpc,
  setRadioSessionVerifyKey,
} from "./web-routes.js";
import {
  type PlayOutcome,
  playTrack,
  resolveAnyTrack,
  resolvePlaylist,
} from "./resolver.js";

/** Guilds the auto-advance loop ticks over. The SAME Set instance is
 *  threaded into `startAdvanceLoop` (via index.ts) and `registerWebRoutes`
 *  — re-creating it elsewhere would silently break auto-advance. The
 *  `/radio` command handler and the WebUI session routes both `.add()`
 *  here; `processGuild` `.delete()`s when a guild's session goes idle. */
export const seenGuilds = new Set<string>();

/** Plugin key (= manifest plugin.id). Single source of truth — also the
 *  pluginKey half of the `plugin:<key>:webui.access` capability token. */
const PLUGIN_KEY = "karyl-radio";

/** Where the WebUI is reachable from a browser (NOT the Docker-internal
 *  PLUGIN_URL). Used for the `/radio manage` link and the play-response
 *  buttons. Override in production behind a reverse proxy / tunnel. */
const RADIO_PUBLIC_URL = (
  process.env.RADIO_PUBLIC_URL || "http://localhost:903"
).replace(/\/+$/, "");

const EMBED_COLOR = 0x5865f2;

// ── Session WebUI link ────────────────────────────────────────────────────
// Each play/queue/etc response carries a Link button to the session WebUI.
// The URL embeds a 6h bot-signed JWT scoped to this guild's playback
// session; we cache it per guild and re-mint when <30 min remain.
interface CachedToken {
  token: string;
  expiresAt: number;
}
const SESSION_TOKEN_REFRESH_MARGIN_MS = 30 * 60_000;
const sessionTokens = new Map<string, CachedToken>();

async function getSessionToken(
  ctx: CommandContext,
  guildId: string,
): Promise<string | null> {
  const cached = sessionTokens.get(guildId);
  if (
    cached &&
    cached.expiresAt - Date.now() > SESSION_TOKEN_REFRESH_MARGIN_MS
  ) {
    return cached.token;
  }
  const res = (await ctx.botRpc("/api/plugin/auth.session", {
    user_id: ctx.userId,
    kind: "session",
    guild_id: guildId,
  })) as { token?: string; expiresAt?: number } | null;
  if (!res || typeof res.token !== "string") return null;
  sessionTokens.set(guildId, {
    token: res.token,
    expiresAt: typeof res.expiresAt === "number" ? res.expiresAt : Date.now(),
  });
  return res.token;
}

/** Discord component-v1 action row with a single Link button. */
function linkButtonRow(label: string, url: string): unknown {
  return { type: 1, components: [{ type: 2, style: 5, label, url }] };
}

/**
 * Build a playback-command reply: an embed + a "🎛 Open WebUI" link
 * button to the session page. Falls back to a plain embed (no button)
 * if a session token couldn't be minted.
 */
async function playbackReply(
  ctx: CommandContext,
  guildId: string,
  embed: Record<string, unknown>,
): Promise<CommandReply> {
  const token = await getSessionToken(ctx, guildId);
  const components = token
    ? [linkButtonRow("🎛 Open WebUI", `${RADIO_PUBLIC_URL}/?token=${token}`)]
    : undefined;
  // Ephemeral: plugin command replies are deferred ephemeral by the bot,
  // and the button embeds a session token — keep it visible only to the
  // ManageGuild member who invoked it.
  return {
    embeds: [{ color: EMBED_COLOR, ...embed }],
    ...(components ? { components } : {}),
    ephemeral: true,
  };
}

function fmtDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return ` (${m}:${String(s).padStart(2, "0")})`;
}

/** Resolve (if lazy) + play `track` on the bot. Caller `setCurrent`s on ok. */
function startTrack(
  ctx: CommandContext,
  guildId: string,
  track: Track,
): Promise<PlayOutcome> {
  return playTrack(track, (url) =>
    ctx.botRpc("/api/plugin/voice.play", { guild_id: guildId, url }),
  );
}

function parseSource(ctx: CommandContext): string {
  return typeof ctx.options.source === "string" ? ctx.options.source : "";
}

/**
 * Resolve a `/radio play|queue` source to a Track, or return an error
 * string the handler should reply with. (Wraps web-routes' resolveAnyTrack
 * — which can throw for failed YouTube extraction.)
 */
async function resolveSourceOrError(
  source: string,
  userId: string,
): Promise<Track | string> {
  let track: Track | null;
  try {
    track = await resolveAnyTrack(source, userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "extraction failed";
    return `⚠ Couldn't load that source — ${msg.slice(0, 180)}`;
  }
  if (!track) return `⚠ Unknown station / library track / URL: \`${source}\``;
  return track;
}

export default function buildPlugin() {
  return definePlugin({
    key: PLUGIN_KEY,
    name: "Karyl Radio",
    version: "0.6.0",
    description:
      "Internet radio + YouTube audio library with WebUI management & playback control.",
    rpcMethodsUsed: [
      "voice.join",
      "voice.leave",
      "voice.play",
      "voice.stop",
      "voice.status",
      "interactions.respond",
      "interactions.followup",
      "auth.session",
    ],
    storage: { guildKv: false },
    capabilities: [
      definePluginCapability({
        key: "webui.access",
        description:
          "Access the radio admin WebUI (manage / edit / delete library tracks)",
      }),
      definePluginCapability({
        key: "download",
        description:
          "Use /radio download — fetch external audio (YouTube / SoundCloud / direct media) into the library. Copyright-sensitive: grant sparingly.",
      }),
    ],
    guildFeatures: [
      defineGuildFeature({
        key: "radio",
        name: "Karyl Radio",
        description:
          "Internet radio + a YouTube/HTTP audio library: /radio gives voice playback, a queue, the library and a management WebUI. Off by default — enable it per-guild.",
        enabledByDefault: false,
        commands: [
          definePluginCommand({
            name: "radio",
            description: "Internet radio & audio library",
            scope: "guild",
            integrationTypes: ["guild_install"],
            contexts: ["Guild"],
            // Anyone who can join voice can use it; the admin-ish bits
            // are gated separately (download → plugin:karyl-radio:download
            // capability; manage → plugin:karyl-radio:webui.access).
            defaultMemberPermissions: "Connect",
            options: [
              {
                type: "sub_command",
                name: "play",
                description:
                  "Play a station, library track, or URL (replaces current)",
                options: [
                  {
                    type: "string",
                    name: "source",
                    description:
                      "Station key, library track title/ID, or http(s) URL",
                    required: true,
                  },
                ],
              },
              {
                type: "sub_command",
                name: "queue",
                description: "Add a track to the queue",
                options: [
                  {
                    type: "string",
                    name: "source",
                    description:
                      "Station key, library track title/ID, or http(s) URL",
                    required: true,
                  },
                ],
              },
              {
                type: "sub_command",
                name: "download",
                description:
                  "Download audio from a URL (YouTube, SoundCloud, direct media…) to the library",
                options: [
                  {
                    type: "string",
                    name: "url",
                    description:
                      "URL to download (re-uses the file if already saved)",
                    required: true,
                  },
                ],
              },
              {
                type: "sub_command",
                name: "skip",
                description: "Skip the current track and play next in queue",
              },
              {
                type: "sub_command",
                name: "back",
                description: "Go back to the previously played track",
              },
              {
                type: "sub_command",
                name: "loop",
                description: "Set loop mode (off / track / queue)",
                options: [
                  {
                    type: "string",
                    name: "mode",
                    description: "Loop mode",
                    required: true,
                    choices: [
                      { name: "off — no looping", value: "off" },
                      { name: "track — repeat current", value: "track" },
                      { name: "queue — cycle the queue", value: "queue" },
                    ],
                  },
                ],
              },
              {
                type: "sub_command",
                name: "stop",
                description: "Stop playback, clear queue and leave voice",
              },
              {
                type: "sub_command",
                name: "np",
                description: "Show what's currently playing (+ WebUI link)",
              },
              {
                type: "sub_command",
                name: "queuelist",
                description: "Show the current queue",
              },
              {
                type: "sub_command",
                name: "stations",
                description: "List available radio stations",
              },
              {
                type: "sub_command",
                name: "manage",
                description:
                  "Get a private link to the radio admin WebUI (requires permission)",
              },
            ],
            handler: async (ctx): Promise<CommandReply> => {
              const guildId = ctx.guildId;
              if (!guildId)
                return "⚠ This command must be used inside a guild.";
              seenGuilds.add(guildId);

              const userId = ctx.userId;
              const sub = ctx.subCommandName;

              switch (sub) {
                case "stations":
                  return formatStationList();

                case "manage": {
                  const res = (await ctx.botRpc("/api/plugin/auth.session", {
                    user_id: userId,
                    kind: "manage",
                  })) as { allowed?: boolean; token?: string } | null;
                  // botRpc returns null on a non-2xx (e.g. the bot hasn't
                  // approved this plugin's `auth.session` RPC scope yet), and a
                  // truthy { allowed:false } when the *user* lacks the capability.
                  if (res === null) {
                    return {
                      content:
                        "⚠ Couldn't mint a login link — the bot rejected the request " +
                        `(plugin \`${PLUGIN_KEY}\` may need its \`auth.session\` RPC scope approved, or the bot is unavailable).`,
                      ephemeral: true,
                    };
                  }
                  if (res.allowed !== true || typeof res.token !== "string") {
                    return {
                      content:
                        `⚠ You're not allowed to manage Karyl Radio. Need the \`plugin:${PLUGIN_KEY}:webui.access\` capability ` +
                        "(bot owners and admins are exempt). Ask an admin to grant it to your role.",
                      ephemeral: true,
                    };
                  }
                  return {
                    content:
                      "🔧 **Karyl Radio — admin WebUI**\nManage downloaded tracks: search, edit metadata, delete. Link valid ~15 minutes.",
                    components: [
                      linkButtonRow(
                        "🔧 Open admin WebUI",
                        `${RADIO_PUBLIC_URL}/?token=${res.token}`,
                      ),
                    ],
                    ephemeral: true,
                  };
                }

                case "np": {
                  const status = (await ctx.botRpc("/api/plugin/voice.status", {
                    guild_id: guildId,
                  })) as { channelId?: string | null } | null;
                  return playbackReply(ctx, guildId, {
                    title: "🎶 Now playing",
                    description: formatNowPlaying(
                      guildId,
                      status?.channelId ?? null,
                    ),
                  });
                }

                case "queuelist":
                  return playbackReply(ctx, guildId, {
                    title: "📜 Queue",
                    description: formatQueueList(guildId),
                  });

                case "download": {
                  if (!ctx.hasCapability("download")) {
                    return {
                      content:
                        `⚠ You need the \`plugin:${PLUGIN_KEY}:download\` capability to download external audio — ` +
                        "ask an admin to grant it to your role (bot owners/admins are exempt). " +
                        "Everything else under `/radio` works without it.",
                      ephemeral: true,
                    };
                  }
                  const url =
                    typeof ctx.options.url === "string" ? ctx.options.url : "";
                  if (!url) return "⚠ Please provide a URL.";
                  if (!isHttpUrl(url)) {
                    return "⚠ That doesn't look like an http(s) URL.";
                  }
                  if (isYouTubePlaylistUrl(url)) {
                    return "⚠ That's a playlist — use `/radio queue <playlist URL>` to queue it. `/radio download` takes a single track URL.";
                  }
                  try {
                    const { track, alreadyExisted } = await downloadAndStore(
                      url,
                      userId,
                    );
                    return alreadyExisted
                      ? `↩ Already in library: **${track.title}**${fmtDuration(track.duration)} — use \`/radio play ${track.title}\` (or paste the URL again).`
                      : `✅ Downloaded **${track.title}**${fmtDuration(track.duration)} to library.`;
                  } catch (err) {
                    const msg =
                      err instanceof Error ? err.message : "unknown error";
                    ctx.log.error(`download failed: ${msg}`, { url });
                    return `⚠ Download failed: ${msg.slice(0, 200)}`;
                  }
                }

                case "loop": {
                  const mode =
                    typeof ctx.options.mode === "string"
                      ? ctx.options.mode
                      : "off";
                  if (mode !== "off" && mode !== "track" && mode !== "queue") {
                    return "⚠ mode must be one of: off / track / queue";
                  }
                  setLoop(guildId, mode);
                  return playbackReply(ctx, guildId, {
                    description: `${loopBadge(mode)} Loop mode set to **${mode}**.`,
                  });
                }

                case "stop": {
                  await Promise.all([
                    ctx.botRpc("/api/plugin/voice.stop", { guild_id: guildId }),
                    ctx.botRpc("/api/plugin/voice.leave", {
                      guild_id: guildId,
                    }),
                  ]);
                  reset(guildId);
                  sessionTokens.delete(guildId);
                  return "✓ Stopped, queue cleared, and left voice.";
                }

                case "skip": {
                  // Skip past unresolvable items (deleted/private playlist
                  // entries) — up to a few hops.
                  for (let attempt = 0; attempt < 5; attempt++) {
                    const next = advance(guildId);
                    if (!next) {
                      await ctx.botRpc("/api/plugin/voice.stop", {
                        guild_id: guildId,
                      });
                      return "Queue empty — stopped playback.";
                    }
                    const o = await startTrack(ctx, guildId, next);
                    if (o.ok) {
                      setCurrent(guildId, o.track);
                      return playbackReply(ctx, guildId, {
                        description: `⏭ Skipped. Now playing **${o.track.label}**.`,
                        ...(o.track.coverUrl
                          ? { thumbnail: { url: o.track.coverUrl } }
                          : {}),
                      });
                    }
                    if (o.reason === "play-failed") {
                      requeueFront(guildId, next);
                      return playbackReply(ctx, guildId, {
                        description: `⚠ Couldn't start **${next.label}** — re-queued, try again.`,
                      });
                    }
                    // unresolvable — already dropped from the queue; try the next.
                    ctx.log.warn(`skip: dropped unplayable track ${next.url}`);
                  }
                  return playbackReply(ctx, guildId, {
                    description:
                      "⚠ Skipped several unplayable tracks — try again.",
                  });
                }

                case "back": {
                  const prev = previous(guildId);
                  if (!prev)
                    return "↩ Nothing in the play history to go back to.";
                  const o = await startTrack(ctx, guildId, prev);
                  if (o.ok) setCurrent(guildId, o.track);
                  else if (!prev.needsResolve) setCurrent(guildId, prev);
                  return playbackReply(ctx, guildId, {
                    description: o.ok
                      ? `⏮ Back to **${o.track.label}**.`
                      : `⚠ Failed to start **${prev.label}**.`,
                    ...(o.ok && o.track.coverUrl
                      ? { thumbnail: { url: o.track.coverUrl } }
                      : {}),
                  });
                }

                case "queue": {
                  const source = parseSource(ctx);
                  if (isYouTubePlaylistUrl(source)) {
                    let tracks: Track[];
                    try {
                      tracks = await resolvePlaylist(source, userId);
                    } catch (err) {
                      return `⚠ Couldn't expand that playlist — ${(err instanceof Error ? err.message : "error").slice(0, 180)}`;
                    }
                    if (tracks.length === 0)
                      return "⚠ That playlist is empty or unavailable.";
                    for (const t of tracks) enqueue(guildId, t);
                    return playbackReply(ctx, guildId, {
                      description: `➕ Queued **${tracks.length}** track${tracks.length === 1 ? "" : "s"} from the playlist.`,
                    });
                  }
                  const resolved = await resolveSourceOrError(source, userId);
                  if (typeof resolved === "string") return resolved;
                  const position = enqueue(guildId, resolved);
                  return playbackReply(ctx, guildId, {
                    description: `➕ Queued **${resolved.label}** (position ${position}).`,
                    ...(resolved.coverUrl
                      ? { thumbnail: { url: resolved.coverUrl } }
                      : {}),
                  });
                }

                case "play": {
                  const source = parseSource(ctx);
                  const joinFirst = async (): Promise<string | null> => {
                    const joined = await ctx.botRpc("/api/plugin/voice.join", {
                      guild_id: guildId,
                      user_id: userId,
                    });
                    return joined
                      ? null
                      : "⚠ Could not join voice — make sure you're in a voice channel and the bot has permission.";
                  };

                  if (isYouTubePlaylistUrl(source)) {
                    let tracks: Track[];
                    try {
                      tracks = await resolvePlaylist(source, userId);
                    } catch (err) {
                      return `⚠ Couldn't expand that playlist — ${(err instanceof Error ? err.message : "error").slice(0, 180)}`;
                    }
                    if (tracks.length === 0)
                      return "⚠ That playlist is empty or unavailable.";
                    const joinErr = await joinFirst();
                    if (joinErr) return joinErr;
                    for (const t of tracks) enqueue(guildId, t);
                    // Start the first that resolves (skip a few dead ones).
                    let started: Track | null = null;
                    for (let i = 0; i < 5 && !started; i++) {
                      const next = advance(guildId);
                      if (!next) break;
                      const o = await startTrack(ctx, guildId, next);
                      if (o.ok) {
                        setCurrent(guildId, o.track);
                        started = o.track;
                      } else if (o.reason === "play-failed") {
                        requeueFront(guildId, next);
                        break;
                      }
                    }
                    return playbackReply(ctx, guildId, {
                      title: started
                        ? "▶️ Playing playlist"
                        : "▶️ Playlist queued",
                      description: started
                        ? `**${started.label}** — ${tracks.length} track${tracks.length === 1 ? "" : "s"} queued.`
                        : `Queued ${tracks.length} track${tracks.length === 1 ? "" : "s"}, but couldn't start the first one.`,
                      ...(started?.coverUrl
                        ? { thumbnail: { url: started.coverUrl } }
                        : {}),
                    });
                  }

                  const resolved = await resolveSourceOrError(source, userId);
                  if (typeof resolved === "string") return resolved;
                  const joinErr = await joinFirst();
                  if (joinErr) return joinErr;
                  const o = await startTrack(ctx, guildId, resolved);
                  if (o.ok) setCurrent(guildId, o.track);
                  return playbackReply(ctx, guildId, {
                    title: o.ok ? "▶️ Now playing" : "⚠ Playback failed",
                    description: o.ok
                      ? `**${o.track.label}**`
                      : `Joined voice but failed to start **${resolved.label}**.`,
                    ...(o.ok && o.track.coverUrl
                      ? { thumbnail: { url: o.track.coverUrl } }
                      : {}),
                  });
                }

                default:
                  return `⚠ Unknown subcommand \`${sub ?? "(none)"}\``;
              }
            },
          }),
        ],
      }),
    ],
    onReady: async (server) => {
      await registerWebRoutes(server, PLUGIN_KEY, RADIO_PUBLIC_URL, seenGuilds);
    },
  });
}

// Re-export so index.ts can wire deferred dependencies (bot RPC client +
// the bot's plugin-session JWT verify key) into the WebUI routes once
// start() resolves (onReady runs before the lifecycle client exists).
export { setRadioBotRpc, setRadioSessionVerifyKey };
