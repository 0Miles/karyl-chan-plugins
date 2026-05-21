<script setup lang="ts">
import { onMounted } from "vue";
import "./styles/global.css";
import AppToast from "./components/AppToast.vue";
import DeniedView from "./views/DeniedView.vue";
import ManageView from "./views/ManageView.vue";
import GameBoardView from "./views/GameBoardView.vue";
import ManualView from "./views/ManualView.vue";
import { useAppSession } from "./composables/use-app-session";

const { mode, deniedMessage, bootstrap } = useAppSession();

onMounted(bootstrap);
</script>

<template>
  <!-- Game board + manual render their own page shell. -->
  <GameBoardView v-if="mode === 'game'" />
  <ManualView v-else-if="mode === 'manual'" />

  <!-- Admin panel + loading / denied states share the admin shell. -->
  <div v-else class="app-wrap">
    <header class="app-header">
      <h1>Karyl Avalon — Admin</h1>
      <span class="sub">karyl-avalon</span>
    </header>

    <main v-if="mode === 'loading'" class="center-msg">Loading…</main>
    <main v-else-if="mode === 'denied'">
      <DeniedView :message="deniedMessage" />
    </main>
    <main v-else>
      <ManageView />
    </main>

    <AppToast />
  </div>
</template>
