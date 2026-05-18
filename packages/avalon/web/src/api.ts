// Browser-side helper for the Avalon admin SPA. Manage-only — there
// is no per-guild "session" surface for ordinary players (the game
// is driven entirely by in-channel buttons).
//
// Flow:
//   1. SPA reads `?token=…` (the bot's 15-min plugin-session JWT).
//   2. POSTs to /api/manage/exchange → receives plugin-issued
//      access (5 min) + refresh (24 h) pair.
//   3. Lives on the access token; on 401 transparently /refreshes
//      once and retries the request.
//   4. Tab reload restores the pair from sessionStorage.

const API_BASE = window.location.origin + (window.__PLUGIN_BASE__ || "");

const MANAGE_TOKENS_KEY = "avalon_manage_tokens";

export interface ManageTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

let _manage: ManageTokens | null = null;
let _onDenied: ((msg: string) => void) | null = null;

export function onAccessDenied(handler: (msg: string) => void): void {
  _onDenied = handler;
}

export function setManageTokens(t: ManageTokens): void {
  _manage = t;
  sessionStorage.setItem(MANAGE_TOKENS_KEY, JSON.stringify(t));
}

function clearManage(): void {
  _manage = null;
  sessionStorage.removeItem(MANAGE_TOKENS_KEY);
}

export function loadStoredManage(): ManageTokens | null {
  const raw = sessionStorage.getItem(MANAGE_TOKENS_KEY);
  if (!raw) return null;
  try {
    const parsed: ManageTokens = JSON.parse(raw);
    if (
      typeof parsed.refreshToken === "string" &&
      typeof parsed.refreshExpiresAt === "number" &&
      parsed.refreshExpiresAt > Date.now()
    ) {
      _manage = parsed;
      return parsed;
    }
  } catch {
    // fall through
  }
  clearManage();
  return null;
}

export function readTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const t = params.get("token");
  if (!t) return null;
  // Strip the token from the visible URL so a screenshot doesn't
  // leak a bearer token (it's still in sessionStorage).
  const url = new URL(window.location.href);
  url.searchParams.delete("token");
  window.history.replaceState({}, "", url.toString());
  return t;
}

interface JwtClaims {
  capabilities?: unknown;
  guildId?: unknown;
  userId?: unknown;
  exp?: unknown;
}

export function decodeJwt(token: string): JwtClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // base64url → base64
    const b64 =
      parts[1].replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (parts[1].length % 4)) % 4);
    const json = atob(b64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function exchangeManageJwt(
  botJwt: string,
): Promise<ManageTokens | null> {
  const res = await fetch(`${API_BASE}/api/manage/exchange`, {
    method: "POST",
    headers: { authorization: `Bearer ${botJwt}` },
  });
  if (!res.ok) return null;
  const body = await res.json();
  if (
    typeof body?.accessToken !== "string" ||
    typeof body?.refreshToken !== "string"
  ) {
    return null;
  }
  return body as ManageTokens;
}

async function refreshOnce(): Promise<boolean> {
  if (!_manage) return false;
  const res = await fetch(`${API_BASE}/api/manage/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: _manage.refreshToken }),
  });
  if (!res.ok) {
    clearManage();
    return false;
  }
  const body = await res.json();
  if (
    typeof body?.accessToken !== "string" ||
    typeof body?.refreshToken !== "string"
  ) {
    return false;
  }
  setManageTokens(body as ManageTokens);
  return true;
}

/**
 * Multipart upload helper for role artwork. Same auth + transparent
 * refresh as `api()`, just sends the body as FormData with a single
 * `file` part — what the Fastify multipart route on the plugin
 * expects.
 */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!_manage) {
      _onDenied?.("Session expired. Re-run /avalon manage.");
      throw new Error("not authenticated");
    }
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { authorization: `Bearer ${_manage.accessToken}` },
      body: fd,
    });
    if (res.status === 401 && attempt === 0) {
      const ok = await refreshOnce();
      if (!ok) {
        _onDenied?.("Session expired. Re-run /avalon manage.");
        throw new Error("session expired");
      }
      continue;
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (errBody?.error) msg = String(errBody.error);
      } catch {
        // keep status
      }
      throw new Error(msg);
    }
    return res.json() as Promise<T>;
  }
  throw new Error("unreachable");
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!_manage) {
      _onDenied?.("Session expired. Re-run /avalon manage in Discord.");
      throw new Error("not authenticated");
    }
    const res = await fetch(API_BASE + path, {
      method,
      headers: {
        authorization: `Bearer ${_manage.accessToken}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) {
      // One transparent refresh, then retry the original request.
      const ok = await refreshOnce();
      if (!ok) {
        _onDenied?.("Session expired. Re-run /avalon manage.");
        throw new Error("session expired");
      }
      continue;
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (errBody?.error) msg = String(errBody.error);
      } catch {
        // keep the http status
      }
      if (res.status === 403) _onDenied?.(msg);
      throw new Error(msg);
    }
    return res.json() as Promise<T>;
  }
  throw new Error("unreachable");
}

declare global {
  interface Window {
    __PLUGIN_BASE__?: string;
  }
}
