<script setup lang="ts">
import AppButton from "./AppButton.vue";
import Thumb from "./Thumb.vue";
import TrackLink from "./TrackLink.vue";
import type { SessionSnapshot } from "../types";
import { loopBadge, nextLoop, autoplayBadge, trackMeta } from "../composables/use-format";

defineProps<{ snap: SessionSnapshot }>();

const emit = defineEmits<{
  (e: "prev"): void;
  (e: "pause", paused: boolean): void;
  (e: "next"): void;
  (e: "stop"): void;
  (e: "loop", mode: "off" | "track" | "queue"): void;
  (e: "autoplay", on: boolean): void;
}>();

function onLoop(snap: SessionSnapshot) {
  emit("loop", nextLoop(snap.loop));
}
</script>

<template>
  <div class="card">
    <div class="np">
      <Thumb :src="snap.current?.coverUrl" size="lg" />
      <div class="np-meta">
        <div class="np-title">
          <TrackLink
            v-if="snap.current"
            :label="snap.current.label"
            :url="snap.current.sourceUrl"
          />
          <span v-else class="muted">Nothing playing</span>
        </div>
        <div v-if="snap.current && trackMeta(snap.current)" class="np-info">
          {{ trackMeta(snap.current) }}
        </div>
        <div class="np-sub">
          <template v-if="snap.current && (snap.current.queuedByName || snap.current.queuedBy)">
            queued by {{ snap.current.queuedByName || snap.current.queuedBy }} ·
          </template>
          {{ snap.channelId ? "in voice channel" : "not connected" }}
        </div>
        <div class="np-badges">
          <span class="badge">{{ loopBadge(snap.loop) }}</span>
          <span v-if="snap.autoplay" class="badge">
            ♾️ autoplay · {{ snap.autoplayFetchCount || 7 }}
          </span>
        </div>
      </div>
    </div>

    <div class="controls">
      <AppButton
        variant="ghost"
        size="md"
        title="Previous"
        :disabled="!snap.hasPrev"
        @click="emit('prev')"
      >⏮</AppButton>
      <AppButton
        variant="ghost"
        size="md"
        :title="snap.paused ? 'Resume' : 'Pause'"
        @click="emit('pause', !snap.paused)"
      >{{ snap.paused ? "▶️" : "⏸" }}</AppButton>
      <AppButton variant="ghost" size="md" title="Next" @click="emit('next')">⏭</AppButton>
      <AppButton
        variant="danger"
        size="md"
        title="Stop & leave"
        @click="emit('stop')"
      >⏹</AppButton>
      <AppButton variant="ghost" size="sm" @click="onLoop(snap)">
        {{ loopBadge(snap.loop) }}
      </AppButton>
      <AppButton
        variant="ghost"
        size="sm"
        @click="emit('autoplay', !snap.autoplay)"
      >
        {{ autoplayBadge(snap.autoplay, snap.autoplayFetchCount) }}
      </AppButton>
    </div>
  </div>
</template>

<style scoped>
.np {
  display: flex;
  gap: 1rem;
  align-items: center;
}
.np-meta {
  min-width: 0;
  flex: 1;
}
.np-title {
  font-size: 1.1rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.np-info {
  color: var(--text);
  font-size: 0.85rem;
  margin-top: 0.2rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.np-sub {
  color: var(--text-muted);
  font-size: 0.82rem;
  margin-top: 0.15rem;
}
.np-badges {
  margin-top: 0.5rem;
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: var(--accent-bg);
  color: var(--accent-text);
  border-radius: 999px;
  padding: 0.18rem 0.65rem;
  font-size: 0.76rem;
  font-weight: 550;
}

.controls {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.9rem;
  flex-wrap: wrap;
}
</style>
