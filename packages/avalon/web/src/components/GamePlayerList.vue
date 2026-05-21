<script setup lang="ts">
import { computed } from "vue";
import type { PlayerView } from "../game-types";
import {
  FACTION_NAME,
  MARKER_LABEL,
  ROLE_NAME,
  markerColor,
} from "../game-labels";

const props = defineProps<{
  players: PlayerView[];
  viewerSeat: number | null;
}>();

const ordered = computed(() =>
  [...props.players].sort((a, b) => a.seat - b.seat),
);

function initials(name: string): string {
  return [...name][0]?.toUpperCase() ?? "?";
}
</script>

<template>
  <ul class="players">
    <li
      v-for="p in ordered"
      :key="p.userId"
      class="player"
      :class="{
        'player--self': p.seat === viewerSeat,
        'player--mission': p.onMission,
      }"
    >
      <div class="avatar" :style="{ borderColor: markerColor(p) }">
        <img v-if="p.avatarUrl" :src="p.avatarUrl" :alt="p.displayName" />
        <span v-else class="avatar-fallback">
          {{ p.isNpc ? "🤖" : initials(p.displayName) }}
        </span>
      </div>

      <div class="who">
        <div class="name-row">
          <span class="seat">{{ p.seat + 1 }}</span>
          <span class="name">{{ p.displayName }}</span>
          <span v-if="p.isNpc" class="tag tag--npc">NPC</span>
        </div>
        <div class="badge-row">
          <span v-if="p.isLeader" class="tag" title="本回合隊長">👑 隊長</span>
          <span v-if="p.isLadyHolder" class="tag" title="持有湖中女神">
            🔮 湖中女神
          </span>
          <span v-if="p.onMission" class="tag tag--mission" title="在本次任務隊伍中">
            ⚔️ 在隊
          </span>
        </div>
      </div>

      <div class="vision">
        <span
          v-if="p.role"
          class="role-chip"
          :style="{
            background: markerColor(p),
          }"
          :title="FACTION_NAME[p.faction ?? 'arthur']"
        >
          {{ ROLE_NAME[p.role] }}
        </span>
        <span v-else class="marker">
          <span class="dot" :style="{ background: markerColor(p) }" />
          {{ MARKER_LABEL[p.marker] }}
        </span>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.players {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.player {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
}
.player--self {
  border-color: var(--accent);
  background: var(--accent-bg);
}
.player--mission {
  box-shadow: inset 3px 0 0 var(--faction-arthur);
}
.avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 2px solid var(--text-faint);
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface-2);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.avatar-fallback {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-muted);
}
.who {
  flex: 1;
  min-width: 0;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.seat {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-on-accent);
  background: var(--text-faint);
  border-radius: 4px;
  padding: 0.05rem 0.32rem;
  flex-shrink: 0;
}
.name {
  font-weight: 600;
  font-size: 0.92rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.2rem;
}
.tag {
  font-size: 0.68rem;
  color: var(--text-muted);
  background: var(--bg-surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.05rem 0.32rem;
  white-space: nowrap;
}
.tag--npc {
  color: var(--text-faint);
}
.tag--mission {
  color: var(--faction-arthur);
  border-color: color-mix(in srgb, var(--faction-arthur) 40%, transparent);
}
.vision {
  flex-shrink: 0;
}
.marker {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.role-chip {
  font-size: 0.75rem;
  font-weight: 650;
  color: #fff;
  border-radius: 999px;
  padding: 0.16rem 0.55rem;
  white-space: nowrap;
}
</style>
