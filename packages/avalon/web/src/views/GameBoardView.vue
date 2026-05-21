<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useGameBoard } from "../composables/use-game-board";
import { currentChannelId, currentSessionId, gameApi } from "../api";
import GamePlayerList from "../components/GamePlayerList.vue";
import GameHistory from "../components/GameHistory.vue";
import {
  CURRENT_STAGE_LABEL,
  END_REASON_LABEL,
  FACTION_NAME,
  ROLE_ABILITY,
  ROLE_NAME,
  STAGE_LABEL,
} from "../game-labels";

const { snapshot, status, deniedMessage, connect } = useGameBoard();

onMounted(connect);

// The viewer's role-card artwork. Fetched once — the role is fixed
// for the game — as soon as the first snapshot reveals a role.
const roleArt = ref<string | null>(null);
let roleArtRequested = false;
watch(
  () => snapshot.value?.viewer.role,
  async (role) => {
    if (roleArtRequested || !role) return;
    roleArtRequested = true;
    const channel = currentChannelId();
    if (!channel) return;
    try {
      const res = await gameApi<{ url: string | null }>(
        `/api/game/role-art?channel=${encodeURIComponent(channel)}` +
          `&session=${encodeURIComponent(currentSessionId())}`,
      );
      roleArt.value = res.url;
    } catch {
      // Best-effort — the card falls back to a text-only layout.
    }
  },
  { immediate: true },
);

const statusPill = computed(() => {
  switch (status.value) {
    case "connecting":
      return { text: "連線中…", cls: "pill--idle" };
    case "live":
      return { text: "● 即時更新", cls: "pill--live" };
    case "polling":
      return { text: "輪詢更新中", cls: "pill--idle" };
    default:
      return null;
  }
});

const phase = computed(() => {
  const s = snapshot.value;
  if (!s) return "";
  if (s.stage === "ended") {
    const who = s.winner ? FACTION_NAME[s.winner] : "";
    const reason = s.endReason ? END_REASON_LABEL[s.endReason] ?? "" : "";
    return `遊戲結束 · ${who}勝利${reason ? ` · ${reason}` : ""}`;
  }
  if (s.currentStage) {
    return `第 ${s.round} 回合 · ${CURRENT_STAGE_LABEL[s.currentStage] ?? s.currentStage}`;
  }
  return STAGE_LABEL[s.stage] ?? s.stage;
});

/** Five mission cells with size + outcome + current-round flag. */
const missions = computed(() => {
  const s = snapshot.value;
  if (!s) return [];
  return s.missionResults.map((result, i) => ({
    round: i + 1,
    size: s.missionSizes[i] ?? 0,
    result,
    current:
      s.stage !== "ended" && result === null && i + 1 === s.round,
  }));
});
</script>

