import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { createReadStream, readFileSync } from "fs";
import { stat } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  hasPluginCapability,
  verifyPluginSession,
  type PluginSessionClaims,
} from "@karyl-chan/plugin-sdk";
import { getMusicDir, isHttpUrl } from "./downloader.js";
import {
  downloadAndStore,
  findBySourceUrl,
  getTrack,
  removeTrack,
  searchTracks,
  syncWithDisk,
  updateTrack,
  type TrackMetadataPatch,
} from "./library.js";
import {
  coverFilePath,
  deleteCoverFor,
  extForMime,
  isSafeCoverFilename,
  mimeForCoverFile,
  saveCover,
} from "./covers.js";
import {
  type LoopMode,
  type Track,
  clearQueue,
  dequeueAt,
  enqueue,
  getState,
  setAutoplay,
  setLoop,
} from "./queue.js";
import { doNext, doPrev } from "./playback-actions.js";
import * as nowPlaying from "./now-playing.js";
import {
  isYouTubePlaylistUrl,
  resolveAnyTrack,
  resolvePlaylist,
} from "./resolver.js";

/** capability key (plugin-local) that gates the admin/manage WebUI routes. */
const WEBUI_CAP = "webui.access";
/** Files in the music dir that are NOT audio and must never be streamed. */
const NON_AUDIO_RE = /(^library\.json$)|(\.tmp$)/;

// ── Deferred wiring from index.ts ─────────────────────────────────────────
// The WebUI routes need things the SDK only produces *after* start()
// resolves — the bot RPC client (voice.play / voice.status), the
// Ed25519 public key the bot hands back at register (for verifying
// plugin-session JWTs), and the bot-provided publicBaseUrl. These routes
// are registered in `onReady`, which runs before the lifecycle client
// exists, so index.ts injects all three once start() resolves.
type BotRpc = (path: string, body?: unknown) => Promise<unknown | null>;
let _botRpc: BotRpc | null = null;
export function setRadioBotRpc(fn: BotRpc): void {
  _botRpc = fn;
}

let _sessionVerifyKey: (() => string | null) | null = null;
/** Wire the getter for the bot's plugin-session JWT verify key (SPKI PEM). */
export function setRadioSessionVerifyKey(getter: () => string | null): void {
  _sessionVerifyKey = getter;
}

let _publicBaseUrlGetter: (() => string | undefined) | null = null;
/** Wire the getter for the SDK-provided publicBaseUrl (set after start()). */
export function setRadioPublicBaseUrl(getter: () => string | undefined): void {
  _publicBaseUrlGetter = getter;
}

/** Env-var fallback — imported from plugin.ts via the same module. */
let _publicUrlEnvFallback: string | undefined;
/** Set the env-var fallback value (called once from plugin.ts at module init). */
export function setPublicUrlEnvFallback(value: string | undefined): void {
  _publicUrlEnvFallback = value;
}

/**
 * Effective browser-reachable base URL for this plugin's HTTP surface.
 * Precedence: SDK publicBaseUrl (from bot) → RADIO_PUBLIC_URL env → last-resort default.
 */
export function effectiveBase(): string {
  const sdkUrl = _publicBaseUrlGetter?.();
  if (sdkUrl) return sdkUrl.replace(/\/+$/, "");
  if (_publicUrlEnvFallback) return _publicUrlEnvFallback;
  return "http://localhost:903";
}

const activeDownloads = new Map<
  string,
  { url: string; progress: number; status: string }
>();
const MAX_CONCURRENT_DOWNLOADS = 3;

/** Validate a `:filename` path param: single segment, audio file only. */
function safeAudioName(filename: string): boolean {
  return (
    !filename.includes("..") &&
    !filename.includes("/") &&
    !filename.includes("\\") &&
    !NON_AUDIO_RE.test(filename)
  );
}

const LOOP_MODES: LoopMode[] = ["off", "track", "queue"];

/** WebUI-facing shape of a track (no internal URLs leaked). */
function publicTrack(t: Track): Record<string, unknown> {
  return {
    label: t.label,
    queuedBy: t.queuedBy,
    ...(t.queuedByName ? { queuedByName: t.queuedByName } : {}),
    ...(t.trackId ? { trackId: t.trackId } : {}),
    ...(t.coverUrl ? { coverUrl: t.coverUrl } : {}),
  };
}

