<script setup lang="ts">
import { onMounted } from "vue";
import "./styles/global.css";
import AppToast from "./components/AppToast.vue";
import DeniedView from "./views/DeniedView.vue";
import ManageView from "./views/ManageView.vue";
import { useManageSession } from "./composables/use-manage-session";

const { view, deniedMessage, bootstrap } = useManageSession();

onMounted(bootstrap);
</script>

<template>
  <div class="app-wrap">
    <header class="app-header">
      <h1>Karyl Avalon — Admin</h1>
      <span class="sub">karyl-avalon</span>
    </header>

    <main v-if="view === 'loading'" class="center-msg">Loading…</main>
    <main v-else-if="view === 'denied'">
      <DeniedView :message="deniedMessage" />
    </main>
    <main v-else>
      <ManageView />
    </main>

    <AppToast />
  </div>
</template>
