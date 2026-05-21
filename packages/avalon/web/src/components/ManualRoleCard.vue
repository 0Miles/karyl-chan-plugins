<script setup lang="ts">
import { ref } from "vue";
import type { ManualData } from "../game-types";

const props = defineProps<{ role: ManualData["roles"][number] }>();

/** Which card face is shown — only meaningful for variant roles. */
const face = ref(0);
/** Last flip direction — drives the slide-transition name. */
const dir = ref<"next" | "prev">("next");

/** Discord copy carries **bold** markers — drop them for plain text. */
function plain(s: string): string {
  return s.replace(/\*\*/g, "");
}

function flip(step: number): void {
  const n = props.role.images.length;
  if (n <= 1) return;
  dir.value = step > 0 ? "next" : "prev";
  face.value = (face.value + step + n) % n;
}
</script>

<template>
  <div class="stack" :class="{ multi: role.images.length > 1 }">
    <!-- Whole-card backs hint at the stacked variant faces. -->
    <span v-if="role.images.length > 1" class="ghost g2" aria-hidden="true" />
    <span v-if="role.images.length > 1" class="ghost g1" aria-hidden="true" />

    <!-- Clip box for the sliding card faces. -->
    <div class="viewport">
      <Transition :name="`slide-${dir}`">
        <article
          :key="face"
          class="role-card"
          :class="`fac-${role.faction}`"
        >
          <div class="art">
            <img
              v-if="role.images.length"
              :src="role.images[face]"
              :alt="role.name"
            />
            <div v-else class="art-empty">尚未設定角色圖</div>
          </div>
          <p class="name">{{ role.name }}</p>
          <p class="short">{{ plain(role.short) }}</p>
          <details class="detail">
            <summary>詳細說明</summary>
            <p class="detail-body">{{ plain(role.detail) }}</p>
          </details>
        </article>
      </Transition>
    </div>

    <!-- Side flip controls — revealed on hover. -->
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
    </template>
  </div>
</template>

<style scoped>
.stack {
  position: relative;
  align-self: start;
}

/* ── stacked card backs (whole-card, not just the art) ──────────── */
.ghost {
  position: absolute;
  inset: 0;
  z-index: 0;
  border: 1px solid var(--border);
  border-top: 4px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
}
.g1 {
  transform: translate(6px, 6px);
}
.g2 {
  transform: translate(12px, 12px);
}
/* Leave the stacked backs room inside the grid cell. */
.stack.multi {
  margin-right: 12px;
  margin-bottom: 12px;
}

.viewport {
  position: relative;
  z-index: 1;
  overflow: hidden;
  border-radius: var(--radius);
}

.role-card {
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  /* Faction accent runs along the top edge. */
  border-top: 4px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 1rem 1.1rem;
  box-shadow: var(--shadow-sm);
  /* Tall narrow card — uniform height before any detail expands. */
  min-height: 480px;
  width: 100%;
}
.fac-arthur {
  border-top-color: var(--faction-arthur);
}
.fac-mordred {
  border-top-color: var(--faction-mordred);
}

.art {
  position: relative;
  aspect-ratio: 1;
  margin-bottom: 0.7rem;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-surface-2);
}
.art img {
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

/* ── side flip controls ─────────────────────────────────────────── */
.nav {
  position: absolute;
  top: 50%;
  z-index: 2;
  width: 30px;
  height: 30px;
  transform: translateY(-50%);
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 1.15rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Hidden until the card is hovered / focused. */
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.nav:hover {
  background: rgba(0, 0, 0, 0.75);
}
.nav.prev {
  left: 5px;
}
.nav.next {
  right: 5px;
}
.stack:hover .nav,
.nav:focus-visible {
  opacity: 1;
}

/* ── slide transition on face switch ────────────────────────────── */
.slide-next-enter-active,
.slide-next-leave-active,
.slide-prev-enter-active,
.slide-prev-leave-active {
  transition: transform 0.28s ease, opacity 0.28s ease;
}
/* The leaving face is taken out of flow so the new one fills the slot. */
.slide-next-leave-active,
.slide-prev-leave-active {
  position: absolute;
  inset: 0;
}
.slide-next-enter-from {
  transform: translateX(100%);
  opacity: 0;
}
.slide-next-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}
.slide-prev-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}
.slide-prev-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
</style>
