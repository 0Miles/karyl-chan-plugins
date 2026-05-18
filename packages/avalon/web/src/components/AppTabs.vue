<script setup lang="ts" generic="K extends string">
/**
 * AppTabs — controlled tabs primitive.
 *
 * The active key is owned by the parent (v-model:modelValue), matching
 * Vue 3 idiomatic controlled-component shape, so callers can deep-link
 * a tab via URL, persist it to sessionStorage, etc. without a context
 * provider. Counts are optional per-tab; rendered as a muted suffix.
 *
 * Generic over the tab key so consumers get full type-safety on the
 * active key without `as` casts.
 */
interface TabItem {
  key: K;
  label: string;
  count?: number;
}
defineProps<{
  modelValue: K;
  tabs: TabItem[];
}>();
defineEmits<{ (e: "update:modelValue", value: K): void }>();
</script>

<template>
  <div class="app-tabs" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      :class="['app-tabs-tab', { active: modelValue === tab.key }]"
      role="tab"
      :aria-selected="modelValue === tab.key"
      :tabindex="modelValue === tab.key ? 0 : -1"
      @click="$emit('update:modelValue', tab.key)"
    >
      {{ tab.label }}
      <span v-if="tab.count !== undefined" class="app-tabs-count">
        {{ tab.count }}
      </span>
    </button>
  </div>
</template>

<style scoped>
.app-tabs {
  display: flex;
  gap: 0.15rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 1.1rem;
  overflow-x: auto;
  /* Hide horizontal scrollbar but allow scroll on narrow viewports. */
  scrollbar-width: none;
}
.app-tabs::-webkit-scrollbar { display: none; }

.app-tabs-tab {
  appearance: none;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  padding: 0.65rem 1.1rem;
  cursor: pointer;
  font-size: 0.92rem;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  transition: color var(--transition-fast), border-color var(--transition-fast),
    background var(--transition-fast);
  margin-bottom: -1px;
  white-space: nowrap;
}
.app-tabs-tab:hover {
  color: var(--text);
  background: var(--bg-surface-hover);
}
.app-tabs-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}
.app-tabs-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: 4px;
}

.app-tabs-count {
  background: var(--bg-surface-2);
  border: 1px solid var(--border);
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  font-size: 0.75rem;
  color: var(--text-faint);
  font-weight: 500;
  min-width: 1.4rem;
  text-align: center;
}
.app-tabs-tab.active .app-tabs-count {
  background: var(--accent-bg);
  color: var(--accent-text);
  border-color: transparent;
}
</style>
