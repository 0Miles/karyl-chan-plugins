<script setup lang="ts">
import { computed } from "vue";
import AppButton from "./AppButton.vue";
import Thumb from "./Thumb.vue";
import TrackLink from "./TrackLink.vue";
import { trackMeta } from "../composables/use-format";
import type { Track } from "../types";

const props = defineProps<{
  queue: Track[];
  pendingAdds: string[];
  /** qids the user has clicked ✕ on; rendered as locally-hidden so the
   *  list reacts immediately even before the server confirms. */
  pendingRemoveQids: Set<number>;
}>();

defineEmits<{ (e: "dequeue", qid: number): void }>();

function sub(t: Track): string {
  const meta = trackMeta(t);
  const who = t.queuedByName || t.queuedBy;
  const queued = who ? "queued by " + who : "";
  return [meta, queued].filter(Boolean).join(" · ");
}

// Filter out items the user has clicked ✕ on — the parent will
// re-include them only if the server reports them back (e.g. on error).
const visibleQueue = computed(() =>
  props.queue.filter(
    (t) => t.qid === undefined || !props.pendingRemoveQids.has(t.qid),
  ),
);
</script>

<template>
  <ul class="list">
    <li
      v-if="visibleQueue.length === 0 && pendingAdds.length === 0"
      class="empty"
    >
      Queue is empty.
    </li>
    <li
      v-for="(t, i) in visibleQueue"
      :key="t.qid ?? 'idx-' + i"
      class="item"
    >
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
          :disabled="t.qid === undefined"
          @click="t.qid !== undefined && $emit('dequeue', t.qid)"
        >✕</AppButton>
      </div>
    </li>
    <li v-for="src in pendingAdds" :key="'p-' + src" class="item pending">
      <span class="idx" />
      <div class="thumb thumb--sm thumb--placeholder">⏳</div>
      <div class="info">
        <div class="name">{{ src }}</div>
        <div class="dim">adding…</div>
      </div>
    </li>
  </ul>
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
.item.pending { opacity: 0.55; }
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
.actions {
  display: flex;
  gap: 0.35rem;
  flex-shrink: 0;
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
}
</style>
