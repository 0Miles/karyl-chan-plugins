<script setup lang="ts">
import { onMounted, ref } from "vue";
import RoleArtTile from "../components/RoleArtTile.vue";
import ArtCropModal from "../components/ArtCropModal.vue";
import {
  ASSET_LIST,
  assetLabelOf,
  useArt,
} from "../composables/use-art";
import { useToast } from "../composables/use-toast";
import type { AssetKey } from "../types";

/**
 * "Game elements" tab — non-role assets that still need uploadable
 * art. Right now there's one (`lake`), but the structure mirrors
 * ArtView so adding a future asset (`throne`, `questCard`, …) is one
 * entry in ASSET_LIST + one backend key.
 */

const { refreshArt, entryForAsset, uploadAssetBlob, deleteAsset } = useArt();
const { error: toastError } = useToast();

interface CropTarget {
  assetKey: AssetKey;
  file: File;
}
const cropTarget = ref<CropTarget | null>(null);
const cropVisible = ref(false);

function onUpload(assetKey: AssetKey, file: File): void {
  if (file.size > 5 * 1024 * 1024) {
    toastError(`圖檔超過 5 MB（${(file.size / 1024 / 1024).toFixed(1)} MB）`);
    return;
  }
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
    toastError("僅支援 JPEG / PNG / WebP / GIF");
    return;
  }
  cropTarget.value = { assetKey, file };
  cropVisible.value = true;
}

async function onCropConfirm(blob: Blob): Promise<void> {
  if (!cropTarget.value) return;
  const target = cropTarget.value;
  cropVisible.value = false;
  await uploadAssetBlob(target.assetKey, blob);
  cropTarget.value = null;
}

function onCropClose(): void {
  cropVisible.value = false;
  cropTarget.value = null;
}

onMounted(refreshArt);
</script>

<template>
  <div class="assets-view">
    <section v-for="asset in ASSET_LIST" :key="asset.key" class="card">
      <div class="card-head">
        <h2 class="card-title">
          {{ asset.label }}
          <span class="count">
            <template v-if="entryForAsset(asset.key)">（已上傳）</template>
            <template v-else>（未上傳）</template>
          </span>
        </h2>
        <p v-if="asset.hint" class="role-hint">{{ asset.hint }}</p>
      </div>

      <div class="art-grid single">
        <RoleArtTile
          :label="asset.label"
          faction="neutral"
          :entry="entryForAsset(asset.key)"
          @upload="(file) => onUpload(asset.key, file)"
          @delete="deleteAsset(asset.key)"
        />
      </div>
    </section>

    <ArtCropModal
      v-if="cropTarget"
      :visible="cropVisible"
      :file="cropTarget.file"
      :position-label="assetLabelOf(cropTarget.assetKey)"
      @close="onCropClose"
      @confirm="onCropConfirm"
    />
  </div>
</template>

<style scoped>
.assets-view {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.card-head {
  margin-bottom: 0.65rem;
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
.role-hint {
  color: var(--text-muted);
  font-size: 0.82rem;
  margin-top: 0.3rem;
}
.art-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.85rem;
}
.art-grid.single {
  grid-template-columns: minmax(180px, 240px);
}
</style>
