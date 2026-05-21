import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { createReadStream, readFileSync } from "fs";
import { stat } from "fs/promises";
import { randomBytes } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  hasPluginCapability,
  verifyPluginSession,
  type PluginSessionClaims,
} from "@karyl-chan/plugin-sdk";
import {
  issueManagePair,
  verifyManageToken,
  type ManageClaims,
} from "./manage-tokens.js";
import { PLUGIN_KEY } from "./constants.js";
import {
  getEndedGame,
  getGame,
  getGameBySession,
  listGames,
  removeGame,
} from "./game/store.js";
import { buildSnapshot } from "./game/snapshot.js";
import { notifyGameChanged, subscribe } from "./flow/sse.js";
import { listSignups, removeSignup } from "./flow/signup.js";
import { clearCurrentStageButtons } from "./flow/stop.js";
import {
  artFilePath,
  extForMime,
  findArt,
  findVariantArt,
  isSafeArtFilename,
  isValidAssetKey,
  isValidPosition,
  isValidVariant,
  isVariantPosition,
  listArt,
  listAssets,
  mimeForArtFile,
  removeArt,
  removeAsset,
  removeVariantArt,
  saveArt,
  saveAsset,
  saveVariantArt,
} from "./art.js";
import { seatRankAmongSameRole } from "./flow/stages.js";
import { ROLES, type Position } from "./game/roles.js";
import { t } from "./i18n/index.js";

/** capability key (plugin-local) that gates the admin/manage WebUI routes. */
const MANAGE_CAP = "manage";

// ── Deferred wiring from index.ts ─────────────────────────────────────
// The manage routes need things the SDK only produces after start():
// the bot's Ed25519 verify key (for plugin-session JWTs) and the
// publicBaseUrl. onReady runs before the lifecycle client exists, so
// index.ts injects these once start() resolves.

let _sessionVerifyKey: (() => string | null) | null = null;
export function setAvalonSessionVerifyKey(getter: () => string | null): void {
  _sessionVerifyKey = getter;
}

let _publicBaseUrlGetter: (() => string | undefined) | null = null;
export function setAvalonPublicBaseUrl(getter: () => string | undefined): void {
  _publicBaseUrlGetter = getter;
}

let _publicUrlEnvFallback: string | undefined;
export function setPublicUrlEnvFallback(value: string | undefined): void {
  _publicUrlEnvFallback = value;
}

/**
 * Effective browser-reachable base URL for this plugin's HTTP surface.
 * Precedence: SDK publicBaseUrl (from bot) → AVALON_PUBLIC_URL env →
 * last-resort default (matches the docker-compose port mapping).
 */
export function effectiveBase(): string {
  const sdkUrl = _publicBaseUrlGetter?.();
  if (sdkUrl) return sdkUrl.replace(/\/+$/, "");
  if (_publicUrlEnvFallback) return _publicUrlEnvFallback;
  return "http://localhost:904";
}

// ── Auth helpers ──────────────────────────────────────────────────────

