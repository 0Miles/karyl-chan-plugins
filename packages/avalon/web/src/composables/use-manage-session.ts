import { ref } from "vue";
import {
  decodeJwt,
  exchangeManageJwt,
  loadStoredManage,
  onAccessDenied,
  readTokenFromUrl,
  setManageTokens,
} from "../api";

/**
 * Avalon admin session bootstrap.
 *
 * Three terminal states:
 *  - `loading`   — first paint, before bootstrap resolves.
 *  - `denied`    — token missing / expired / cap check failed.
 *  - `manage`    — authenticated, ready to render the management views.
 *
 * The view state is module-level so the App shell and any nested
 * component can react without prop-drilling. `bootstrap()` is meant to
 * run once on mount; calling it twice is a no-op for already-authenticated
 * sessions but harmless.
 */
export type View = "loading" | "denied" | "manage";

const PLUGIN_KEY = "karyl-avalon";

const view = ref<View>("loading");
const deniedMessage = ref<string | null>(null);

function isManageClaims(claims: { capabilities?: unknown } | null): boolean {
  const caps = Array.isArray(claims?.capabilities)
    ? (claims!.capabilities as string[])
    : [];
  return (
    caps.includes("admin") || caps.includes(`plugin:${PLUGIN_KEY}:manage`)
  );
}

let installed = false;
function ensureAccessDeniedListener(): void {
  if (installed) return;
  installed = true;
  onAccessDenied((msg) => {
    deniedMessage.value = msg || "Access denied — re-run /avalon manage.";
    view.value = "denied";
  });
}

/**
 * Acquire / restore a manage session.
 * - URL token (`?token=<bot JWT>`) is the bootstrap path — exchanged once.
 * - Otherwise try `sessionStorage` for an in-flight pair (tab reload).
 * - If neither yields a session, mark denied.
 */
export async function bootstrapManageSession(): Promise<void> {
  ensureAccessDeniedListener();
  const urlToken = readTokenFromUrl();
  if (urlToken) {
    const claims = decodeJwt(urlToken);
    if (!claims || !isManageClaims(claims)) {
      deniedMessage.value =
        "This link doesn't grant access to the Avalon admin panel.";
      view.value = "denied";
      return;
    }
    const tokens = await exchangeManageJwt(urlToken);
    if (!tokens) {
      deniedMessage.value =
        "Couldn't start an admin session — your link may have expired. Re-run /avalon manage.";
      view.value = "denied";
      return;
    }
    setManageTokens(tokens);
    view.value = "manage";
    return;
  }
  if (loadStoredManage()) {
    view.value = "manage";
    return;
  }
  deniedMessage.value =
    "Open the link from /avalon manage in Discord to sign in.";
  view.value = "denied";
}

export function useManageSession() {
  return { view, deniedMessage, bootstrap: bootstrapManageSession };
}
