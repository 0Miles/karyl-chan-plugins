<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    title?: string;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
    width?: string;
  }>(),
  {
    title: "",
    closeOnBackdrop: true,
    closeOnEscape: true,
    width: "min(560px, 95vw)",
  },
);

const emit = defineEmits<{ (e: "close"): void }>();

function onKey(e: KeyboardEvent) {
  if (!props.visible) return;
  if (props.closeOnEscape && e.key === "Escape") {
    e.preventDefault();
    emit("close");
  }
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  // Release the body scroll lock unconditionally on unmount — if the
  // modal happens to be open when its host view unmounts (e.g. token
  // expiry kicks the SPA to the denied view) the visible-watcher
  // below would otherwise leave the body locked.
  document.body.style.overflow = "";
});

watch(
  () => props.visible,
  (open) => {
    document.body.style.overflow = open ? "hidden" : "";
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="app-modal">
      <div
        v-if="visible"
        class="app-modal-backdrop"
        @click.self="closeOnBackdrop && emit('close')"
      >
        <div
          class="app-modal-panel"
          :style="{ width }"
          role="dialog"
          aria-modal="true"
        >
          <header v-if="title || $slots.header" class="app-modal-head">
            <slot name="header">
              <h3>{{ title }}</h3>
            </slot>
            <button
              class="app-modal-x"
              aria-label="Close"
              @click="emit('close')"
            >
              ×
            </button>
          </header>
          <div class="app-modal-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="app-modal-foot">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 50;
}

.app-modal-panel {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--border);
}
.app-modal-head h3 {
  font-size: 1.02rem;
  font-weight: 600;
}
.app-modal-x {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
}
.app-modal-x:hover {
  color: var(--text);
}

.app-modal-body {
  padding: 1rem;
  overflow-y: auto;
  min-height: 0;
}

.app-modal-foot {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--border);
  background: var(--bg-surface-2);
}

.app-modal-enter-active,
.app-modal-leave-active {
  transition: opacity 0.15s ease;
}
.app-modal-enter-active .app-modal-panel,
.app-modal-leave-active .app-modal-panel {
  transition: transform 0.18s ease, opacity 0.15s ease;
}
.app-modal-enter-from,
.app-modal-leave-to {
  opacity: 0;
}
.app-modal-enter-from .app-modal-panel,
.app-modal-leave-to .app-modal-panel {
  transform: translateY(6px) scale(0.98);
}
</style>
