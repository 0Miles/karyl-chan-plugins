<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  api,
  decodeJwt,
  exchangeManageJwt,
  loadStoredManage,
  onAccessDenied,
  readTokenFromUrl,
  setManageTokens,
} from "./api";
import type { GamesResponse, GameSnapshot, SignupSnapshot } from "./types";

type View = "loading" | "denied" | "manage";
const view = ref<View>("loading");
const deniedMessage = ref<string | null>(null);
const games = ref<GameSnapshot[]>([]);
const signups = ref<SignupSnapshot[]>([]);
const lastError = ref<string | null>(null);
let pollTimer: number | undefined;

onAccessDenied((msg) => {
  deniedMessage.value = msg || "Access denied — re-run /avalon manage.";
  view.value = "denied";
});

const PLUGIN_KEY = "karyl-avalon";

function isManageClaims(claims: { capabilities?: unknown } | null): boolean {
  const caps = Array.isArray(claims?.capabilities)
    ? (claims!.capabilities as string[])
    : [];
  return (
    caps.includes("admin") || caps.includes(`plugin:${PLUGIN_KEY}:webui.access`)
  );
}

async function bootstrap(): Promise<void> {
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
    await refresh();
    startPolling();
    return;
  }
  // Tab reload: try to pick up an in-flight manage pair.
  if (loadStoredManage()) {
    view.value = "manage";
    await refresh();
    startPolling();
    return;
  }
  deniedMessage.value =
    "Open the link from /avalon manage in Discord to sign in.";
  view.value = "denied";
}

async function refresh(): Promise<void> {
  try {
    const r = await api<GamesResponse>("GET", "/api/manage/games");
    games.value = r.games || [];
    signups.value = r.signups || [];
    lastError.value = null;
  } catch (e: unknown) {
    lastError.value = e instanceof Error ? e.message : String(e);
  }
}

function startPolling(): void {
  pollTimer = window.setInterval(refresh, 4000);
}

async function forceStop(channelId: string): Promise<void> {
  // Both kinds (in-flight game OR pending sign-up) share the same
  // endpoint — the server resolves which one lives at this channel.
  if (
    !window.confirm(
      `強制終止頻道 ${channelId} 的對局 / 報名？此動作無法復原。`,
    )
  ) {
    return;
  }
  try {
    await api("POST", `/api/manage/games/${channelId}/stop`);
    await refresh();
  } catch (e: unknown) {
    lastError.value = e instanceof Error ? e.message : String(e);
  }
}

function fmtAge(startedAt: number): string {
  const ms = Date.now() - startedAt;
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "<1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

onMounted(bootstrap);
onBeforeUnmount(() => {
  if (pollTimer !== undefined) window.clearInterval(pollTimer);
});
</script>

<template>
  <div class="page">
    <header class="hdr">
      <h1>Avalon — Admin</h1>
      <button v-if="view === 'manage'" class="refresh-btn" @click="refresh">
        重新整理
      </button>
    </header>

    <main v-if="view === 'loading'" class="msg">Loading…</main>

    <main v-else-if="view === 'denied'" class="msg denied">
      <h2>無存取權限</h2>
      <p>{{ deniedMessage }}</p>
    </main>

    <main v-else class="manage">
      <section>
        <h2>進行中對局 <span class="count">({{ games.length }})</span></h2>
        <div v-if="games.length === 0" class="empty">目前沒有進行中的對局。</div>
        <table v-else class="tbl">
          <thead>
            <tr>
              <th>頻道</th>
              <th>主持人</th>
              <th>玩家</th>
              <th>輪次</th>
              <th>階段</th>
              <th>啟動</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in games" :key="g.sessionId">
              <td class="mono">{{ g.channelId }}</td>
              <td class="mono">{{ g.hostUserId }}</td>
              <td>{{ g.playerCount }}</td>
              <td>{{ g.round }}</td>
              <td>
                {{ g.stage }}
                <span v-if="g.currentStage" class="sub">/ {{ g.currentStage }}</span>
              </td>
              <td>{{ fmtAge(g.startedAt) }} 前</td>
              <td>
                <button class="danger" @click="forceStop(g.channelId)">
                  強制終止
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>待開報名 <span class="count">({{ signups.length }})</span></h2>
        <div v-if="signups.length === 0" class="empty">目前沒有等待中的報名。</div>
        <table v-else class="tbl">
          <thead>
            <tr>
              <th>頻道</th>
              <th>發起人</th>
              <th>已加入</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in signups" :key="s.channelId">
              <td class="mono">{{ s.channelId }}</td>
              <td>{{ s.hostDisplayName }}</td>
              <td>{{ s.playerCount }}</td>
              <td>
                <button class="danger" @click="forceStop(s.channelId)">
                  取消報名
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <p v-if="lastError" class="err">{{ lastError }}</p>
    </main>
  </div>
</template>

<style>
:root {
  --bg: #1d2021;
  --fg: #ebdbb2;
  --card: #282828;
  --border: #3c3836;
  --accent: #73a936;
  --danger: #cc241d;
  --muted: #928374;
}
* {
  box-sizing: border-box;
}
body {
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  margin: 0;
}
.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.5rem;
}
.hdr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.75rem;
  margin-bottom: 1.25rem;
}
.hdr h1 {
  margin: 0;
  color: var(--accent);
  font-size: 1.5rem;
}
.refresh-btn,
button {
  background: var(--card);
  color: var(--fg);
  border: 1px solid var(--border);
  padding: 0.35rem 0.8rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
}
.refresh-btn:hover,
button:hover {
  background: var(--border);
}
button.danger {
  background: var(--danger);
  color: #fff;
  border-color: var(--danger);
}
button.danger:hover {
  background: #a01f17;
}
.msg {
  text-align: center;
  padding: 4rem 1rem;
}
.msg.denied h2 {
  color: var(--danger);
}
.manage section {
  margin-bottom: 2rem;
}
.manage h2 {
  font-size: 1.05rem;
  margin: 0 0 0.6rem;
}
.count {
  color: var(--muted);
  font-weight: normal;
  font-size: 0.9rem;
}
.empty {
  color: var(--muted);
  padding: 0.75rem;
  background: var(--card);
  border: 1px dashed var(--border);
  border-radius: 4px;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.tbl th,
.tbl td {
  padding: 0.5rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.tbl th {
  background: rgba(0, 0, 0, 0.2);
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--muted);
}
.tbl tr:last-child td {
  border-bottom: none;
}
.mono {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.8rem;
  color: var(--muted);
}
.sub {
  color: var(--muted);
  font-size: 0.85em;
}
.err {
  color: var(--danger);
  font-size: 0.9rem;
  margin-top: 1rem;
}
</style>
