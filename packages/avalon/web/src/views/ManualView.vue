<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getManual } from "../api";
import type { ManualData } from "../game-types";
import ManualRoleCard from "../components/ManualRoleCard.vue";

const data = ref<ManualData | null>(null);
const failed = ref(false);

onMounted(async () => {
  try {
    data.value = await getManual();
  } catch {
    failed.value = true;
  }
});

/** Discord copy carries **bold** markers — drop them for plain text. */
function plain(s: string): string {
  return s.replace(/\*\*/g, "");
}
</script>

<template>
  <div class="app-wrap">
    <main v-if="failed" class="center-msg">
      <h2>無法載入說明手冊</h2>
      <p>請稍後再試。</p>
    </main>
    <main v-else-if="!data" class="center-msg">載入中…</main>

    <main v-else>
      <h1 class="manual-title">說明手冊</h1>
      <p class="intro">{{ data.intro }}</p>

      <section
        v-for="rule in data.rules"
        :key="rule.title"
        class="card"
      >
        <p class="section-title">{{ rule.title }}</p>
        <div class="rule-content" :class="{ 'has-image': rule.image }">
          <p class="rule-body">{{ plain(rule.body) }}</p>
          <img
            v-if="rule.image"
            :src="rule.image"
            class="rule-image"
            alt=""
          />
        </div>
      </section>

      <h2 class="roles-heading">角色介紹</h2>
      <div class="roles">
        <ManualRoleCard
          v-for="role in data.roles"
          :key="role.position"
          :role="role"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.manual-title {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: -0.01em;
}
.intro {
  margin: 0.5rem 0 1rem;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.6;
}
.rule-content {
  margin-top: 0.4rem;
}
.rule-content.has-image {
  display: flex;
  gap: 0.9rem;
  align-items: flex-start;
}
.rule-body {
  font-size: 0.88rem;
  line-height: 1.65;
  flex: 1;
}
.rule-image {
  flex-shrink: 0;
  width: 132px;
  height: 132px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-surface-2);
}
@media (max-width: 520px) {
  .rule-content.has-image {
    flex-direction: column;
  }
  .rule-image {
    width: 100%;
    height: 160px;
  }
}
.roles-heading {
  margin: 1.4rem 0 0.7rem;
  font-size: 1.05rem;
  font-weight: 650;
}
.roles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.8rem;
}
@media (max-width: 640px) {
  .roles {
    grid-template-columns: 1fr;
  }
}
</style>
