import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createReadStream, readFileSync } from "fs";
import { stat } from "fs/promises";
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
import { listGames, removeGame } from "./game/store.js";
import { listSignups, removeSignup } from "./flow/signup.js";

/** capability key (plugin-local) that gates the admin/manage WebUI routes. */
const WEBUI_CAP = "webui.access";

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
  if (!hasPluginCapability(claims.capabilities, PLUGIN_KEY, WEBUI_CAP)) {
    reply.code(403).send({
      error: `Missing capability plugin:${PLUGIN_KEY}:${WEBUI_CAP} — ask an admin to grant it to your role.`,
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
  if (!hasPluginCapability(claims.capabilities, PLUGIN_KEY, WEBUI_CAP)) {
    reply.code(403).send({
      error: `Missing capability plugin:${PLUGIN_KEY}:${WEBUI_CAP} — ask an admin to grant it to your role.`,
    });
    return null;
  }
  return claims;
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

export async function registerWebRoutes(
  server: FastifyInstance,
  getEffectiveBase: () => string,
): Promise<void> {
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
      const games = listGames();
      if (games.find((g) => g.channelId === channelId)) {
        removeGame(channelId);
        removed = true;
      }
      if (removeSignup(channelId)) {
        removed = true;
      }
      if (!removed) {
        return reply.code(404).send({ error: "No game or sign-up here" });
      }
      return { ok: true, channelId };
    },
  );

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

  server.get("/", async (_request, reply) => {
    const base = getEffectiveBase();
    // Pull `?token=…` through from the URL; the SPA reads it client-side.
    // No need to splice it server-side.
    const html = loadIndexHtml().replace(
      /__PLUGIN_BASE__\s*=\s*"[^"]*"/,
      `__PLUGIN_BASE__ = ""`,
    );
    void base;
    reply.header("content-type", "text/html; charset=utf-8");
    return html;
  });

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
