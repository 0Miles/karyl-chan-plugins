<script setup lang="ts">
import { computed } from "vue";
import type { GameEvent, PlayerView } from "../game-types";
import { describeEvent } from "../game-labels";

const props = defineProps<{
  events: GameEvent[];
  players: PlayerView[];
}>();

/** 0-based seat index → player, for resolving event participants. */
const bySeat = computed(
  () => new Map(props.players.map((p) => [p.seat, p])),
);

/** One card per event, newest first. */
const cards = computed(() =>
  [...props.events].reverse().map((ev) => ({
    seq: ev.seq,
    at: ev.at,
    ...describeEvent(ev),
  })),
);

function initials(name: string): string {
  return [...name][0]?.toUpperCase() ?? "?";
}

function clockOf(ms: number): string {
  return new Date(ms).toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<template>
  <div class="history">
    <p v-if="cards.length === 0" class="empty">尚無事件</p>
    <ol v-else class="feed">
      <li v-for="card in cards" :key="card.seq" class="event-card">
        <div class="head">
          <span class="icon">{{ card.icon }}</span>
          <span class="title">{{ card.title }}</span>
          <span class="time">{{ clockOf(card.at) }}</span>
        </div>
        <p v-if="card.note" class="note">{{ card.note }}</p>

        <ul v-if="card.players.length" class="players">
          <li v-for="ref in card.players" :key="ref.seat" class="player">
            <span class="avatar">
              <img
                v-if="bySeat.get(ref.seat)?.avatarUrl"
                :src="bySeat.get(ref.seat)!.avatarUrl!"
                alt=""
              />
              <span v-else class="avatar-fallback">
                {{
                  bySeat.get(ref.seat)?.isNpc
                    ? "🤖"
                    : initials(bySeat.get(ref.seat)?.displayName ?? "?")
                }}
              </span>
            </span>
            <span class="name">
              {{ bySeat.get(ref.seat)?.displayName ?? `#${ref.seat + 1}` }}
            </span>
            <span
              v-for="tag in ref.tags"
              :key="tag.label"
              class="tag"
              :class="`tag--${tag.kind}`"
            >
              {{ tag.label }}
            </span>
          </li>
        </ul>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.feed {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.event-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface-2);
  padding: 0.6rem 0.65rem;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}
.icon {
  flex-shrink: 0;
}
.title {
  font-weight: 650;
  font-size: 0.85rem;
  flex: 1;
  min-width: 0;
}
.time {
  font-size: 0.7rem;
  color: var(--text-faint);
  flex-shrink: 0;
}
.note {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-top: 0.25rem;
}
.players {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.32rem;
  margin-top: 0.5rem;
}
.player {
  display: flex;
  align-items: center;
  gap: 0.42rem;
}
.avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
  border: 1px solid var(--border);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.avatar-fallback {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
}
.name {
  font-size: 0.82rem;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag {
  flex-shrink: 0;
  font-size: 0.68rem;
  font-weight: 600;
  border-radius: 4px;
  padding: 0.05rem 0.34rem;
  border: 1px solid transparent;
}
.tag--leader {
  color: var(--accent-text);
  background: var(--accent-bg);
}
.tag--mission {
  color: var(--faction-arthur);
  background: color-mix(in srgb, var(--faction-arthur) 14%, transparent);
}
.tag--yes {
  color: var(--success);
  background: var(--success-bg);
}
.tag--no {
  color: var(--danger);
  background: var(--danger-bg);
}
.tag--holder {
  color: #8b5cf6;
  background: rgba(139, 92, 246, 0.14);
}
.tag--target {
  color: var(--text-muted);
  background: var(--bg-surface-hover);
}
.tag--assassin {
  color: var(--faction-mordred);
  background: color-mix(in srgb, var(--faction-mordred) 14%, transparent);
}
</style>