<template>
  <div class="app-wrap">
    <main v-if="status === 'denied'" class="center-msg">
      <h2>無法載入遊戲板</h2>
      <p>{{ deniedMessage }}</p>
    </main>

    <main v-else-if="status === 'gone' || (!snapshot && status !== 'connecting')">
      <div class="center-msg">
        <h2>找不到對局</h2>
        <p>此頻道目前沒有進行中的阿瓦隆對局，或保留時間已過。</p>
      </div>
    </main>

    <main v-else-if="!snapshot" class="center-msg">載入中…</main>

    <main v-else class="board">
      <section class="board-main">
        <!-- phase + mission track -->
        <div class="card">
          <div class="phase-row">
            <p class="phase">{{ phase }}</p>
            <span v-if="statusPill" class="pill" :class="statusPill.cls">
              {{ statusPill.text }}
            </span>
          </div>
          <p
            v-if="snapshot.stage !== 'ended' && snapshot.consecutiveRejections > 0"
            class="rejections"
          >
            ⚠ 連續否決 {{ snapshot.consecutiveRejections }} / 5
          </p>
          <ol class="track">
            <li
              v-for="m in missions"
              :key="m.round"
              class="mission"
              :class="{
                'mission--success': m.result === 'success',
                'mission--fail': m.result === 'fail',
                'mission--current': m.current,
              }"
            >
              <span class="m-round">第 {{ m.round }} 關</span>
              <span class="m-icon">
                {{
                  m.result === "success"
                    ? "🟦"
                    : m.result === "fail"
                      ? "🟥"
                      : "○"
                }}
              </span>
              <span class="m-size">{{ m.size }} 人</span>
            </li>
          </ol>
        </div>

        <!-- your role card -->
        <div class="card role-card" :class="snapshot.viewer.faction ? `fac-${snapshot.viewer.faction}` : ''">
          <p class="section-title">你的角色</p>
          <template v-if="snapshot.viewer.isPlayer && snapshot.viewer.role">
            <div class="role-head">
              <img
                v-if="roleArt"
                :src="roleArt"
                class="role-img"
                alt=""
              />
              <div class="role-id">
                <p class="role-name">{{ ROLE_NAME[snapshot.viewer.role] }}</p>
                <p v-if="snapshot.viewer.faction" class="role-faction">
                  {{ FACTION_NAME[snapshot.viewer.faction] }}
                </p>
              </div>
            </div>
            <p class="role-ability">{{ ROLE_ABILITY[snapshot.viewer.role] }}</p>
          </template>
          <p v-else class="role-spectator">
            你正在以旁觀者身分檢視，不會看到任何角色或視野資訊。
          </p>
        </div>

        <!-- player list -->
        <div class="card">
          <p class="section-title">玩家（{{ snapshot.players.length }}）</p>
          <GamePlayerList
            :players="snapshot.players"
            :viewer-seat="snapshot.viewer.seat"
          />
        </div>
      </section>

      <aside class="board-side card">
        <p class="section-title">階段歷史</p>
        <GameHistory :events="snapshot.events" :players="snapshot.players" />
      </aside>
    </main>
  </div>
</template>

<style scoped>
.phase-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.pill {
  font-size: 0.74rem;
  font-weight: 600;
  border-radius: 999px;
  padding: 0.18rem 0.6rem;
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.pill--live {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 45%, transparent);
  background: var(--success-bg);
}
.pill--idle {
  color: var(--text-muted);
  background: var(--bg-surface-2);
}

.board {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 0.85rem;
  align-items: start;
}
.board-main {
  min-width: 0;
}
.board-side {
  position: sticky;
  top: 1rem;
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
}
@media (max-width: 760px) {
  .board {
    grid-template-columns: 1fr;
  }
  .board-side {
    position: static;
    max-height: none;
  }
}

.phase {
  font-size: 1.05rem;
  font-weight: 650;
}
.rejections {
  margin-top: 0.3rem;
  font-size: 0.82rem;
  color: var(--danger);
}

.track {
  list-style: none;
  display: flex;
  gap: 0.4rem;
  margin-top: 0.7rem;
}
.mission {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.5rem 0.2rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface-2);
}
.mission--success {
  border-color: var(--faction-arthur);
  background: color-mix(in srgb, var(--faction-arthur) 14%, transparent);
}
.mission--fail {
  border-color: var(--faction-mordred);
  background: color-mix(in srgb, var(--faction-mordred) 14%, transparent);
}
.mission--current {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-bg);
}
.m-round {
  font-size: 0.72rem;
  color: var(--text-muted);
}
.m-icon {
  font-size: 1.1rem;
}
.m-size {
  font-size: 0.72rem;
  color: var(--text-faint);
}

.role-card.fac-arthur {
  border-left: 4px solid var(--faction-arthur);
}
.role-card.fac-mordred {
  border-left: 4px solid var(--faction-mordred);
}
.role-head {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  margin-top: 0.4rem;
}
.role-img {
  width: 76px;
  height: 76px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg-surface-2);
}
.role-id {
  min-width: 0;
}
.role-name {
  font-size: 1.2rem;
  font-weight: 700;
}
.role-faction {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-top: 0.1rem;
}
.role-ability {
  font-size: 0.86rem;
  color: var(--text-muted);
  margin-top: 0.45rem;
  line-height: 1.5;
}
.role-spectator {
  font-size: 0.86rem;
  color: var(--text-muted);
  margin-top: 0.35rem;
  line-height: 1.5;
}
</style>
