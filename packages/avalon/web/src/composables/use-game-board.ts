import { onUnmounted, ref, shallowRef } from "vue";
import {
  currentChannelId,
  gameApi,
  gameSseUrl,
  mintSseTicket,
  type HttpError,
} from "../api";
import type { GameSnapshotView, GoneSnapshot } from "../game-types";

/**
 * Game-board live data source.
 *
 * Primary transport is SSE (`/api/game/events`): one EventSource that
 * receives a fresh per-viewer snapshot on every gameplay change. SSE
 * can be defeated by a buffering reverse proxy, so after a few failed
 * connections the composable falls back to polling `/api/game/state`
 * — the board keeps working either way.
 *
 * The initial `/api/game/state` fetch paints the board instantly,
 * before the SSE handshake completes.
 */

export type BoardStatus =
  | "connecting"
  | "live"
  | "polling"
  | "gone"
  | "denied";

const MAX_SSE_FAILURES = 4;
const POLL_INTERVAL_MS = 4000;
const SSE_RETRY_MS = 3000;
const EXPIRED_MSG = "連結已過期，請在 Discord 重新執行 /avalon webui。";

export function useGameBoard() {
  const snapshot = shallowRef<GameSnapshotView | null>(null);
  const status = ref<BoardStatus>("connecting");
  const deniedMessage = ref<string | null>(null);

  const channelId = currentChannelId();
  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let sseFailures = 0;
  let disposed = false;

  function applyFrame(data: GameSnapshotView | GoneSnapshot): void {
    if ("gone" in data) {
      markGone();
      return;
    }
    snapshot.value = data;
    // Don't downgrade a confirmed polling fallback back to "live".
    if (status.value !== "polling") status.value = "live";
  }

  /** Terminal "no game here" state — also stops the poll loop. */
  function markGone(): void {
    snapshot.value = null;
    status.value = "gone";
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function deny(message: string): void {
    cleanup();
    deniedMessage.value = message;
    status.value = "denied";
  }

  async function fetchState(): Promise<void> {
    if (!channelId || disposed) return;
    try {
      applyFrame(
        await gameApi<GameSnapshotView>(
          `/api/game/state?channel=${encodeURIComponent(channelId)}`,
        ),
      );
    } catch (err) {
      const code = (err as HttpError).status;
      if (code === 401) {
        deny(EXPIRED_MSG);
      } else if (code === 404) {
        markGone();
      }
      // Other (transient) failures keep the last good snapshot shown.
    }
  }

  function startPolling(): void {
    if (pollTimer || disposed) return;
    status.value = "polling";
    // Fetch once right away — don't show stale data for a full
    // interval while committing to the polling fallback.
    void fetchState();
    pollTimer = setInterval(() => void fetchState(), POLL_INTERVAL_MS);
  }

  function onSseFailure(): void {
    if (disposed) return;
    sseFailures++;
    if (sseFailures >= MAX_SSE_FAILURES) {
      // SSE clearly isn't getting through — commit to polling.
      startPolling();
      return;
    }
    retryTimer = setTimeout(() => void openSse(), SSE_RETRY_MS);
  }

  async function openSse(): Promise<void> {
    if (!channelId || disposed || pollTimer) return;
    let ticket: string;
    try {
      ticket = await mintSseTicket();
    } catch (err) {
      if ((err as HttpError).status === 401) {
        deny(EXPIRED_MSG);
        return;
      }
      onSseFailure();
      return;
    }
    if (disposed) return;
    const source = new EventSource(gameSseUrl(channelId, ticket));
    es = source;
    source.onopen = () => {
      sseFailures = 0;
    };
    source.onmessage = (ev) => {
      sseFailures = 0;
      try {
        applyFrame(JSON.parse(ev.data));
      } catch {
        // ignore one malformed frame
      }
    };
    source.onerror = () => {
      // EventSource would auto-reconnect, but its retry reuses the
      // now-stale ticket URL — close and re-mint a fresh one.
      source.close();
      if (es === source) es = null;
      onSseFailure();
    };
  }

  function cleanup(): void {
    disposed = true;
    es?.close();
    es = null;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  async function connect(): Promise<void> {
    if (!channelId) {
      deny("連結缺少頻道資訊，請重新執行 /avalon webui。");
      return;
    }
    await fetchState();
    if (disposed || status.value === "denied") return;
    void openSse();
  }

  onUnmounted(cleanup);

  return { snapshot, status, deniedMessage, connect };
}
