import { ref } from "vue";
import {
  decodeJwt,
  exchangeManageJwt,
  loadStoredGameSession,
  loadStoredManage,
  onAccessDenied,
  readChannelFromUrl,
  readTokenFromUrl,
  setGameSession,
  setManageTokens,
} from "../api";

/**
 * App-level routing between the two WebUI surfaces this SPA serves:
 *
 *  - `manage` — the admin panel (`/avalon manage`): a capability-
 *    bearing bot JWT, exchanged for an access/refresh pair.
 *  - `game`   — the per-player game board (`/avalon webui`): a
 *    capability-less session JWT plus a `?c=<channelId>`.
 *
 * Both links land on the same `index.html`; this composable decodes
 * the URL token once and picks the surface. A tab reload (no URL
 * token) restores whichever session is in sessionStorage.
 */
export type AppMode = "loading" | "denied" | "manage" | "game" | "manual";

const PLUGIN_KEY = "karyl-avalon";

const mode = ref<AppMode>("loading");
const deniedMessage = ref<string | null>(null);

function deny(message: string): void {
  deniedMessage.value = message;
  mode.value = "denied";
}

function hasManageCaps(claims: { capabilities?: unknown } | null): boolean {
  const caps = Array.isArray(claims?.capabilities)
    ? (claims!.capabilities as string[])
    : [];
  return (
    caps.includes("admin") || caps.includes(`plugin:${PLUGIN_KEY}:manage`)
  );
}

let listenerInstalled = false;
function ensureDeniedListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  // The manage API helpers fire this on an unrecoverable 401/403.
  onAccessDenied((msg) => deny(msg || "存取遭拒，請重新取得連結。"));
}

export async function bootstrapApp(): Promise<void> {
  ensureDeniedListener();
  // The /manual route is public reference content — no token, no
  // session; the SPA routes to it purely on the path.
  if (
    window.location.pathname.replace(/\/+$/, "").endsWith("/manual")
  ) {
    mode.value = "manual";
    return;
  }
  // Read + strip both query params up front, exactly once — a second
  // reader would see them already gone.
  const channelId = readChannelFromUrl();
  const urlToken = readTokenFromUrl();

  if (urlToken) {
    const claims = decodeJwt(urlToken);
    if (claims && hasManageCaps(claims)) {
      const tokens = await exchangeManageJwt(urlToken);
      if (!tokens) {
        deny(
          "無法開始管理工作階段 — 連結可能已過期，請重新執行 /avalon manage。",
        );
        return;
      }
      setManageTokens(tokens);
      mode.value = "manage";
      return;
    }
    // No manage caps → a game-board session token.
    if (!channelId) {
      deny("遊戲板連結缺少頻道資訊，請重新執行 /avalon webui。");
      return;
    }
    setGameSession({ token: urlToken, channelId });
    mode.value = "game";
    return;
  }

  // Tab reload — restore a stored session. Game first: a player mid-
  // match reloading should land back on their board.
  if (loadStoredGameSession()) {
    mode.value = "game";
    return;
  }
  if (loadStoredManage()) {
    mode.value = "manage";
    return;
  }
  deny("請在 Discord 內透過 /avalon webui 或 /avalon manage 取得連結。");
}

export function useAppSession() {
  return { mode, deniedMessage, bootstrap: bootstrapApp };
}
