<script setup lang="ts">
import { onMounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import Thumb from "../components/Thumb.vue";
import TrackLink from "../components/TrackLink.vue";
import EditTrackModal from "../components/EditTrackModal.vue";
import { api } from "../api";
import { useToast } from "../composables/use-toast";
import { fmtDur, fmtSize } from "../composables/use-format";
import type { LibraryTrack } from "../types";

const { ok, error } = useToast();

const tracks = ref<LibraryTrack[]>([]);
const dlUrl = ref("");
const searchText = ref("");
const downloading = ref(false);
const editing = ref<LibraryTrack | null>(null);
const editVisible = ref(false);

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

async function startDownload() {
  const u = dlUrl.value.trim();
  if (!u) return;
  downloading.value = true;
  try {
    const r = await api<{ alreadyExisted?: boolean }>(
      "POST",
      "/api/tracks/download",
      { url: u },
    );
    dlUrl.value = "";
    if (r?.alreadyExisted) {
      ok("Already in library");
      load();
    } else {
      ok("Download started — refresh shortly");
      setTimeout(load, 6000);
    }
  } catch (e: any) {
    error(e.message);
  } finally {
    downloading.value = false;
  }
}

function openEdit(t: LibraryTrack) {
  editing.value = t;
  editVisible.value = true;
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

onMounted(load);
</script>

<template>
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
      <li v-if="tracks.length === 0" class="empty">No tracks.</li>
      <li v-for="t in tracks" :key="t.id" class="item">
        <Thumb :src="t.coverUrl" />
        <div class="info">
          <div class="name">
            <TrackLink :label="t.title" :url="t.sourceUrl" />
          </div>
          <div class="dim">{{ subText(t) || " " }}</div>
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
    </ul>
  </section>

  <EditTrackModal
    :track="editing"
    :visible="editVisible"
    @close="editVisible = false"
    @saved="load"
  />
</template>

<style scoped>
.item {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.6rem 0.75rem;
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
