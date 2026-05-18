<script setup lang="ts">
import { computed } from "vue";
import AppButton from "../components/AppButton.vue";
import { useGamesPoll } from "../composables/use-games-poll";

const { games, signups, lastError, forceStop } = useGamesPoll();

function fmtAge(startedAt: number): string {
  const ms = Date.now() - startedAt;
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "<1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

async function confirmStop(channelId: string): Promise<void> {
  if (
    !window.confirm(
      `強制終止頻道 ${channelId} 的對局 / 報名？此動作無法復原。`,
    )
  ) {
    return;
  }
  await forceStop(channelId);
}

const hasContent = computed(() => games.value.length + signups.value.length > 0);
void hasContent;
</script>

<template>
  <div class="games-view">
    <section class="card">
      <div class="card-head">
        <h2 class="card-title">
          進行中對局
          <span class="count">({{ games.length }})</span>
        </h2>
      </div>
      <div v-if="games.length === 0" class="empty">
        目前沒有進行中的對局。
      </div>
      <div v-else class="table-scroll">
        <table class="tbl">
          <thead>
            <tr>
              <th>頻道</th>
              <th>主持人</th>
              <th>玩家</th>
              <th>輪次</th>
              <th>階段</th>
              <th>啟動</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in games" :key="g.sessionId">
              <td class="mono">{{ g.channelId }}</td>
              <td class="mono">{{ g.hostUserId }}</td>
              <td>{{ g.playerCount }}</td>
              <td>{{ g.round }}</td>
              <td>
                {{ g.stage }}
                <span v-if="g.currentStage" class="sub">
                  / {{ g.currentStage }}
                </span>
              </td>
              <td>{{ fmtAge(g.startedAt) }} 前</td>
              <td>
                <AppButton
                  variant="danger"
                  size="sm"
                  @click="confirmStop(g.channelId)"
                >
                  強制終止
                </AppButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2 class="card-title">
          待開報名
          <span class="count">({{ signups.length }})</span>
        </h2>
      </div>
      <div v-if="signups.length === 0" class="empty">
        目前沒有等待中的報名。
      </div>
      <div v-else class="table-scroll">
        <table class="tbl">
          <thead>
            <tr>
              <th>頻道</th>
              <th>發起人</th>
              <th>已加入</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in signups" :key="s.channelId">
              <td class="mono">{{ s.channelId }}</td>
              <td>{{ s.hostDisplayName }}</td>
              <td>{{ s.playerCount }}</td>
              <td>
                <AppButton
                  variant="danger"
                  size="sm"
                  @click="confirmStop(s.channelId)"
                >
                  取消報名
                </AppButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p v-if="lastError" class="err">{{ lastError }}</p>
  </div>
</template>

<style scoped>
.games-view {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}
.card-title {
  font-size: 1.0rem;
  font-weight: 600;
}
.count {
  color: var(--text-muted);
  font-weight: normal;
  font-size: 0.85rem;
  margin-left: 0.25rem;
}
.table-scroll {
  overflow-x: auto;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
}
.tbl th,
.tbl td {
  padding: 0.55rem 0.8rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
.tbl th {
  background: var(--bg-surface-2);
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tbl tr:last-child td {
  border-bottom: none;
}
.sub {
  color: var(--text-muted);
  font-size: 0.85em;
}
.err {
  color: var(--danger);
  font-size: 0.88rem;
}
</style>
