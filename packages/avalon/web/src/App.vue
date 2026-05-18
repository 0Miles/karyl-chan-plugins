<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  api,
  apiUpload,
  decodeJwt,
  exchangeManageJwt,
  loadStoredManage,
  onAccessDenied,
  readTokenFromUrl,
  setManageTokens,
} from "./api";
import type {
  ArtResponse,
  GamesResponse,
  GameSnapshot,
  RoleArtEntry,
  RolePosition,
  SignupSnapshot,
} from "./types";

type View = "loading" | "denied" | "manage";
const view = ref<View>("loading");
const deniedMessage = ref<string | null>(null);
const games = ref<GameSnapshot[]>([]);
const signups = ref<SignupSnapshot[]>([]);
const art = ref<RoleArtEntry[]>([]);
const lastError = ref<string | null>(null);
let pollTimer: number | undefined;

const ROLE_LIST: { position: RolePosition; label: string; faction: "arthur" | "mordred" }[] = [
  { position: "merlin", label: "梅林", faction: "arthur" },
  { position: "percival", label: "派西維爾", faction: "arthur" },
  { position: "loyal", label: "亞瑟的忠臣", faction: "arthur" },
  { position: "assassin", label: "刺客", faction: "mordred" },
  { position: "morgana", label: "莫甘娜", faction: "mordred" },
  { position: "mordred", label: "莫德雷德", faction: "mordred" },
  { position: "oberon", label: "奧伯倫", faction: "mordred" },
];

const artByPosition = computed<Record<string, RoleArtEntry | undefined>>(() => {
  const m: Record<string, RoleArtEntry | undefined> = {};
  for (const e of art.value) m[e.position] = e;
  return m;
});

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
    caps.includes("admin") || caps.includes(`plugin:${PLUGIN_KEY}:manage`)
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
    const [r, a] = await Promise.all([
      api<GamesResponse>("GET", "/api/manage/games"),
      api<ArtResponse>("GET", "/api/manage/art"),
    ]);
    games.value = r.games || [];
    signups.value = r.signups || [];
    art.value = a.art || [];
    lastError.value = null;
  } catch (e: unknown) {
    lastError.value = e instanceof Error ? e.message : String(e);
  }
}

async function uploadArt(position: RolePosition, file: File): Promise<void> {
  try {
    await apiUpload(`/api/manage/art/${position}`, file);
    await refresh();
  } catch (e: unknown) {
    lastError.value = e instanceof Error ? e.message : String(e);
  }
}

async function deleteArt(position: RolePosition): Promise<void> {
  if (!window.confirm(`刪除「${labelOf(position)}」的圖像？`)) return;
  try {
    await api("DELETE", `/api/manage/art/${position}`);
    await refresh();
  } catch (e: unknown) {
    lastError.value = e instanceof Error ? e.message : String(e);
  }
}

function labelOf(position: RolePosition): string {
  return ROLE_LIST.find((r) => r.position === position)?.label ?? position;
}

function onArtFileChange(position: RolePosition, e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // reset so the same file can be re-picked
  if (file) void uploadArt(position, file);
}

function fmtKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

      <section>
        <h2>
          角色圖像
          <span class="count">
            ({{ art.length }} / {{ ROLE_LIST.length }})
          </span>
        </h2>
        <p class="hint">
          每張圖最大 5 MB，支援 JPEG / PNG / WebP / GIF。上傳後會做為發牌階段
          身份卡的縮圖。
        </p>
        <div class="art-grid">
          <div
            v-for="r in ROLE_LIST"
            :key="r.position"
            class="art-tile"
            :class="r.faction"
          >
            <div class="art-thumb">
              <img
                v-if="artByPosition[r.position]"
                :src="artByPosition[r.position]!.url"
                :alt="r.label"
              />
              <div v-else class="empty-thumb">未上傳</div>
            </div>
            <div class="art-meta">
              <div class="art-label">{{ r.label }}</div>
              <div v-if="artByPosition[r.position]" class="art-size">
                {{ fmtKb(artByPosition[r.position]!.size) }}
              </div>
            </div>
            <div class="art-actions">
              <label class="upload-btn">
                {{ artByPosition[r.position] ? "更換" : "上傳" }}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  @change="onArtFileChange(r.position, $event)"
                />
              </label>
              <button
                v-if="artByPosition[r.position]"
                class="danger small"
                @click="deleteArt(r.position)"
              >
                刪除
              </button>
            </div>
          </div>
        </div>
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
.hint {
  color: var(--muted);
  font-size: 0.85rem;
  margin: 0 0 0.75rem;
}
.art-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
}
.art-tile {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.art-tile.arthur {
  border-top: 3px solid #458588;
}
.art-tile.mordred {
  border-top: 3px solid var(--danger);
}
.art-thumb {
  width: 100%;
  aspect-ratio: 1 / 1;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.art-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.empty-thumb {
  color: var(--muted);
  font-size: 0.85rem;
}
.art-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}
.art-label {
  font-weight: 600;
}
.art-size {
  color: var(--muted);
  font-size: 0.75rem;
}
.art-actions {
  display: flex;
  gap: 0.4rem;
}
.upload-btn {
  flex: 1;
  text-align: center;
  background: var(--card);
  color: var(--fg);
  border: 1px solid var(--border);
  padding: 0.35rem 0.6rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}
.upload-btn:hover {
  background: var(--border);
}
.upload-btn input {
  display: none;
}
button.small {
  padding: 0.3rem 0.55rem;
  font-size: 0.8rem;
}
</style>