/** Build the playback-session snapshot the WebUI polls. */
async function sessionSnapshot(
  guildId: string,
): Promise<Record<string, unknown>> {
  const s = getState(guildId);
  let channelId: string | null = null;
  if (_botRpc) {
    const status = (await _botRpc("/api/plugin/voice.status", {
      guild_id: guildId,
    }).catch(() => null)) as { channelId?: string | null } | null;
    channelId = status?.channelId ?? null;
  }
  return {
    guildId,
    channelId,
    loop: s?.loop ?? "off",
    autoplay: s?.autoplay ?? false,
    current: s?.current ? publicTrack(s.current) : null,
    queue: (s?.queue ?? []).map(publicTrack),
    queueLength: s?.queue.length ?? 0,
    hasPrev: (s?.history.length ?? 0) > 0,
    // Played this session, recency-ordered (oldest first, distinct).
    // Each item carries a stable `seq` the WebUI sends to /replay/:seq.
    played: (s?.playLog ?? []).map((e) => ({
      ...publicTrack(e.track),
      seq: e.seq,
    })),
  };
}

/**
 * Sync the public now-playing message (best effort), then return the
 * session snapshot — the response shape every WebUI playback-mutating
 * route hands back. The plain `sessionSnapshot` (no sync) backs the GET
 * poll, which must NOT edit Discord on every refresh.
 */
async function syncAndSnapshot(
  guildId: string,
): Promise<Record<string, unknown>> {
  if (_botRpc) await nowPlaying.sync(guildId, _botRpc).catch(() => null);
  return sessionSnapshot(guildId);
}

/** Max upload size for a cover image. */
const MAX_COVER_BYTES = 5 * 1024 * 1024;

