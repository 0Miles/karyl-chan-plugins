<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import AppTabs from "../components/AppTabs.vue";
import GamesView from "./GamesView.vue";
import ArtView from "./ArtView.vue";
import { useGamesPoll } from "../composables/use-games-poll";

type TabKey = "games" | "art";

const STORAGE_KEY = "avalon_admin_active_tab";

function loadStoredTab(): TabKey {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  return raw === "games" || raw === "art" ? raw : "games";
}

const activeTab = ref<TabKey>(loadStoredTab());

function onTabChange(next: TabKey): void {
  activeTab.value = next;
  sessionStorage.setItem(STORAGE_KEY, next);
}

const { games, signups, refresh, start } = useGamesPoll();

const gamesTabCount = computed(() => games.value.length + signups.value.length);

const tabs = computed<Array<{ key: TabKey; label: string; count: number | undefined }>>(() => [
  { key: "games", label: "對局與報名", count: gamesTabCount.value },
  { key: "art", label: "角色圖像", count: undefined },
]);

onMounted(() => {
  start();
});
</script>

<template>
  <div class="manage-view">
    <div class="tabs-row">
      <AppTabs :model-value="activeTab" :tabs="tabs" @update:model-value="onTabChange" />
      <AppButton variant="ghost" size="sm" @click="refresh()">
        重新整理
      </AppButton>
    </div>
    <KeepAlive>
      <GamesView v-if="activeTab === 'games'" />
      <ArtView v-else />
    </KeepAlive>
  </div>
</template>

<style scoped>
.manage-view {
  display: flex;
  flex-direction: column;
}
.tabs-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.tabs-row :deep(.app-tabs) {
  flex: 1;
}
</style>
