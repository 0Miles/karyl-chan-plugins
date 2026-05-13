<script setup lang="ts">
import AppButton from "./AppButton.vue";
import Thumb from "./Thumb.vue";
import TrackLink from "./TrackLink.vue";
import type { Track } from "../types";

defineProps<{
  queue: Track[];
  pendingAdds: string[];
}>();

defineEmits<{ (e: "dequeue", index: number): void }>();
</script>

<template>
  <ul class="list">
    <li v-if="queue.length === 0 && pendingAdds.length === 0" class="empty">
      Queue is empty.
    </li>
    <li v-for="(t, i) in queue" :key="i" class="item">
      <span class="idx">{{ i + 1 }}.</span>
      <Thumb :src="t.coverUrl" />
      <div class="info">
        <div class="name">
          <TrackLink :label="t.label" :url="t.sourceUrl" />
        </div>
        <div class="dim" v-if="t.queuedByName || t.queuedBy">
          queued by {{ t.queuedByName || t.queuedBy }}
        </div>
      </div>
      <div class="actions">
        <AppButton variant="ghost" size="sm" title="Remove" @click="$emit('dequeue', i)">✕</AppButton>
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
