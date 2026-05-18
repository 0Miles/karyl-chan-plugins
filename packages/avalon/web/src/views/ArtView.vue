<script setup lang="ts">
import { onMounted, ref } from "vue";
import AppButton from "../components/AppButton.vue";
import ArtCropModal from "../components/ArtCropModal.vue";
import { ROLE_LIST, labelOf, useArt } from "../composables/use-art";
import { useToast } from "../composables/use-toast";
import type { RolePosition } from "../types";

const { art, artByPosition, refreshArt, uploadBlob, deleteArt } = useArt();
const { error: toastError } = useToast();

const cropTarget = ref<{ position: RolePosition; file: File } | null>(null);
const cropVisible = ref(false);

function onFilePick(position: RolePosition, e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  // Reset so the SAME file can be re-picked after cancel (the change
  // event doesn't fire on re-selecting an identical value).
  input.value = "";
  if (!file) return;
  // Server caps at 5 MB. Catch on the client too so users don't wait
  // on a multipart round-trip to learn the file is oversized.
  if (file.size > 5 * 1024 * 1024) {
    toastError(`圖檔超過 5 MB（${(file.size / 1024 / 1024).toFixed(1)} MB）`);
    return;
  }
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
    toastError("僅支援 JPEG / PNG / WebP / GIF");
    return;
  }
  cropTarget.value = { position, file };
  cropVisible.value = true;
}

async function onCropConfirm(blob: Blob): Promise<void> {
  if (!cropTarget.value) return;
  const target = cropTarget.value;
  cropVisible.value = false;
  await uploadBlob(target.position, blob, `${target.position}.png`);
  cropTarget.value = null;
}

function onCropClose(): void {
  cropVisible.value = false;
  cropTarget.value = null;
}

function fmtKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

onMounted(refreshArt);
void art;
</script>

<template>
  <div class="art-view">
    <section class="card">
      <div class="card-head">
        <h2 class="card-title">
          角色圖像
          <span class="count">
            ({{ art.length }} / {{ ROLE_LIST.length }})
          </span>
        </h2>
      </div>
      <p class="hint">
        每張圖最大 5 MB，支援 JPEG / PNG / WebP / GIF。挑檔後會開啟裁切視窗，
        確認後上傳；上傳結果做為發牌階段身份卡的縮圖。
      </p>
      <div class="art-grid">
        <div
          v-for="r in ROLE_LIST"
          :key="r.position"
          class="art-tile"
          :class="r.faction"
        >
          <div class="art-thumb">
            <img
              v-if="artByPosition[r.position]"
              :src="artByPosition[r.position]!.url"
              :alt="r.label"
            />
            <div v-else class="empty-thumb">未上傳</div>
          </div>
          <div class="art-meta">
            <div class="art-label">{{ r.label }}</div>
            <div v-if="artByPosition[r.position]" class="art-size">
              {{ fmtKb(artByPosition[r.position]!.size) }}
            </div>
          </div>
          <div class="art-actions">
            <label class="upload-btn">
              {{ artByPosition[r.position] ? "更換" : "上傳" }}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                @change="onFilePick(r.position, $event)"
              />
            </label>
            <AppButton
              v-if="artByPosition[r.position]"
              variant="danger"
              size="sm"
              @click="deleteArt(r.position)"
            >
              刪除
            </AppButton>
          </div>
        </div>
      </div>
    </section>

    <ArtCropModal
      v-if="cropTarget"
      :visible="cropVisible"
      :file="cropTarget.file"
      :position="cropTarget.position"
      :position-label="labelOf(cropTarget.position)"
      @close="onCropClose"
      @confirm="onCropConfirm"
    />
  </div>
</template>

<style scoped>
.art-view {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}
.card-title {
  font-size: 1.0rem;
  font-weight: 600;
}
.count {
  color: var(--text-muted);
  font-weight: normal;
  font-size: 0.85rem;
  margin-left: 0.25rem;
}
.hint {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-bottom: 0.9rem;
}
.art-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 0.85rem;
}
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
