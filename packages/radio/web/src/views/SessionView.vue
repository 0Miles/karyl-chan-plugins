<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import NowPlayingCard from "../components/NowPlayingCard.vue";
import PlaylistList from "../components/PlaylistList.vue";
import { api } from "../api";
import { useToast } from "../composables/use-toast";
import type { LoopMode, SessionSnapshot, Track } from "../types";

const props = defineProps<{ guildId: string }>();
const { ok, error } = useToast();

const snap = ref<SessionSnapshot | null>(null);
const pendingAdds = ref<string[]>([]);
const addText = ref("");

const pendingRemoveQids = ref<Set<number>>(new Set());

function addPendingQid(qid: number): void {
  const next = new Set(pendingRemoveQids.value);
  next.add(qid);
  pendingRemoveQids.value = next;
}
function dropPendingQids(qids: Iterable<number>): void {
  const next = new Set(pendingRemoveQids.value);
  for (const q of qids) next.delete(q);
  pendingRemoveQids.value = next;
}

const sessionPath = (suffix = "") =>
  "/api/session/" + encodeURIComponent(props.guildId) + suffix;

let timer: number | undefined;

async function refresh() {
  try {
    snap.value = await api<SessionSnapshot>("GET", sessionPath());
  } catch {
    // Auth errors handled globally; transient network errors stay quiet.
  }
}

async function act(method: string, path: string, body?: unknown) {
  try {
    snap.value = await api<SessionSnapshot>(method, path, body);
  } catch (e: any) {
    error(e.message);
  }
}

async function add() {
  const v = addText.value.trim();
  if (!v) return;
  addText.value = "";
  pendingAdds.value.push(v);
  try {
    snap.value = await api<SessionSnapshot>(
      "POST",
      sessionPath("/queue"),
      { source: v },
    );
    ok("Queued");
  } catch (e: any) {
    error(e.message || "Add failed");
  } finally {
    const i = pendingAdds.value.indexOf(v);
    if (i !== -1) pendingAdds.value.splice(i, 1);
  }
}

function setLoop(mode: LoopMode) {
  act("POST", sessionPath("/loop"), { mode });
}
function setAutoplay(on: boolean) {
  act("POST", sessionPath("/autoplay"), { on });
}

// ── dequeue (batched + optimistic — see PlaylistList ✕ click) ─────
let removeBatch: number[] = [];
let removeFlushTimer: number | undefined;
const DEQUEUE_FLUSH_MS = 90;

function scheduleDequeue(qid: number): void {
  addPendingQid(qid);
  if (!removeBatch.includes(qid)) removeBatch.push(qid);
  if (removeFlushTimer !== undefined) window.clearTimeout(removeFlushTimer);
  removeFlushTimer = window.setTimeout(flushDequeue, DEQUEUE_FLUSH_MS);
}

async function flushDequeue(): Promise<void> {
  removeFlushTimer = undefined;
  const qids = removeBatch;
  removeBatch = [];
  if (qids.length === 0) return;
  try {
    snap.value = await api<SessionSnapshot>(
      "POST",
      sessionPath("/dequeue"),
      { qids },
    );
  } catch (e: any) {
    error(e.message);
    await refresh();
  } finally {
    if (snap.value) {
      const present = new Set(snap.value.playlist.map((t) => t.qid));
      dropPendingQids(qids.filter((q) => !present.has(q)));
    }
  }
}

// ── jump (click any played or upcoming track) ───────────────────
async function jumpTo(qid: number): Promise<void> {
  await act("POST", sessionPath("/jump"), { qid });
}

// ── reorder (drag handle) ───────────────────────────────────────
async function reorder(payload: {
  qid: number;
  beforeQid: number | null;
}): Promise<void> {
  await act("POST", sessionPath("/reorder"), payload);
}

const playlist = computed<Track[]>(() => snap.value?.playlist ?? []);
const cursorQid = computed<number | null>(() => snap.value?.cursorQid ?? null);
const currentTrack = computed<Track | null>(() => {
  if (cursorQid.value === null) return null;
  return playlist.value.find((t) => t.qid === cursorQid.value) ?? null;
});

onMounted(() => {
  refresh();
  timer = window.setInterval(refresh, 5000);
});
onUnmounted(() => {
  if (timer !== undefined) clearInterval(timer);
});
</script>

<template>
  <template v-if="snap">
    <NowPlayingCard
      :snap="snap"
      :current="currentTrack"
      @prev="act('POST', sessionPath('/prev'))"
      @pause="(paused: boolean) => act('POST', sessionPath('/pause'), { paused })"
      @next="act('POST', sessionPath('/next'))"
      @stop="act('POST', sessionPath('/stop'))"
      @loop="setLoop"
      @autoplay="setAutoplay"
    />

    <div class="card">
      <form class="row" @submit.prevent="add">
        <input
          v-model="addText"
          class="grow"
          placeholder="Add to queue — station key / library title / http(s) URL"
        />
        <AppButton type="submit">➕ Add</AppButton>
      </form>
    </div>

    <div class="topbar topbar-clear">
      <span class="muted">{{ playlist.length }} track{{ playlist.length === 1 ? "" : "s" }} in playlist</span>
      <AppButton
        variant="ghost"
        size="sm"
        @click="act('POST', sessionPath('/clear'))"
      >Clear upcoming</AppButton>
    </div>

    <PlaylistList
      :playlist="playlist"
      :cursor-qid="cursorQid"
      :pending-remove-qids="pendingRemoveQids"
      :pending-adds="pendingAdds"
      @dequeue="scheduleDequeue"
      @jump="jumpTo"
      @reorder="reorder"
    />
  </template>
</template>

<style scoped>
.topbar-clear {
  margin: 1rem 0 0.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
