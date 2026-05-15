<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import Thumb from "../components/Thumb.vue";
import TrackLink from "../components/TrackLink.vue";
import EditTrackModal from "../components/EditTrackModal.vue";
import EditPlaylistModal from "../components/EditPlaylistModal.vue";
import { api } from "../api";
import { useToast } from "../composables/use-toast";
import { fmtDur, fmtSize } from "../composables/use-format";
import type { LibraryTrack, Playlist } from "../types";

const { ok, error } = useToast();

type Tab = "tracks" | "playlists";
const activeTab = ref<Tab>("tracks");

const tracks = ref<LibraryTrack[]>([]);
const dlUrl = ref("");
const searchText = ref("");
const downloading = ref(false);
// Single source of truth for the edit modal: non-null means "open with
// this track", null means closed. Avoids the easy-to-desync mistake of
// updating the track ref but not the visible ref (or vice versa) when
// adding new entry points.
const editing = ref<LibraryTrack | null>(null);
const editVisible = computed(() => editing.value !== null);

// Playlists tab. Single discriminated ref — the literal "new" means
// "open the modal in create mode", a Playlist means "open in edit mode
// with this row", and null means closed. Keeps "what does the modal
// show?" expressible in one piece of state (the same single-source
// invariant the edit-track modal uses).
const playlists = ref<Playlist[]>([]);
type PlaylistEditState = Playlist | "new" | null;
const playlistEditing = ref<PlaylistEditState>(null);
const playlistEditVisible = computed(() => playlistEditing.value !== null);
const playlistEditingTarget = computed<Playlist | null>(() =>
  playlistEditing.value === "new" || playlistEditing.value === null
    ? null
    : playlistEditing.value,
);

/**
 * In-flight downloads waiting to land in the library — rendered as
 * placeholder rows alongside the real tracks (same treatment as the
 * playback session's "adding…" rows for queue inserts). yt-dlp can take
 * 5–30 s; we poll the library every 2 s and drain pending entries FIFO
 * as new track ids appear, with a 60 s safety net per entry.
 */
const pendingDownloads = ref<{ id: number; url: string }[]>([]);
let pendingCounter = 0;
let pollTimer: number | undefined;

async function load() {
  try {
    const q = searchText.value.trim();
    const r = await api<{ tracks: LibraryTrack[] }>(
      "GET",
      "/api/tracks" + (q ? "?q=" + encodeURIComponent(q) : ""),
    );
    tracks.value = r.tracks || [];
  } catch (e: any) {
    error(e.message);
  }
}

