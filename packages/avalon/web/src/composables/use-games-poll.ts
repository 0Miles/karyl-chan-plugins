import { onBeforeUnmount, ref } from "vue";
import { api } from "../api";
import type {
  GamesResponse,
  GameSnapshot,
  SignupSnapshot,
} from "../types";
import { useToast } from "./use-toast";

/**
 * Polls /api/manage/games every `intervalMs`. Returns refs for games +
 * signups + last-error and start/stop helpers. Multiple callers share
 * the same poll loop via the module-level state — `start()` is
 * idempotent.
 */
const games = ref<GameSnapshot[]>([]);
const signups = ref<SignupSnapshot[]>([]);
const lastError = ref<string | null>(null);

let timer: number | undefined;

async function refresh(): Promise<void> {
  try {
    const r = await api<GamesResponse>("GET", "/api/manage/games");
    games.value = r.games || [];
    signups.value = r.signups || [];
    lastError.value = null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    lastError.value = msg;
  }
}

function start(intervalMs = 4000): void {
  if (timer !== undefined) return;
  // Eager-refresh once so the first paint isn't empty.
  void refresh();
  timer = window.setInterval(refresh, intervalMs);
}

function stop(): void {
  if (timer !== undefined) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

export function useGamesPoll() {
  const { error: toastError, ok: toastOk } = useToast();

  async function forceStop(channelId: string): Promise<boolean> {
    try {
      await api("POST", `/api/manage/games/${channelId}/stop`);
      await refresh();
      toastOk("已強制終止");
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toastError(msg);
      return false;
    }
  }

  // Auto-stop polling when the last consumer unmounts. The composable
  // is meant for the manage view; bootstrap kicks it off, route changes
  // tear it down.
  onBeforeUnmount(() => {
    // We don't reference-count callers — the manage shell is the only
    // user. If that changes, swap in a refcount.
    stop();
  });

  return {
    games,
    signups,
    lastError,
    start,
    stop,
    refresh,
    forceStop,
  };
}
