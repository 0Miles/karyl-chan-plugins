<script setup lang="ts">
import { computed } from "vue";
import type { GameEvent, PlayerView } from "../game-types";
import { describeEvent } from "../game-labels";

const props = defineProps<{
  events: GameEvent[];
  players: PlayerView[];
}>();

/** 0-based seat index → display name (falls back to a seat label). */
const seatName = computed(() => {
  const bySeat = new Map(props.players.map((p) => [p.seat, p.displayName]));
  return (seat: number): string => bySeat.get(seat) ?? `#${seat + 1}`;
});

/** Newest first — the latest happening is what a player checks for. */
const rows = computed(() =>
  [...props.events].reverse().map((ev) => ({
    seq: ev.seq,
    at: ev.at,
    ...describeEvent(ev, seatName.value),
  })),
);

function clockOf(ms: number): string {
  return new Date(ms).toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<template>
  <div class="history">
    <p v-if="rows.length === 0" class="empty">尚無事件</p>
    <ol v-else class="feed">
      <li v-for="row in rows" :key="row.seq" class="event">
        <span class="icon">{{ row.icon }}</span>
        <span class="body">
          <span class="text">{{ row.text }}</span>
          <ul v-if="row.ballots" class="ballots">
            <li
              v-for="b in row.ballots"
              :key="b.name"
              :class="b.vote === 'yes' ? 'ballot--yes' : 'ballot--no'"
            >
              {{ b.vote === "yes" ? "✅" : "❌" }} {{ b.name }}
            </li>
          </ul>
          <span class="time">{{ clockOf(row.at) }}</span>
        </span>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.feed {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.event {
  display: flex;
  gap: 0.5rem;
  font-size: 0.83rem;
  line-height: 1.4;
}
.icon {
  flex-shrink: 0;
  font-size: 0.95rem;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.text {
  color: var(--text);
}
.ballots {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.5rem;
  margin: 0.25rem 0 0.1rem;
}
.ballots li {
  font-size: 0.76rem;
  white-space: nowrap;
}
.ballot--yes {
  color: var(--faction-arthur);
}
.ballot--no {
  color: var(--faction-mordred);
}
.time {
  font-size: 0.7rem;
  color: var(--text-faint);
}
</style>
