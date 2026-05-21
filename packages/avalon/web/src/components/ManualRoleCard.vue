<script setup lang="ts">
import { ref } from "vue";
import type { ManualData } from "../game-types";

const props = defineProps<{ role: ManualData["roles"][number] }>();

/** Which card face is shown — only meaningful for variant roles. */
const face = ref(0);

/** Discord copy carries **bold** markers — drop them for plain text. */
function plain(s: string): string {
  return s.replace(/\*\*/g, "");
}

function flip(step: number): void {
  const n = props.role.images.length;
  if (n > 1) face.value = (face.value + step + n) % n;
}
</script>

<template>
  <article class="role-card" :class="`fac-${role.faction}`">
    <div class="art" :class="{ multi: role.images.length > 1 }">
      <!-- Stacked card backs hint at the multiple faces. -->
      <span v-if="role.images.length > 1" class="back back2" />
      <span v-if="role.images.length > 1" class="back back1" />
      <div class="frame">
        <img
          v-if="role.images.length"
          :src="role.images[face]"
          :alt="role.name"
        />
        <div v-else class="art-empty">尚未設定角色圖</div>
      </div>

      <template v-if="role.images.length > 1">
        <button
          class="nav prev"
          type="button"
          aria-label="上一張卡面"
          @click="flip(-1)"
        >
          ‹
        </button>
        <button
          class="nav next"
          type="button"
          aria-label="下一張卡面"
          @click="flip(1)"
        >
          ›
        </button>
        <span class="count">{{ face + 1 }} / {{ role.images.length }}</span>
      </template>
    </div>

    <p class="name">{{ role.name }}</p>
    <p class="short">{{ plain(role.short) }}</p>

    <details class="detail">
      <summary>詳細說明</summary>
      <p class="detail-body">{{ plain(role.detail) }}</p>
    </details>
  </article>
</template>

<style scoped>
.role-card {
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-left: 4px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 1rem 1.1rem;
  box-shadow: var(--shadow-sm);
  /* Uniform height before any card's detail is expanded. */
  min-height: 360px;
  align-self: start;
}
.fac-arthur {
  border-left-color: var(--faction-arthur);
}
.fac-mordred {
  border-left-color: var(--faction-mordred);
}

.art {
  position: relative;
  height: 180px;
  margin-bottom: 0.7rem;
}
/* Front card face. */
.frame {
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-surface-2);
}
.frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.art-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  color: var(--text-faint);
}
/* Offset "card back" layers — only when there are multiple faces. */
.back {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-surface-2);
}
.back1 {
  z-index: 1;
  transform: translate(6px, 6px);
}
.back2 {
  z-index: 0;
  transform: translate(12px, 12px);
}
.art.multi {
  /* Leave room for the offset stack on the bottom-right. */
  margin-right: 12px;
  margin-bottom: 1rem;
}

.nav {
  position: absolute;
  top: 50%;
  z-index: 3;
  width: 26px;
  height: 26px;
  transform: translateY(-50%);
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav:hover {
  background: rgba(0, 0, 0, 0.7);
}
.nav.prev {
  left: 6px;
}
.nav.next {
  right: 6px;
}
.count {
  position: absolute;
  z-index: 3;
  bottom: 6px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.68rem;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 999px;
  padding: 0.05rem 0.45rem;
}

.name {
  font-size: 1.05rem;
  font-weight: 700;
}
.short {
  margin-top: 0.3rem;
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.55;
}
.detail {
  margin-top: auto;
  padding-top: 0.55rem;
}
.detail summary {
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  /* Normal title colour — not the brand accent. */
  color: var(--text);
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
