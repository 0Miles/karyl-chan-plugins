<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getManual } from "../api";
import type { ManualData } from "../game-types";

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
      <h1 class="manual-title">阿瓦隆說明手冊</h1>
      <p class="intro">{{ data.intro }}</p>

      <section
        v-for="rule in data.rules"
        :key="rule.title"
        class="card"
      >
        <p class="section-title">{{ rule.title }}</p>
        <p class="rule-body">{{ plain(rule.body) }}</p>
      </section>

      <h2 class="roles-heading">角色介紹</h2>
      <div class="roles">
        <article
          v-for="role in data.roles"
          :key="role.position"
          class="card role"
          :class="`fac-${role.faction}`"
        >
          <p class="role-name">{{ role.name }}</p>
          <p class="role-short">{{ plain(role.short) }}</p>
          <details class="role-detail">
            <summary>詳細說明</summary>
            <p class="detail-body">{{ plain(role.detail) }}</p>
          </details>
        </article>
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
.rule-body {
  margin-top: 0.4rem;
  font-size: 0.88rem;
  line-height: 1.65;
}
.roles-heading {
  margin: 1.4rem 0 0.7rem;
  font-size: 1.05rem;
  font-weight: 650;
}
.roles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.7rem;
}
@media (max-width: 640px) {
  .roles {
    grid-template-columns: 1fr;
  }
}
.role {
  border-left: 4px solid var(--border-strong);
}
.role.fac-arthur {
  border-left-color: var(--faction-arthur);
}
.role.fac-mordred {
  border-left-color: var(--faction-mordred);
}
.role-name {
  font-size: 1.05rem;
  font-weight: 700;
}
.role-short {
  margin-top: 0.3rem;
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.55;
}
.role-detail {
  margin-top: 0.55rem;
}
.role-detail summary {
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent-text);
  user-select: none;
}
.detail-body {
  margin-top: 0.45rem;
  font-size: 0.84rem;
  line-height: 1.7;
  color: var(--text);
  white-space: pre-wrap;
}
</style>
