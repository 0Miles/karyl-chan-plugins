<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Sortable from "sortablejs";
import AppButton from "./AppButton.vue";
import Thumb from "./Thumb.vue";
import TrackLink from "./TrackLink.vue";
import { trackMeta } from "../composables/use-format";
import type { Track } from "../types";

/**
 * Unified playlist view. The full ordered playlist comes in as `playlist`
 * + `cursorQid`; we partition it locally into a played portion (dim,
 * click to jump back) and an upcoming portion (drag handle, click to
 * jump forward, ✕ to remove).
 *
 * The currently-playing track is rendered in the NowPlayingCard above,
 * so it does NOT appear in this list — the partition strictly excludes
 * the cursor entry.
 */
const props = defineProps<{
  playlist: Track[];
  cursorQid: number | null;
  /** qids the user clicked ✕ on; rendered as locally-hidden so the
   *  list reacts immediately before the server confirms. */
  pendingRemoveQids: Set<number>;
  /** qids the user just queued via the Add box that the server hasn't
   *  echoed back yet. Rendered as muted "adding…" placeholders. */
  pendingAdds: string[];
}>();

const emit = defineEmits<{
  (e: "dequeue", qid: number): void;
  (e: "jump", qid: number): void;
  (e: "reorder", payload: { qid: number; beforeQid: number | null }): void;
}>();

const cursorIdx = computed(() => {
  if (props.cursorQid === null) return -1;
  return props.playlist.findIndex((t) => t.qid === props.cursorQid);
});

const played = computed(() => {
  const i = cursorIdx.value;
  if (i <= 0) return [];
  // Display newest-played first.
  return props.playlist.slice(0, i).slice().reverse();
});

const upcoming = computed(() => {
  const i = cursorIdx.value;
  const start = i < 0 ? 0 : i + 1;
  return props.playlist
    .slice(start)
    .filter((t) => !props.pendingRemoveQids.has(t.qid));
});

function sub(t: Track): string {
  const meta = trackMeta(t);
  const who = t.queuedByName || t.queuedBy;
  const queued = who ? "queued by " + who : "";
  return [meta, queued].filter(Boolean).join(" · ");
}

// ── drag-reorder wiring ─────────────────────────────────────────────
//
// SortableJS instance lives on the upcoming <ul> container. Its
// onEnd fires after the DOM has reflected the drag; we read the new
// neighbour's qid from the next sibling (or null when dropped at the
// end) and ask the server to commit. The optimistic re-render comes
// from the next snapshot poll.

const upcomingEl = ref<HTMLElement | null>(null);
let sortable: Sortable | null = null;

function bindSortable() {
  if (!upcomingEl.value || sortable) return;
  sortable = Sortable.create(upcomingEl.value, {
    handle: ".drag-handle",
    animation: 150,
    ghostClass: "drag-ghost",
    chosenClass: "drag-chosen",
    dragClass: "drag-active",
    onEnd: (evt) => {
      const item = evt.item as HTMLElement;
      const movedQid = Number(item.dataset.qid);
      if (!movedQid) return;
      const nextItem = item.nextElementSibling as HTMLElement | null;
      const beforeQid =
        nextItem && nextItem.dataset.qid
          ? Number(nextItem.dataset.qid)
          : null;
      emit("reorder", { qid: movedQid, beforeQid });
    },
  });
}

onMounted(bindSortable);
// The <ul> only mounts when the playlist has anything in it; rebind on
// re-creation (e.g. after a clear+re-add cycle when the placeholder
// "Queue is empty" swapped to a real list).
watch(upcomingEl, (el) => {
  if (sortable) {
    sortable.destroy();
    sortable = null;
  }
  if (el) bindSortable();
});
onBeforeUnmount(() => {
  sortable?.destroy();
  sortable = null;
});
</script>

<template>
  <!-- Played portion: clickable rows to jump backwards. Hidden when empty. -->
  <section v-if="played.length > 0" class="section">
    <div class="section-title">Played this session</div>
    <ul class="list">
      <li
        v-for="t in played"
        :key="'p-' + t.qid"
        class="item played-item"
        title="Click to jump back to this track"
        @click="emit('jump', t.qid)"
      >
        <Thumb :src="t.coverUrl" />
        <div class="info">
          <div class="name">
            <TrackLink :label="t.label" :url="t.sourceUrl" />
          </div>
          <div class="dim" v-if="sub(t)">{{ sub(t) }}</div>
        </div>
        <div class="actions">
          <span class="hint" aria-hidden="true">↶ jump</span>
        </div>
      </li>
    </ul>
  </section>

  <!-- Upcoming portion: drag handle + clickable + ✕ remove. -->
  <section class="section">
    <div class="section-title">Up next</div>
    <ul
      v-if="upcoming.length > 0 || pendingAdds.length > 0"
      ref="upcomingEl"
      class="list upcoming-list"
    >
      <li
        v-for="(t, i) in upcoming"
        :key="t.qid"
        :data-qid="t.qid"
        class="item upcoming-item"
        title="Click to jump to this track"
        @click="emit('jump', t.qid)"
      >
        <span
          class="drag-handle"
          title="Drag to reorder"
          @click.stop
        >⋮⋮</span>
        <span class="idx">{{ i + 1 }}.</span>
        <Thumb :src="t.coverUrl" />
        <div class="info">
          <div class="name">
            <TrackLink :label="t.label" :url="t.sourceUrl" />
          </div>
          <div class="dim" v-if="sub(t)">{{ sub(t) }}</div>
        </div>
        <div class="actions">
          <AppButton
            variant="ghost"
            size="sm"
            title="Remove"
            @click.stop="emit('dequeue', t.qid)"
          >✕</AppButton>
        </div>
      </li>
      <li
        v-for="src in pendingAdds"
        :key="'add-' + src"
        class="item pending"
        :data-skip-drag="true"
      >
        <span class="drag-handle drag-handle--ghost">⋮⋮</span>
        <span class="idx" />
        <div class="thumb thumb--sm thumb--placeholder">⏳</div>
        <div class="info">
          <div class="name">{{ src }}</div>
          <div class="dim">adding…</div>
        </div>
      </li>
    </ul>
    <div v-else class="empty">Up next is empty.</div>
  </section>
</template>

<style scoped>
.section + .section { margin-top: 1rem; }

.item {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.55rem 0.7rem;
  transition: background var(--transition-fast);
}
.item.pending { opacity: 0.55; }

.played-item {
  cursor: pointer;
  opacity: 0.68;
}
.played-item:hover {
  opacity: 1;
  background: var(--bg-surface-hover);
}

.upcoming-item {
  cursor: pointer;
}
.upcoming-item:hover {
  background: var(--bg-surface-hover);
}

.idx {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  width: 1.6em;
  text-align: right;
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
.actions { display: flex; gap: 0.35rem; flex-shrink: 0; align-items: center; }
.hint {
  color: var(--text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
}

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

/* drag */
.drag-handle {
  flex-shrink: 0;
  cursor: grab;
  color: var(--text-faint);
  font-size: 1rem;
  user-select: none;
  padding: 0 0.2rem;
  letter-spacing: -0.15em;
  line-height: 1;
  transition: color var(--transition-fast);
}
.drag-handle:hover { color: var(--text); }
.drag-handle:active { cursor: grabbing; }
.drag-handle--ghost { visibility: hidden; }
.drag-ghost {
  opacity: 0.4;
  background: var(--bg-surface-2);
}
.drag-chosen { box-shadow: 0 0 0 1px var(--accent); }
.drag-active {
  background: var(--bg-surface) !important;
  cursor: grabbing;
}
</style>