function auth(
  request: FastifyRequest,
  reply: FastifyReply,
): PluginSessionClaims | null {
  const verifyKey = _sessionVerifyKey?.() ?? null;
  if (!verifyKey) {
    reply.code(503).send({
      error: "session verification unavailable — plugin not yet registered",
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

function authManageBootstrap(
  request: FastifyRequest,
  reply: FastifyReply,
): PluginSessionClaims | null {
  const claims = auth(request, reply);
  if (!claims) return null;
  if (!hasPluginCapability(claims.capabilities, PLUGIN_KEY, MANAGE_CAP)) {
    reply.code(403).send({
      error: `Missing capability plugin:${PLUGIN_KEY}:${MANAGE_CAP} — ask an admin to grant it to your role.`,
    });
    return null;
  }
  return claims;
}

function authManageAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): ManageClaims | null {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    reply.code(401).send({ error: "Missing authorization" });
    return null;
  }
  const claims = verifyManageToken(token, "manage-access");
  if (!claims) {
    reply.code(401).send({ error: "Invalid or expired access token" });
    return null;
  }
  if (!hasPluginCapability(claims.capabilities, PLUGIN_KEY, MANAGE_CAP)) {
    reply.code(403).send({
      error: `Missing capability plugin:${PLUGIN_KEY}:${MANAGE_CAP} — ask an admin to grant it to your role.`,
    });
    return null;
  }
  return claims;
}

// ── SSE tickets ───────────────────────────────────────────────────────
// EventSource can't send an Authorization header, so the game-board
// stream is authorized by a short-lived ticket carried in the query
// string instead of the 6-hour session JWT. The SPA calls
// POST /api/game/sse-ticket (Bearer session token) to mint one right
// before opening the EventSource. The short TTL bounds how long a
// ticket sitting in a URL / proxy access-log stays usable — kept
// just above the EventSource `retry:` interval so a native
// reconnect still succeeds; the SPA re-mints for anything longer.

const SSE_TICKET_TTL_MS = 20_000;

interface SseTicket {
  userId: string;
  guildId: string | null;
  expiresAt: number;
}

const sseTickets = new Map<string, SseTicket>();

function mintSseTicket(userId: string, guildId: string | null): string {
  const now = Date.now();
  // Opportunistic sweep — the map never grows past live tickets.
  for (const [key, t] of sseTickets) {
    if (t.expiresAt <= now) sseTickets.delete(key);
  }
  const ticket = randomBytes(18).toString("base64url");
  sseTickets.set(ticket, {
    userId,
    guildId,
    expiresAt: now + SSE_TICKET_TTL_MS,
  });
  return ticket;
}

/**
 * Validate a ticket. Not single-use: EventSource's native reconnect
 * reuses the same URL, so the ticket must survive a few reconnects
 * within its short TTL window.
 */
function checkSseTicket(ticket: string): SseTicket | null {
  const t = sseTickets.get(ticket);
  if (!t) return null;
  if (t.expiresAt <= Date.now()) {
    sseTickets.delete(ticket);
    return null;
  }
  return t;
}

// ── Public snapshot shape ─────────────────────────────────────────────
// The WebUI only needs enough to render the games list and the
// force-stop button — never role assignments or vision info, which
// would leak gameplay state to whoever has admin caps.

interface GameSnapshot {
  channelId: string;
  guildId: string;
  hostUserId: string;
  sessionId: string;
  stage: string;
  currentStage: string | null;
  round: number;
  playerCount: number;
  consecutiveRejections: number;
  ladyEnabled: boolean;
  startedAt: number;
}

interface SignupSnapshot {
  channelId: string;
  guildId: string;
  hostUserId: string;
  hostDisplayName: string;
  playerCount: number;
}

function snapshotGames(): GameSnapshot[] {
  return listGames().map((g) => ({
    channelId: g.channelId,
    guildId: g.guildId,
    hostUserId: g.hostUserId,
    sessionId: g.sessionId,
    stage: g.stage,
    currentStage: g.current?.kind ?? null,
    round: g.round,
    playerCount: g.players.length,
    consecutiveRejections: g.consecutiveRejections,
    ladyEnabled: g.ladyEnabled,
    startedAt: g.startedAt,
  }));
}

function snapshotSignups(): SignupSnapshot[] {
  return listSignups().map((s) => ({
    channelId: s.channelId,
    guildId: s.guildId,
    hostUserId: s.hostUserId,
    hostDisplayName: s.hostDisplayName,
    playerCount: s.players.size,
  }));
}

// ── Route registration ────────────────────────────────────────────────

const MAX_ART_BYTES = 5 * 1024 * 1024;

export async function registerWebRoutes(
  server: FastifyInstance,
  getEffectiveBase: () => string,
): Promise<void> {
  await server.register(fastifyMultipart, {
    limits: { fileSize: MAX_ART_BYTES, files: 1, fields: 2 },
  });

  // ── manage session bootstrap + refresh ────────────────────────────
  server.post("/api/manage/exchange", async (request, reply) => {
    const claims = authManageBootstrap(request, reply);
    if (!claims) return;
    return issueManagePair(claims.userId, claims.capabilities ?? []);
  });

  server.post<{ Body: { refreshToken?: unknown } }>(
    "/api/manage/refresh",
    async (request, reply) => {
      let body: { refreshToken?: unknown };
      try {
        body =
          typeof request.body === "string"
            ? JSON.parse(request.body)
            : (request.body as { refreshToken?: unknown });
      } catch {
        return reply.code(400).send({ error: "Invalid JSON" });
      }
      const refresh =
        typeof body?.refreshToken === "string" ? body.refreshToken : null;
      if (!refresh) {
        return reply.code(400).send({ error: "refreshToken required" });
      }
      const claims = verifyManageToken(refresh, "manage-refresh");
      if (!claims) {
        return reply
          .code(401)
          .send({ error: "Invalid or expired refresh token" });
      }
      return issueManagePair(claims.userId, claims.capabilities);
    },
  );

  // ── games listing ─────────────────────────────────────────────────
  server.get("/api/manage/games", async (request, reply) => {
    if (!authManageAccess(request, reply)) return;
    return {
      games: snapshotGames(),
      signups: snapshotSignups(),
    };
  });

  // ── force-stop a game (or a pending sign-up) ──────────────────────
  // Path uses the *channelId* rather than sessionId so the admin can
  // force-stop a frozen sign-up that hasn't promoted to GameState
  // yet — it doesn't have a sessionId.
  server.post<{ Params: { channelId: string } }>(
    "/api/manage/games/:channelId/stop",
    async (request, reply) => {
      if (!authManageAccess(request, reply)) return;
      const channelId = request.params.channelId;
      let removed = false;
      // Game first — that's the more common case. Then signup, since
      // they share a channel slot.
      const stale = getGame(channelId);
      if (stale) {
        // Strip live-looking buttons on the active stage board first
        // (B-002 mirrors the /avalon stop slash path).
        await clearCurrentStageButtons(stale);
        removeGame(channelId);
        removed = true;
      }
      if (removeSignup(channelId)) {
        removed = true;
      }
      if (!removed) {
        return reply.code(404).send({ error: "No game or sign-up here" });
      }
      // Tell any open game boards the session is gone.
      notifyGameChanged(channelId);
      return { ok: true, channelId };
    },
  );

  // ── WebUI game board (players + spectators) ───────────────────────
  // Authorized by the per-user `plugin-session` JWT minted by
  // `/avalon webui`. The session token carries the user's id + guild;
  // the per-viewer snapshot (game/snapshot.ts) is the security
  // boundary that decides what role/vision data each viewer may see.

  /**
   * Resolve the game in `channelId` and confirm it belongs to the
   * token's guild. Returns null after sending the error reply.
   */
  function gameForViewer(
    channelId: string,
    sessionId: string | null,
    guildId: string | null,
    reply: FastifyReply,
  ): ReturnType<typeof getGame> {
    // With a sessionId the board is pinned to that exact game
    // instance; without one (legacy links) fall back to whatever
    // game currently holds the channel.
    const game = sessionId
      ? getGameBySession(channelId, sessionId)
      : getGame(channelId) ?? getEndedGame(channelId);
    if (!game) {
      reply.code(404).send({ error: "No game for this session" });
      return null;
    }
    // The session token is guild-scoped; never let it read a game in
    // another guild even if the caller guesses a channelId.
    if (!guildId || game.guildId !== guildId) {
      reply.code(403).send({ error: "Game belongs to another guild" });
      return null;
    }
    return game;
  }

  // Per-viewer snapshot — initial paint + the polling fallback the
  // SPA uses when SSE can't get through a buffering proxy.
  server.get<{ Querystring: { channel?: string; session?: string } }>(
    "/api/game/state",
    async (request, reply) => {
      const claims = auth(request, reply);
      if (!claims) return;
      const channelId = request.query.channel;
      if (typeof channelId !== "string" || channelId.length === 0) {
        return reply.code(400).send({ error: "channel query param required" });
      }
      const sessionId =
        typeof request.query.session === "string"
          ? request.query.session
          : null;
      const game = gameForViewer(channelId, sessionId, claims.guildId, reply);
      if (!game) return;
      return buildSnapshot(game, claims.userId);
    },
  );

  // The viewer's own role-card artwork URL (admin-uploaded art).
  // null when the viewer isn't a seated player or no art is stored —
  // the board falls back to a text-only card. Resolves the variant
  // slot the same way the in-channel deal-reveal does.
  server.get<{ Querystring: { channel?: string; session?: string } }>(
    "/api/game/role-art",
    async (request, reply) => {
      const claims = auth(request, reply);
      if (!claims) return;
      const channelId = request.query.channel;
      if (typeof channelId !== "string" || channelId.length === 0) {
        return reply.code(400).send({ error: "channel query param required" });
      }
      const sessionId =
        typeof request.query.session === "string"
          ? request.query.session
          : null;
      const game = gameForViewer(channelId, sessionId, claims.guildId, reply);
      if (!game) return;
      const player = game.players.find((p) => p.userId === claims.userId);
      if (!player) return { url: null };
      const art = isVariantPosition(player.position)
        ? await findVariantArt(
            player.position,
            seatRankAmongSameRole(game.players, player),
          )
        : await findArt(player.position);
      if (!art) return { url: null };
      return {
        url: `${getEffectiveBase()}/art/${art.filename}?v=${art.etag}`,
      };
    },
  );

  // Mint a short-lived ticket for the EventSource connection below.
  server.post("/api/game/sse-ticket", async (request, reply) => {
    const claims = auth(request, reply);
    if (!claims) return;
    return { ticket: mintSseTicket(claims.userId, claims.guildId) };
  });

  // SSE stream — live per-viewer snapshots. Ticket-authorized (the
  // browser EventSource API can't set an Authorization header).
  server.get<{
    Querystring: { channel?: string; ticket?: string; session?: string };
  }>(
    "/api/game/events",
    (request, reply) => {
      const channelId = request.query.channel;
      const ticketStr = request.query.ticket;
      if (
        typeof channelId !== "string" ||
        channelId.length === 0 ||
        typeof ticketStr !== "string" ||
        ticketStr.length === 0
      ) {
        reply.code(400).send({ error: "channel and ticket required" });
        return;
      }
      const ticket = checkSseTicket(ticketStr);
      if (!ticket) {
        reply.code(401).send({ error: "Invalid or expired ticket" });
        return;
      }
      const sessionId =
        typeof request.query.session === "string"
          ? request.query.session
          : null;
      const game = sessionId
        ? getGameBySession(channelId, sessionId)
        : getGame(channelId) ?? getEndedGame(channelId);
      if (game && (!ticket.guildId || game.guildId !== ticket.guildId)) {
        reply.code(403).send({ error: "Game belongs to another guild" });
        return;
      }
      // The stream is pinned to a specific game instance — the
      // requested session, or (legacy links) the channel's current
      // one — so it never silently follows a later game.
      const pinSession = sessionId ?? game?.sessionId ?? "";

      // Hand the socket off — we own the raw response until close.
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Defeat proxy/runtime response buffering so frames flush.
        "X-Accel-Buffering": "no",
      });
      const send = (payload: unknown): void => {
        raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      // Tell EventSource to wait 3 s before a native reconnect.
      raw.write("retry: 3000\n\n");
      // Initial paint.
      send(game ? buildSnapshot(game, ticket.userId) : { gone: true });
      const unsubscribe = subscribe(channelId, {
        userId: ticket.userId,
        sessionId: pinSession,
        send,
      });
      // Comment-only heartbeat keeps idle proxies from dropping us.
      const heartbeat = setInterval(() => {
        raw.write(": hb\n\n");
      }, 25_000);
      if (typeof heartbeat.unref === "function") heartbeat.unref();
      // A dropped connection fires both "error" and "close" — guard
      // so the unsubscribe runs exactly once.
      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(heartbeat);
        unsubscribe();
      };
      request.raw.on("close", cleanup);
      request.raw.on("error", cleanup);
    },
  );

  // ── Role artwork: list / upload / delete (admin-gated) ───────────
  // Each entry's `url` is fully-qualified (uses effectiveBase + a
  // content hash for cache-busting) so the WebUI can preview it
  // directly and Discord can fetch it for the role-reveal embed.
  server.get("/api/manage/art", async (request, reply) => {
    if (!authManageAccess(request, reply)) return;
    const [entries, assets] = await Promise.all([listArt(), listAssets()]);
    return {
      art: entries.map((e) => ({
        position: e.position,
        ...(e.variant !== undefined ? { variant: e.variant } : {}),
        filename: e.filename,
        size: e.size,
        url: `${getEffectiveBase()}/art/${e.filename}?v=${Math.floor(e.mtimeMs)}`,
      })),
      assets: assets.map((a) => ({
        assetKey: a.assetKey,
        filename: a.filename,
        size: a.size,
        url: `${getEffectiveBase()}/art/${a.filename}?v=${Math.floor(a.mtimeMs)}`,
      })),
    };
  });

  /**
   * Single-image upload for non-variant positions (merlin, percival,
   * assassin, morgana, mordred, oberon). Variant positions (loyal,
   * minion) must use the `/:variant` route below; trying this path
   * for them returns 400 so the WebUI surfaces a clear error
   * instead of writing a non-conforming filename.
   */
  server.post<{ Params: { position: string } }>(
    "/api/manage/art/:position",
    async (request, reply) => {
      if (!authManageAccess(request, reply)) return;
      const position = request.params.position;
      if (!isValidPosition(position)) {
        return reply.code(400).send({ error: "Unknown role" });
      }
      if (isVariantPosition(position)) {
        return reply
          .code(400)
          .send({ error: "Variant position requires a /:variant slot" });
      }
      const upload = await readUpload(request, reply);
      if (!upload) return;
      const filename = await saveArt(position, upload.buf, upload.ext);
      return {
        position,
        filename,
        url: `${getEffectiveBase()}/art/${filename}?v=${Date.now()}`,
      };
    },
  );

  server.delete<{ Params: { position: string } }>(
    "/api/manage/art/:position",
    async (request, reply) => {
      if (!authManageAccess(request, reply)) return;
      const position = request.params.position;
      if (!isValidPosition(position)) {
        return reply.code(400).send({ error: "Unknown role" });
      }
      if (isVariantPosition(position)) {
        return reply
          .code(400)
          .send({ error: "Variant position requires a /:variant slot" });
      }
      const removed = await removeArt(position);
      if (!removed) return reply.code(404).send({ error: "No artwork stored" });
      return { ok: true };
    },
  );

  /**
   * Variant-slot upload (loyal, minion). The slot number is the
   * 1-indexed variant index — at deal-reveal time the engine matches
   * the player's seat-rank-among-same-role to this index.
   */
  server.post<{ Params: { position: string; variant: string } }>(
    "/api/manage/art/:position/:variant",
    async (request, reply) => {
      if (!authManageAccess(request, reply)) return;
      const position = request.params.position;
      if (!isValidPosition(position) || !isVariantPosition(position)) {
        return reply.code(400).send({ error: "Unknown variant role" });
      }
      const variant = Number(request.params.variant);
      if (!isValidVariant(position, variant)) {
        return reply.code(400).send({ error: "Variant out of range" });
      }
      const upload = await readUpload(request, reply);
      if (!upload) return;
      const filename = await saveVariantArt(
        position,
        variant,
        upload.buf,
        upload.ext,
      );
      return {
        position,
        variant,
        filename,
        url: `${getEffectiveBase()}/art/${filename}?v=${Date.now()}`,
      };
    },
  );

  server.delete<{ Params: { position: string; variant: string } }>(
    "/api/manage/art/:position/:variant",
    async (request, reply) => {
      if (!authManageAccess(request, reply)) return;
      const position = request.params.position;
      if (!isValidPosition(position) || !isVariantPosition(position)) {
        return reply.code(400).send({ error: "Unknown variant role" });
      }
      const variant = Number(request.params.variant);
      if (!isValidVariant(position, variant)) {
        return reply.code(400).send({ error: "Variant out of range" });
      }
      const removed = await removeVariantArt(position, variant);
      if (!removed) {
        return reply.code(404).send({ error: "No artwork stored for this slot" });
      }
      return { ok: true };
    },
  );

  // ── Game-element assets (lake, …) ────────────────────────────────
  // Separate route namespace from role art so the URL shape stays
  // honest: `lake` isn't a role. Same multipart + 5 MB + mime guards
  // via the shared readUpload helper.

  server.post<{ Params: { key: string } }>(
    "/api/manage/asset/:key",
    async (request, reply) => {
      if (!authManageAccess(request, reply)) return;
      const key = request.params.key;
      if (!isValidAssetKey(key)) {
        return reply.code(400).send({ error: "Unknown asset" });
      }
      const upload = await readUpload(request, reply);
      if (!upload) return;
      const filename = await saveAsset(key, upload.buf, upload.ext);
      return {
        assetKey: key,
        filename,
        url: `${getEffectiveBase()}/art/${filename}?v=${Date.now()}`,
      };
    },
  );

  server.delete<{ Params: { key: string } }>(
    "/api/manage/asset/:key",
    async (request, reply) => {
      if (!authManageAccess(request, reply)) return;
      const key = request.params.key;
      if (!isValidAssetKey(key)) {
        return reply.code(400).send({ error: "Unknown asset" });
      }
      const removed = await removeAsset(key);
      if (!removed) return reply.code(404).send({ error: "No asset stored" });
      return { ok: true };
    },
  );

  /**
   * Shared multipart-read prelude for both the single and variant
   * upload routes. Returns null when it already sent a 4xx response.
   */
  async function readUpload(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ buf: Buffer; ext: string } | null> {
    let file;
    try {
      file = await request.file();
    } catch {
      reply.code(400).send({ error: "Expected a multipart upload" });
      return null;
    }
    if (!file) {
      reply.code(400).send({ error: "No file uploaded" });
      return null;
    }
    const ext = extForMime(file.mimetype || "");
    if (!ext) {
      reply
        .code(415)
        .send({ error: "Unsupported image type (use jpeg/png/webp/gif)" });
      return null;
    }
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch {
      reply
        .code(413)
        .send({ error: `Image too large (max ${MAX_ART_BYTES >> 20} MB)` });
      return null;
    }
    if (buf.length === 0) {
      reply.code(400).send({ error: "Empty file" });
      return null;
    }
    return { buf, ext };
  }

  // Public serve — no auth. Discord fetches the URL anonymously when
  // rendering the role-reveal embed's thumbnail, and the WebUI fetches
  // it for previews. Strict <position>.<ext> filename only.
  server.get<{ Params: { filename: string } }>(
    "/art/:filename",
    async (request, reply) => {
      const filename = request.params.filename;
      if (!isSafeArtFilename(filename)) {
        return reply.code(400).send({ error: "Invalid filename" });
      }
      const filepath = artFilePath(filename);
      try {
        const st = await stat(filepath);
        reply.header("Content-Type", mimeForArtFile(filename));
        reply.header("Content-Length", st.size);
        reply.header("Cache-Control", "public, max-age=86400");
        reply.header("X-Content-Type-Options", "nosniff");
        return reply.send(createReadStream(filepath));
      } catch {
        return reply.code(404).send({ error: "File not found" });
      }
    },
  );

  // ── Public rules + role manual ────────────────────────────────────
  // No auth — pure reference content (rules + role descriptions),
  // pulled from the same i18n the Discord side uses so the wording
  // lives in one place. Backs the /manual SPA route.
  const MANUAL_ROLE_ORDER: Position[] = [
    "merlin",
    "percival",
    "loyal",
    "assassin",
    "morgana",
    "mordred",
    "oberon",
    "minion",
  ];
  server.get("/api/manual", async () => ({
    intro: t(undefined, "manual.intro"),
    rules: (["goal", "flow", "win", "lake"] as const).map((key) => ({
      title: t(undefined, `manual.rule.${key}.title`),
      body: t(undefined, `manual.rule.${key}.body`),
    })),
    roles: MANUAL_ROLE_ORDER.map((position) => ({
      position,
      name: t(undefined, ROLES[position].nameKey),
      faction: ROLES[position].faction,
      short: t(undefined, `role.flavor.${position}`),
      detail: t(undefined, `role.description.${position}`),
    })),
  }));

  // ── Single-page admin UI ──────────────────────────────────────────
  // The built singlefile bundle lives at dist/ui/index.html relative
  // to the compiled web-routes.js. We rewrite `window.__PLUGIN_BASE__`
  // at serve time so links work whether the SPA is hit direct or via
  // the bot's proxy.
  const here = dirname(fileURLToPath(import.meta.url));
  // web-routes.js sits at dist/web-routes.js; the singlefile bundle
  // lives at dist/ui/index.html (vite's outDir relative to dist/).
  const indexPath = join(here, "ui", "index.html");
  let cachedHtml: string | null = null;
  function loadIndexHtml(): string {
    if (cachedHtml) return cachedHtml;
    try {
      cachedHtml = readFileSync(indexPath, "utf-8");
    } catch {
      cachedHtml = "<!doctype html><h1>WebUI bundle missing</h1>";
    }
    return cachedHtml;
  }

  /**
   * Serve the SPA bundle. `/` is the game board / admin panel,
   * `/manual` the public rules manual — the SPA picks the view from
   * the path. `__PLUGIN_BASE__` is rewritten per-request so links
   * work whether the SPA is hit direct or via the bot's proxy.
   */
  function serveSpa(reply: FastifyReply): string {
    let basePath = "";
    try {
      basePath = new URL(getEffectiveBase()).pathname.replace(/\/+$/, "");
    } catch {
      // Malformed URL — leave basePath empty; SPA falls back to same-origin.
    }
    const html = loadIndexHtml().replace(
      /__PLUGIN_BASE__\s*=\s*"[^"]*"/,
      `__PLUGIN_BASE__ = "${basePath}"`,
    );
    reply.header("content-type", "text/html; charset=utf-8");
    // The vite-plugin-singlefile bundle inlines every JS + CSS chunk
    // into the HTML, so the bot proxy's strict default CSP
    // (`script-src 'self'; style-src 'self'`) would block them. Send
    // our own CSP that allows inline JS+CSS but locks everything else
    // down. fastify/reply-from copies upstream headers over the bot's,
    // so this is the effective CSP that lands at the browser.
    reply.header(
      "Content-Security-Policy",
      // `blob:` is required by the cropperjs preview pipeline. The
      // chosen role-art file becomes an objectURL (`blob:…`) used in
      // two places:
      //  - img-src: the <img> in the modal renders the blob before
      //    the cropper canvas takes over.
      //  - connect-src: cropperjs `checkOrientation: true` does a
      //    `fetch(blobURL)` to sniff the image's EXIF orientation.
      // The art tile previews of already-uploaded files load from
      // the same-origin `/art/<file>` (covered by `'self'`). `https:`
      // stays so a future role-art CDN URL would still display.
      "default-src 'none'; img-src 'self' https: data: blob:; style-src 'unsafe-inline'; " +
        "script-src 'unsafe-inline'; connect-src 'self' blob:; base-uri 'none'; form-action 'none'",
    );
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    return html;
  }

  server.get("/", async (_request, reply) => serveSpa(reply));
  server.get("/manual", async (_request, reply) => serveSpa(reply));

  // Health probe — used by Docker compose to flip the container's
  // health status to `healthy`. Kept open (no auth) so the orchestrator
  // doesn't need a token.
  server.get("/api/manage/health", async () => ({ ok: true }));

  // Defensive: a stat on the bundle directory at boot, just so a
  // missing build fails loudly rather than serving the fallback HTML
  // forever.
  await stat(indexPath).catch((err: NodeJS.ErrnoException) => {
    server.log.warn(
      { err: err.message, indexPath },
      "Avalon WebUI bundle missing at registration time — build packages/avalon first",
    );
  });
  void createReadStream;
}
