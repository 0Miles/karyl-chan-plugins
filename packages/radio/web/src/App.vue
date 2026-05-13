<script setup lang="ts">
import { computed, ref } from "vue";
import AppToast from "./components/AppToast.vue";
import DeniedView from "./views/DeniedView.vue";
import ManageView from "./views/ManageView.vue";
import SessionView from "./views/SessionView.vue";
import {
  decodeJwt,
  onAccessDenied,
  readTokenFromUrl,
  setToken,
  type JwtClaims,
} from "./api";

const PLUGIN_KEY = "karyl-radio";

const token = readTokenFromUrl();
setToken(token);
const initialClaims: JwtClaims | null = token ? decodeJwt(token) : null;

const claims = ref<JwtClaims | null>(initialClaims);
const deniedMessage = ref<string | null>(null);

if (!token || !claims.value) {
  deniedMessage.value =
    "No valid token. Run /radio manage or use a play/queue response button.";
}

onAccessDenied((msg) => {
  deniedMessage.value = msg || "Access denied — re-open the link / ask an admin.";
  claims.value = null;
});

const isAdmin = computed(() => {
  const caps = Array.isArray(claims.value?.capabilities)
    ? (claims.value!.capabilities as string[])
    : [];
  return (
    caps.includes("admin") || caps.includes(`plugin:${PLUGIN_KEY}:webui.access`)
  );
});

const view = computed<"denied" | "session" | "manage">(() => {
  if (deniedMessage.value) return "denied";
  if (claims.value?.guildId) return "session";
  if (isAdmin.value) return "manage";
  deniedMessage.value = "This link doesn't grant access to the admin panel.";
  return "denied";
});

const modeLabel = computed(() => {
  if (view.value === "session") return "playback session";
  if (view.value === "manage") return "admin · library";
  return "";
});
</script>

<template>
  <div class="app-wrap">
    <header class="app-header">
      <h1>📻 Karyl Radio</h1>
      <span class="mode">{{ modeLabel }}</span>
    </header>

    <DeniedView
      v-if="view === 'denied'"
      :message="deniedMessage || 'Access denied'"
    />
    <SessionView
      v-else-if="view === 'session'"
      :guild-id="String(claims!.guildId)"
    />
    <ManageView v-else-if="view === 'manage'" />

    <AppToast />
  </div>
</template>
