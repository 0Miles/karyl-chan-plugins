// Browser-side helpers for talking to the radio plugin's HTTP surface.
// Under the bot proxy: window.location.origin is the bot, __PLUGIN_BASE__
// is "/plugin/karyl-radio", so requests hit the bot reverse-proxy which
// forwards to the plugin. In direct-access mode __PLUGIN_BASE__ is "" so
// API resolves to same-origin.

const API_BASE = window.location.origin + (window.__PLUGIN_BASE__ || "");

let _token: string | null = null;
let _onDenied: ((msg: string) => void) | null = null;

export function setToken(token: string | null): void {
  _token = token;
}

export function getToken(): string | null {
  return _token;
}

export function onAccessDenied(handler: (msg: string) => void): void {
  _onDenied = handler;
}

export function clearToken(): void {
  _token = null;
  sessionStorage.removeItem("radio_token");
}

function b64urlDecode(s: string): string {
  let r = s.replace(/-/g, "+").replace(/_/g, "/");
  while (r.length % 4) r += "=";
  return decodeURIComponent(
    atob(r)
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(""),
  );
}

export interface JwtClaims {
  guildId?: string;
  capabilities?: string[];
  [key: string]: unknown;
}

export function decodeJwt(token: string): JwtClaims | null {
  try {
    const payload = JSON.parse(b64urlDecode(token.split(".")[1]));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export function readTokenFromUrl(): string | null {
  const u = new URL(window.location.href);
  const fromUrl = u.searchParams.get("token");
  if (fromUrl) {
    sessionStorage.setItem("radio_token", fromUrl);
    u.searchParams.delete("token");
    history.replaceState(
      null,
      "",
      u.pathname + (u.search || "") + (u.hash || ""),
    );
    return fromUrl;
  }
  return sessionStorage.getItem("radio_token");
}

async function handleRes(res: Response): Promise<any> {
  if (res.status === 401 || res.status === 403) {
    const body = await res.json().catch(() => ({ error: "Access denied" }));
    const msg = body?.error || "Access denied";
    clearToken();
    _onDenied?.(msg);
    throw new Error(msg);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(body?.error || "Request failed");
  }
  if (res.status === 204) return {};
  return res.json().catch(() => ({}));
}

export async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: "Bearer " + (_token ?? ""),
  };
  const opts: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  return handleRes(await fetch(API_BASE + path, opts));
}

/** multipart/form-data upload — the browser sets the boundary. */
export async function apiUpload<T = any>(
  path: string,
  file: File,
): Promise<T> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  return handleRes(
    await fetch(API_BASE + path, {
      method: "POST",
      headers: { Authorization: "Bearer " + (_token ?? "") },
      body: fd,
    }),
  );
}
