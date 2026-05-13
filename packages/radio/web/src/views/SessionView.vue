<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import NowPlayingCard from "../components/NowPlayingCard.vue";
import QueueList from "../components/QueueList.vue";
import PlayedList from "../components/PlayedList.vue";
import { api } from "../api";
import { useToast } from "../composables/use-toast";
import type { LoopMode, SessionSnapshot } from "../types";

const props = defineProps<{ guildId: string }>();
const { ok, error } = useToast();

const snap = ref<SessionSnapshot | null>(null);
const pendingAdds = ref<string[]>([]);
const addText = ref("");

const sessionPath = (suffix = "") =>
  "/api/session/" + encodeURIComponent(props.guildId) + suffix;

let timer: number | undefined;

async function refresh() {
  try {
    snap.value = await api<SessionSnapshot>("GET", sessionPath());
  } catch {
    // Auth errors handled globally; transient network errors stay quiet.
  }
}

async function act(method: string, path: string, body?: unknown) {
  try {
    await api(method, path, body);
    await refresh();
  } catch (e: any) {
    error(e.message);
  }
}

async function add() {
  const v = addText.value.trim();
  if (!v) return;
  addText.value = "";
  pendingAdds.value.push(v);
  try {
    await api("POST", sessionPath("/queue"), { source: v });
    ok("Queued");
  } catch (e: any) {
    error(e.message || "Add failed");
  } finally {
    const i = pendingAdds.value.indexOf(v);
    if (i !== -1) pendingAdds.value.splice(i, 1);
    await refresh();
  }
}

function setLoop(mode: LoopMode) {
  act("POST", sessionPath("/loop"), { mode });
}
function setAutoplay(on: boolean) {
  act("POST", sessionPath("/autoplay"), { on });
}

onMounted(() => {
  refresh();
  timer = window.setInterval(refresh, 5000);
});
onUnmounted(() => {
  if (timer !== undefined) clearInterval(timer);
});
</script>

<template>
  <template v-if="snap">
    <NowPlayingCard
      :snap="snap"
      @prev="act('POST', sessionPath('/prev'))"
      @next="act('POST', sessionPath('/next'))"
      @loop="setLoop"
      @autoplay="setAutoplay"
    />

    <div class="card">
      <form class="row" @submit.prevent="add">
        <input
          v-model="addText"
          class="grow"
          placeholder="Add to queue — station key / library title / http(s) URL"
        />
        <AppButton type="submit">➕ Add</AppButton>
      </form>
    </div>

    <section class="section">
      <div class="topbar">
        <div class="section-title">Queue</div>
        <AppButton
          variant="ghost"
          size="sm"
          @click="act('POST', sessionPath('/clear'))"
        >Clear</AppButton>
      </div>
      <QueueList
        :queue="snap.queue"
        :pending-adds="pendingAdds"
        @dequeue="(i: number) => act('POST', sessionPath('/dequeue/' + i))"
      />
    </section>

    <section class="section">
      <div class="topbar">
        <div class="section-title">Played this session</div>
        <AppButton
          variant="ghost"
          size="sm"
          :disabled="snap.played.length === 0"
          @click="act('POST', sessionPath('/replay-all'))"
        >↻ Re-queue all</AppButton>
      </div>
      <PlayedList
        :played="snap.played"
        @replay="(seq: number) => act('POST', sessionPath('/replay/' + seq))"
      />
    </section>
  </template>
</template>
