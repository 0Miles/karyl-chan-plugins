<script setup lang="ts">
import AppButton from "./AppButton.vue";
import type { RoleArtEntry, RolePosition } from "../types";

/**
 * Single art slot tile — used both for single-image roles and for each
 * variant of a variant role. Knows nothing about the role's role-defs;
 * the parent decides whether `variant` should be passed up on actions.
 *
 * Emits:
 *  - upload  → user clicked the upload label + chose a file
 *  - delete  → user clicked the delete button
 */
const props = defineProps<{
  position: RolePosition;
  /** Display label — for variant roles, parent appends "#N". */
  label: string;
  /** Faction colour band — used for the top border. */
  faction: "arthur" | "mordred";
  /** Backend entry for this slot, or undefined when empty. */
  entry?: RoleArtEntry;
  /** Optional slot index — present for variant roles, omitted for single. */
  variant?: number;
}>();

const emit = defineEmits<{
  (e: "upload", file: File): void;
  (e: "delete"): void;
}>();

function onFilePick(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  // Reset so the same file can be re-picked.
  input.value = "";
  if (file) emit("upload", file);
}

function fmtKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

void props;
</script>

<template>
  <div class="art-tile" :class="faction">
    <div class="art-thumb">
      <img v-if="entry" :src="entry.url" :alt="label" />
      <div v-else class="empty-thumb">未上傳</div>
    </div>
    <div class="art-meta">
      <div class="art-label">{{ label }}</div>
      <div v-if="entry" class="art-size">{{ fmtKb(entry.size) }}</div>
    </div>
    <div class="art-actions">
      <label class="upload-btn">
        {{ entry ? "更換" : "上傳" }}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          @change="onFilePick"
        />
      </label>
      <AppButton
        v-if="entry"
        variant="danger"
        size="sm"
        @click="emit('delete')"
      >
        刪除
      </AppButton>
    </div>
  </div>
</template>

<style scoped>
.art-tile {
  background: var(--bg-surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  transition: border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}
.art-tile:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}
.art-tile.arthur {
  border-top: 3px solid var(--faction-arthur);
}
.art-tile.mordred {
  border-top: 3px solid var(--faction-mordred);
}
.art-thumb {
  width: 100%;
  aspect-ratio: 1 / 1;
  background: var(--bg-page);
  border-radius: var(--radius-sm);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.art-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.empty-thumb {
  color: var(--text-faint);
  font-size: 0.85rem;
}
.art-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}
.art-label {
  font-weight: 600;
  font-size: 0.95rem;
}
.art-size {
  color: var(--text-muted);
  font-size: 0.75rem;
}
.art-actions {
  display: flex;
  gap: 0.4rem;
}
.upload-btn {
  flex: 1;
  text-align: center;
  background: var(--bg-surface);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 0.4rem 0.6rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 550;
  transition: background var(--transition-fast),
    border-color var(--transition-fast);
}
.upload-btn:hover {
  background: var(--bg-surface-hover);
  border-color: var(--border-strong);
}
.upload-btn input {
  display: none;
}
</style>
