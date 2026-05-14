<script setup lang="ts">
import { computed } from "vue";
import AppButton from "./AppButton.vue";
import Thumb from "./Thumb.vue";
import TrackLink from "./TrackLink.vue";
import { trackMeta } from "../composables/use-format";
import type { PlayedTrack } from "../types";

const props = defineProps<{ played: PlayedTrack[] }>();
defineEmits<{ (e: "replay", seq: number): void }>();

// Newest first.
const reversed = computed(() => [...props.played].reverse());

function sub(t: PlayedTrack): string {
  const meta = trackMeta(t);
  const who = t.queuedByName || t.queuedBy;
  const queued = who ? "queued by " + who : "";
  return [meta, queued].filter(Boolean).join(" · ");
}
</script>

<template>
  <ul class="list">
    <li v-if="played.length === 0" class="empty">
      Nothing played yet this session.
    </li>
    <li v-for="t in reversed" :key="t.seq" class="item">
      <Thumb :src="t.coverUrl" />
      <div class="info">
        <div class="name">
          <TrackLink :label="t.label" :url="t.sourceUrl" />
        </div>
        <div class="dim" v-if="sub(t)">{{ sub(t) }}</div>
      </div>
      <div class="actions">
        <AppButton variant="ghost" size="sm" title="Re-queue this track" @click="$emit('replay', t.seq)">↻</AppButton>
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