export async function registerWebRoutes(
  server: FastifyInstance,
  pluginKey: string,
  /**
   * Getter for the browser-reachable base URL — called per-request so a
   * late-arriving publicBaseUrl from the bot is reflected immediately.
   * Used to build cover image URLs and to inject `window.__PLUGIN_BASE__`
   * into the served HTML.
   */
  getEffectiveBase: () => string,
  /**
   * The set of guilds the auto-advance loop ticks over (owned by
   * plugin.ts). The advance loop is the ONLY thing that auto-plays the
   * next queued track when the current one ends, and it drops a guild
   * from this set the moment its session goes idle — so every WebUI
   * action that adds to the queue or moves playback must (re-)register
   * the guild here, or playback dies after the current track.
   */
  seenGuilds: Set<string>,
): Promise<void> {
  await server.register(fastifyMultipart, {
    limits: { fileSize: MAX_COVER_BYTES, files: 1, fields: 4 },
  });

  /** Re-register a guild with the auto-advance loop after a WebUI playback action. */
  const keepAdvancing = (guildId: string): void => {
    seenGuilds.add(guildId);
  };

  /** Verify the Bearer plugin-session JWT. Returns claims or null (after replying). */
  function auth(
    request: FastifyRequest,
    reply: FastifyReply,
  ): PluginSessionClaims | null {
    const verifyKey = _sessionVerifyKey?.() ?? null;
    if (!verifyKey) {
      // The bot hands this key back in the register response. Null means
      // either the first register hasn't completed yet, or the bot is too
      // old to provide it (pre-Ed25519-plugin-session bot).
      reply.code(503).send({
        error:
          "session verification unavailable — plugin not yet registered, or the bot is too old to issue a verification key",
      });
      return null;
    }
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      reply.code(401).send({ error: "Missing authorization" });
      return null;
    }
    const claims = verifyPluginSession(token, verifyKey);
    if (!claims) {
      reply.code(401).send({ error: "Invalid or expired token" });
      return null;
    }
    return claims;
  }

  /** Manage-WebUI gate: token must carry `plugin:<key>:webui.access` (or `admin`). */
  function authManage(
    request: FastifyRequest,
    reply: FastifyReply,
  ): PluginSessionClaims | null {
    const claims = auth(request, reply);
    if (!claims) return null;
    if (!hasPluginCapability(claims.capabilities, pluginKey, WEBUI_CAP)) {
      reply.code(403).send({
        error: `Missing capability plugin:${pluginKey}:${WEBUI_CAP} — ask an admin to grant it to your role.`,
      });
      return null;
    }
    return claims;
  }

  /** Session gate: token must be scoped to the guild in the path. */
  function authSession(
    request: FastifyRequest,
    reply: FastifyReply,
    guildId: string,
  ): PluginSessionClaims | null {
    const claims = auth(request, reply);
    if (!claims) return null;
    if (claims.guildId !== guildId) {
      reply.code(403).send({ error: "Token is not valid for this session" });
      return null;
    }
    return claims;
  }

  // Sync library with disk once on route registration.
  void syncWithDisk();

  // ── Manage WebUI: library management ────────────────────────────────────
  server.get<{ Querystring: { q?: string } }>(
    "/api/tracks",
    async (request, reply) => {
      if (!authManage(request, reply)) return;
      const tracks = await searchTracks(request.query?.q ?? "");
      return { tracks };
    },
  );

  server.get<{ Params: { id: string } }>(
    "/api/tracks/:id",
    async (request, reply) => {
      if (!authManage(request, reply)) return;
      const track = await getTrack(request.params.id);
      if (!track) return reply.code(404).send({ error: "Not found" });
      return { track };
    },
  );

  server.patch<{ Params: { id: string } }>(
    "/api/tracks/:id",
    async (request, reply) => {
      if (!authManage(request, reply)) return;
      let body: TrackMetadataPatch;
      try {
        body =
          typeof request.body === "string"
            ? JSON.parse(request.body)
            : (request.body as TrackMetadataPatch);
      } catch {
        return reply.code(400).send({ error: "Invalid JSON" });
      }
      if (!body || typeof body !== "object") {
        return reply.code(400).send({ error: "body must be an object" });
      }
      try {
        const track = await updateTrack(request.params.id, {
          title: body.title,
          album: body.album,
          author: body.author,
          coverUrl: body.coverUrl,
        });
        if (!track) return reply.code(404).send({ error: "Not found" });
        return { track };
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : "invalid input",
        });
      }
    },
  );

  server.delete<{ Params: { id: string } }>(
    "/api/tracks/:id",
    async (request, reply) => {
      if (!authManage(request, reply)) return;
      const ok = await removeTrack(request.params.id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    },
  );

  // Upload an image file to use as the track's cover. multipart/form-data
  // with a single `file` part. Stored under COVER_DIR/<trackId>.<ext>;
  // coverUrl is set to <effectiveBase()>/cover/<filename>.
  server.post<{ Params: { id: string } }>(
    "/api/tracks/:id/cover",
    async (request, reply) => {
      if (!authManage(request, reply)) return;
      const id = request.params.id;
      const track = await getTrack(id);
      if (!track) return reply.code(404).send({ error: "Not found" });
      let file;
      try {
        file = await request.file();
      } catch {
        return reply.code(400).send({ error: "Expected a multipart upload" });
      }
      if (!file) return reply.code(400).send({ error: "No file uploaded" });
      const ext = extForMime(file.mimetype || "");
      if (!ext) {
        return reply
          .code(415)
          .send({ error: "Unsupported image type (use jpeg/png/webp/gif)" });
      }
      let buf: Buffer;
      try {
        buf = await file.toBuffer();
      } catch {
        return reply
          .code(413)
          .send({ error: `Image too large (max ${MAX_COVER_BYTES >> 20} MB)` });
      }
      if (buf.length === 0) {
        return reply.code(400).send({ error: "Empty file" });
      }
      const filename = await saveCover(id, buf, ext);
      const coverUrl = `${getEffectiveBase()}/cover/${filename}`;
      try {
        const updated = await updateTrack(id, { coverUrl });
        return { track: updated };
      } catch (err) {
        // updateTrack rejected the URL (e.g. effectiveBase() misconfigured)
        // — don't leave the just-written file orphaned.
        await deleteCoverFor(id);
        return reply.code(500).send({
          error: `Couldn't set cover URL: ${err instanceof Error ? err.message : "error"}`,
        });
      }
    },
  );

  server.post("/api/tracks/download", async (request, reply) => {
    const claims = authManage(request, reply);
    if (!claims) return;
    let body: { url?: string };
    try {
      body =
        typeof request.body === "string"
          ? JSON.parse(request.body)
          : (request.body as { url?: string });
    } catch {
      return reply.code(400).send({ error: "Invalid JSON" });
    }
    const url = body?.url;
    if (!url || typeof url !== "string") {
      return reply.code(400).send({ error: "Missing url field" });
    }
    if (!isHttpUrl(url)) {
      return reply.code(400).send({ error: "Not an http(s) URL" });
    }
    if (isYouTubePlaylistUrl(url)) {
      return reply.code(400).send({
        error:
          "That's a playlist — queue it from the session view; downloads take a single track URL.",
      });
    }
    // Already in the library? Don't queue a download — answer immediately.
    const existing = await findBySourceUrl(url);
    if (existing) {
      return reply.code(200).send({ alreadyExisted: true, track: existing });
    }
    const running = [...activeDownloads.values()].filter(
      (d) => d.status.startsWith("downloading") || d.status === "starting",
    ).length;
    if (running >= MAX_CONCURRENT_DOWNLOADS) {
      return reply.code(429).send({ error: "Too many concurrent downloads" });
    }
    const downloadId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    activeDownloads.set(downloadId, { url, progress: 0, status: "starting" });
    const userId = claims.userId;
    const doDownload = async () => {
      try {
        activeDownloads.set(downloadId, {
          url,
          progress: 0,
          status: "downloading",
        });
        const { alreadyExisted } = await downloadAndStore(url, userId, (p) => {
          activeDownloads.set(downloadId, {
            url,
            progress: p.percent,
            status: `downloading ${p.percent.toFixed(0)}%`,
          });
        });
        activeDownloads.set(downloadId, {
          url,
          progress: 100,
          status: alreadyExisted ? "already in library" : "done",
        });
        setTimeout(() => activeDownloads.delete(downloadId), 60_000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        activeDownloads.set(downloadId, {
          url,
          progress: 0,
          status: `error: ${msg}`,
        });
        setTimeout(() => activeDownloads.delete(downloadId), 120_000);
        server.log.error({ err, url }, "download failed");
      }
    };
    void doDownload();
    return reply.code(202).send({ downloadId, status: "starting" });
  });

  server.get("/api/downloads", async (request, reply) => {
    if (!authManage(request, reply)) return;
    return { downloads: Object.fromEntries(activeDownloads) };
  });

  // ── Session WebUI: playback control ─────────────────────────────────────
  server.get<{ Params: { guildId: string } }>(
    "/api/session/:guildId",
    async (request, reply) => {
      const { guildId } = request.params;
      if (!authSession(request, reply, guildId)) return;
      return sessionSnapshot(guildId);
    },
  );

  server.post<{ Params: { guildId: string } }>(
    "/api/session/:guildId/next",
    async (request, reply) => {
      const { guildId } = request.params;
      if (!authSession(request, reply, guildId)) return;
      keepAdvancing(guildId);
      if (!_botRpc)
        return reply.code(503).send({ error: "bot RPC unavailable" });
      await doNext(guildId, _botRpc);
      return syncAndSnapshot(guildId);
    },
  );

  server.post<{ Params: { guildId: string } }>(
    "/api/session/:guildId/prev",
    async (request, reply) => {
      const { guildId } = request.params;
      if (!authSession(request, reply, guildId)) return;
      keepAdvancing(guildId);
      if (!_botRpc)
        return reply.code(503).send({ error: "bot RPC unavailable" });
      const r = await doPrev(guildId, _botRpc);
      if (r.kind === "no-history")
        return reply.code(409).send({ error: "Nothing to go back to" });
      return syncAndSnapshot(guildId);
    },
  );

  server.post<{ Params: { guildId: string } }>(
    "/api/session/:guildId/loop",
    async (request, reply) => {
      const { guildId } = request.params;
      if (!authSession(request, reply, guildId)) return;
      keepAdvancing(guildId);
      let body: { mode?: string };
      try {
        body =
          typeof request.body === "string"
            ? JSON.parse(request.body)
            : (request.body as { mode?: string });
      } catch {
        return reply.code(400).send({ error: "Invalid JSON" });
      }
      const mode = body?.mode;
      if (!mode || !LOOP_MODES.includes(mode as LoopMode)) {
        return reply.code(400).send({ error: "mode must be off/track/queue" });
      }
      setLoop(guildId, mode as LoopMode);
      return syncAndSnapshot(guildId);
    },
  );

  server.post<{ Params: { guildId: string } }>(
    "/api/session/:guildId/autoplay",
    async (request, reply) => {
      const { guildId } = request.params;
      if (!authSession(request, reply, guildId)) return;
      keepAdvancing(guildId);
      let body: { on?: unknown };
      try {
        body =
          typeof request.body === "string"
            ? JSON.parse(request.body)
            : (request.body as { on?: unknown });
      } catch {
        return reply.code(400).send({ error: "Invalid JSON" });
      }
      if (typeof body?.on !== "boolean") {
        return reply.code(400).send({ error: "`on` (boolean) required" });
      }
      setAutoplay(guildId, body.on);
      return syncAndSnapshot(guildId);
    },
  );

  server.post<{ Params: { guildId: string } }>(
    "/api/session/:guildId/queue",
    async (request, reply) => {
      const { guildId } = request.params;
      const claims = authSession(request, reply, guildId);
      if (!claims) return;
      keepAdvancing(guildId);
      let body: { source?: string };
      try {
        body =
          typeof request.body === "string"
            ? JSON.parse(request.body)
            : (request.body as { source?: string });
      } catch {
        return reply.code(400).send({ error: "Invalid JSON" });
      }
      const source = (body?.source ?? "").trim();
      // queuedBy=null: the session token's userId is "who started the
      // session" (whoever last minted the cached token), not necessarily
      // whoever is clicking the WebUI now — don't misattribute.
      if (isYouTubePlaylistUrl(source)) {
        let tracks: Track[];
        try {
          tracks = await resolvePlaylist(source, null);
        } catch (err) {
          return reply.code(400).send({
            error: `Couldn't expand that playlist: ${err instanceof Error ? err.message.slice(0, 200) : "error"}`,
          });
        }
        if (tracks.length === 0) {
          return reply
            .code(400)
            .send({ error: "Playlist is empty or unavailable" });
        }
        for (const t of tracks) enqueue(guildId, t);
        return syncAndSnapshot(guildId);
      }
      let track: Track | null;
      try {
        track = await resolveAnyTrack(source, null);
      } catch (err) {
        return reply.code(400).send({
          error: `Couldn't resolve that source: ${err instanceof Error ? err.message.slice(0, 200) : "error"}`,
        });
      }
      if (!track) {
        return reply.code(400).send({ error: "Unknown station/track/URL" });
      }
      enqueue(guildId, track);
      return syncAndSnapshot(guildId);
    },
  );

  server.post<{ Params: { guildId: string; index: string } }>(
    "/api/session/:guildId/dequeue/:index",
    async (request, reply) => {
      const { guildId } = request.params;
      if (!authSession(request, reply, guildId)) return;
      keepAdvancing(guildId);
      const idx = Number(request.params.index);
      const removed = dequeueAt(guildId, idx);
      if (!removed)
        return reply.code(404).send({ error: "No such queue item" });
      return syncAndSnapshot(guildId);
    },
  );

  server.post<{ Params: { guildId: string } }>(
    "/api/session/:guildId/clear",
    async (request, reply) => {
      const { guildId } = request.params;
      if (!authSession(request, reply, guildId)) return;
      clearQueue(guildId);
      return syncAndSnapshot(guildId);
    },
  );

  // Re-queue one already-played track, identified by its play-log `seq`
  // (stable across cap eviction / re-order, unlike an array index).
  server.post<{ Params: { guildId: string; seq: string } }>(
    "/api/session/:guildId/replay/:seq",
    async (request, reply) => {
      const { guildId } = request.params;
      if (!authSession(request, reply, guildId)) return;
      keepAdvancing(guildId);
      const seq = Number(request.params.seq);
      const entry = Number.isInteger(seq)
        ? getState(guildId)?.playLog.find((e) => e.seq === seq)
        : undefined;
      if (!entry) {
        return reply
          .code(404)
          .send({ error: "No such played track (refresh and retry)" });
      }
      enqueue(guildId, { ...entry.track });
      return syncAndSnapshot(guildId);
    },
  );

  // Re-queue everything played this session, in play-log order (oldest first).
  server.post<{ Params: { guildId: string } }>(
    "/api/session/:guildId/replay-all",
    async (request, reply) => {
      const { guildId } = request.params;
      if (!authSession(request, reply, guildId)) return;
      keepAdvancing(guildId);
      for (const e of getState(guildId)?.playLog ?? []) {
        enqueue(guildId, { ...e.track });
      }
      return syncAndSnapshot(guildId);
    },
  );

  // ── Audio streaming ─────────────────────────────────────────────────────
  server.get<{ Params: { filename: string } }>(
    "/audio/:filename",
    async (request, reply) => {
      // Any valid plugin-session token (manage or session) may stream.
      if (!auth(request, reply)) return;
      const filename = request.params.filename;
      if (!safeAudioName(filename)) {
        return reply.code(400).send({ error: "Invalid filename" });
      }
      const filepath = join(getMusicDir(), filename);
      try {
        const st = await stat(filepath);
        reply.header("Content-Type", "audio/ogg");
        reply.header("Content-Length", st.size);
        return reply.send(createReadStream(filepath));
      } catch {
        return reply.code(404).send({ error: "File not found" });
      }
    },
  );

  // Internal audio endpoint — no auth, only reachable within the Docker
  // network. Used by the bot's voice.play. Audio files only (never
  // library.json / *.tmp — see safeAudioName).
  server.get<{ Params: { filename: string } }>(
    "/internal/audio/:filename",
    async (request, reply) => {
      const filename = request.params.filename;
      if (!safeAudioName(filename)) {
        return reply.code(400).send({ error: "Invalid filename" });
      }
      const filepath = join(getMusicDir(), filename);
      try {
        const st = await stat(filepath);
        reply.header("Content-Type", "audio/ogg");
        reply.header("Content-Length", st.size);
        return reply.send(createReadStream(filepath));
      } catch {
        return reply.code(404).send({ error: "File not found" });
      }
    },
  );

  // Uploaded cover images — no auth (just pictures; the bot also fetches
  // these for Discord embeds). Strict single-segment <id>.<ext> filename.
  server.get<{ Params: { filename: string } }>(
    "/cover/:filename",
    async (request, reply) => {
      const filename = request.params.filename;
      if (!isSafeCoverFilename(filename)) {
        return reply.code(400).send({ error: "Invalid filename" });
      }
      const filepath = coverFilePath(filename);
      try {
        const st = await stat(filepath);
        reply.header("Content-Type", mimeForCoverFile(filename));
        reply.header("Content-Length", st.size);
        reply.header("Cache-Control", "public, max-age=86400");
        // bytes are admin-uploaded — never let a browser sniff them as HTML
        reply.header("X-Content-Type-Options", "nosniff");
        return reply.send(createReadStream(filepath));
      } catch {
        return reply.code(404).send({ error: "File not found" });
      }
    },
  );

  // ── SPA ─────────────────────────────────────────────────────────────────
  const __dirname = dirname(fileURLToPath(import.meta.url));
  let htmlContent: string;
  try {
    htmlContent = readFileSync(join(__dirname, "ui", "index.html"), "utf-8");
  } catch {
    htmlContent = readFileSync(
      join(__dirname, "..", "src", "ui", "index.html"),
      "utf-8",
    );
  }
  server.get("/", async (_request, reply) => {
    reply.header("Content-Type", "text/html; charset=utf-8");
    // Inline JS/CSS SPA; outbound resources: same-origin uploaded covers
    // + external https thumbnail URLs.
    reply.header(
      "Content-Security-Policy",
      "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'; " +
        "script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
    );
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");

    // Inject the path part of effectiveBase() so the SPA knows its prefix
    // when served through the bot proxy (e.g. /plugin/karyl-radio). Done
    // per-request so a late-arriving publicBaseUrl is picked up immediately.
    let basePath = "";
    try {
      basePath = new URL(getEffectiveBase()).pathname.replace(/\/+$/, "");
    } catch {
      // Malformed URL — leave basePath empty; SPA falls back to same-origin.
    }
    const injectedScript = `<script>window.__PLUGIN_BASE__=${JSON.stringify(basePath)}</script>`;
    const html = htmlContent.replace("<head>", `<head>${injectedScript}`);

    return reply.send(html);
  });
}