function stopPolling(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function ensurePolling(): void {
  if (pollTimer !== undefined) return;
  pollTimer = window.setInterval(async () => {
    if (pendingDownloads.value.length === 0) {
      stopPolling();
      return;
    }
    const prevIds = new Set(tracks.value.map((t) => t.id));
    await load();
    const fresh = tracks.value.filter((t) => !prevIds.has(t.id));
    // FIFO: each newly-arrived library track resolves the oldest pending entry.
    for (let i = 0; i < fresh.length && pendingDownloads.value.length > 0; i++) {
      pendingDownloads.value.shift();
    }
    if (pendingDownloads.value.length === 0) stopPolling();
  }, 2000);
}

async function startDownload() {
  const u = dlUrl.value.trim();
  if (!u) return;
  downloading.value = true;
  const myId = ++pendingCounter;
  pendingDownloads.value.push({ id: myId, url: u });
  try {
    const r = await api<{ alreadyExisted?: boolean }>(
      "POST",
      "/api/tracks/download",
      { url: u },
    );
    dlUrl.value = "";
    if (r?.alreadyExisted) {
      pendingDownloads.value = pendingDownloads.value.filter(
        (p) => p.id !== myId,
      );
      ok("Already in library");
      await load();
    } else {
      ok("Download started");
      ensurePolling();
      // Safety net: drop this pending entry after a minute even if the
      // poller never matched it (server-side download took too long or
      // failed — log will surface it on the next manual refresh).
      window.setTimeout(() => {
        pendingDownloads.value = pendingDownloads.value.filter(
          (p) => p.id !== myId,
        );
        if (pendingDownloads.value.length === 0) stopPolling();
      }, 60_000);
    }
  } catch (e: any) {
    pendingDownloads.value = pendingDownloads.value.filter(
      (p) => p.id !== myId,
    );
    error(e.message);
  } finally {
    downloading.value = false;
  }
}

function openEdit(t: LibraryTrack) {
  editing.value = t;
}
function closeEdit() {
  editing.value = null;
}

// ── Playlists ───────────────────────────────────────────────────────
async function loadPlaylists(): Promise<void> {
  try {
    const r = await api<{ playlists: Playlist[] }>("GET", "/api/playlists");
    playlists.value = r.playlists || [];
  } catch (e: any) {
    error(e.message);
  }
}

function openCreatePlaylist(): void {
  playlistEditing.value = "new";
}
function openEditPlaylist(p: Playlist): void {
  playlistEditing.value = p;
}
function closePlaylistEdit(): void {
  playlistEditing.value = null;
}

async function removePlaylist(p: Playlist): Promise<void> {
  if (!confirm(`Delete playlist "${p.name}"?`)) return;
  try {
    await api("DELETE", "/api/playlists/" + encodeURIComponent(p.id));
    ok("Playlist deleted");
    loadPlaylists();
  } catch (e: any) {
    error(e.message);
  }
}

function entryCountText(n: number): string {
  return n === 1 ? "1 entry" : `${n} entries`;
}

async function removeTrack(t: LibraryTrack) {
  if (!confirm(`Delete "${t.title}"? This removes the audio file.`)) return;
  try {
    await api("DELETE", "/api/tracks/" + encodeURIComponent(t.id));
    ok("Deleted");
    load();
  } catch (e: any) {
    error(e.message);
  }
}

function subText(t: LibraryTrack): string {
  return [t.author, t.album, fmtDur(t.duration), fmtSize(t.sizeBytes)]
    .filter(Boolean)
    .join(" · ");
}

onMounted(() => {
  load();
  loadPlaylists();
});
onBeforeUnmount(stopPolling);
</script>

<template>
  <nav class="tabs" role="tablist" aria-label="Manage sections">
    <button
      type="button"
      role="tab"
      :aria-selected="activeTab === 'tracks'"
      :class="['tab', { 'tab--active': activeTab === 'tracks' }]"
      @click="activeTab = 'tracks'"
    >Tracks</button>
    <button
      type="button"
      role="tab"
      :aria-selected="activeTab === 'playlists'"
      :class="['tab', { 'tab--active': activeTab === 'playlists' }]"
      @click="activeTab = 'playlists'"
    >Playlists</button>
  </nav>

  <template v-if="activeTab === 'tracks'">
    <div class="card">
      <form class="row" @submit.prevent="startDownload">
        <input
          v-model="dlUrl"
          class="grow"
          placeholder="URL to download — YouTube / SoundCloud / direct media (re-uses if already saved)"
        />
        <AppButton type="submit" :loading="downloading">⬇ Download</AppButton>
      </form>
    </div>

    <div class="card">
      <form class="row" @submit.prevent="load">
        <input
          v-model="searchText"
          class="grow"
          placeholder="Search title / album / author / URL…"
        />
        <AppButton variant="ghost" type="submit">Search</AppButton>
      </form>
    </div>

    <section class="section">
      <div class="section-title">Library</div>
      <ul class="list">
        <li
          v-if="tracks.length === 0 && pendingDownloads.length === 0"
          class="empty"
        >No tracks.</li>
        <li v-for="t in tracks" :key="t.id" class="item">
          <Thumb :src="t.coverUrl" />
          <div class="info">
            <div class="name">
              <TrackLink :label="t.title" :url="t.sourceUrl" />
            </div>
            <div class="dim">{{ subText(t) || " " }}</div>
          </div>
          <div class="actions">
            <AppButton variant="ghost" size="sm" @click="openEdit(t)">
              ✎ Edit
            </AppButton>
            <AppButton variant="danger" size="sm" @click="removeTrack(t)">
              🗑
            </AppButton>
          </div>
        </li>
        <li
          v-for="p in pendingDownloads"
          :key="'dl-' + p.id"
          class="item pending"
        >
          <div class="thumb thumb--sm thumb--placeholder">⏳</div>
          <div class="info">
            <div class="name">{{ p.url }}</div>
            <div class="dim">downloading…</div>
          </div>
        </li>
      </ul>
    </section>
  </template>

  <template v-else>
    <div class="card">
      <div class="row">
        <span class="grow muted intro">
          Group library tracks, stations and URLs under a name —
          <code>/radio play &lt;name&gt;</code> queues them all.
        </span>
        <AppButton @click="openCreatePlaylist">+ New playlist</AppButton>
      </div>
    </div>

    <section class="section">
      <div class="section-title">Playlists</div>
      <ul class="list">
        <li v-if="playlists.length === 0" class="empty">
          No playlists yet.
        </li>
        <li v-for="p in playlists" :key="p.id" class="item">
          <div class="thumb thumb--sm thumb--placeholder">🎼</div>
          <div class="info">
            <div class="name">{{ p.name }}</div>
            <div class="dim">
              {{ entryCountText(p.entries.length) }}{{ p.description ? " · " + p.description : "" }}
            </div>
          </div>
          <div class="actions">
            <AppButton variant="ghost" size="sm" @click="openEditPlaylist(p)">
              ✎ Edit
            </AppButton>
            <AppButton variant="danger" size="sm" @click="removePlaylist(p)">
              🗑
            </AppButton>
          </div>
        </li>
      </ul>
    </section>
  </template>

  <EditTrackModal
    :track="editing"
    :visible="editVisible"
    @close="closeEdit"
    @saved="load"
  />

  <EditPlaylistModal
    :playlist="playlistEditingTarget"
    :visible="playlistEditVisible"
    :library="tracks"
    @close="closePlaylistEdit"
    @saved="loadPlaylists"
  />
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.85rem;
  border-bottom: 1px solid var(--border);
}
.tab {
  background: none;
  border: none;
  padding: 0.55rem 0.95rem;
  font: inherit;
  color: var(--text-muted);
  font-weight: 550;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color var(--transition-fast),
    border-color var(--transition-fast);
}
.tab:hover { color: var(--text); }
.tab--active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.intro code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--bg-surface-2);
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
  font-size: 0.82rem;
}

.item {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.6rem 0.75rem;
}
.item.pending { opacity: 0.55; }
.thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: var(--bg-surface-2);
  border-radius: var(--radius-sm);
  color: var(--text-faint);
  font-size: 1.1rem;
  flex-shrink: 0;
}
.info { min-width: 0; flex: 1; }
.name {
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dim {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-top: 0.1rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.actions { display: flex; gap: 0.35rem; flex-shrink: 0; }
</style>
