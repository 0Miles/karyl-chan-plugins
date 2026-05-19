<script setup lang="ts">
import { onMounted, ref } from "vue";
import RoleArtTile from "../components/RoleArtTile.vue";
import ArtCropModal from "../components/ArtCropModal.vue";
import { ROLE_LIST, labelOf, useArt } from "../composables/use-art";
import { useToast } from "../composables/use-toast";
import type { RolePosition } from "../types";

const { art, refreshArt, uploadBlob, deleteArt, entryFor, filledCount } =
  useArt();
const { error: toastError } = useToast();

interface CropTarget {
  position: RolePosition;
  /** undefined for single-image roles; 1..variantCount otherwise. */
  variant?: number;
  file: File;
}
const cropTarget = ref<CropTarget | null>(null);
const cropVisible = ref(false);

function onTileUpload(
  position: RolePosition,
  variant: number | undefined,
  file: File,
): void {
  if (file.size > 5 * 1024 * 1024) {
    toastError(`圖檔超過 5 MB（${(file.size / 1024 / 1024).toFixed(1)} MB）`);
    return;
  }
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
    toastError("僅支援 JPEG / PNG / WebP / GIF");
    return;
  }
  cropTarget.value = { position, variant, file };
  cropVisible.value = true;
}

async function onCropConfirm(blob: Blob): Promise<void> {
  if (!cropTarget.value) return;
  const target = cropTarget.value;
  cropVisible.value = false;
  await uploadBlob(target.position, blob, { variant: target.variant });
  cropTarget.value = null;
}

function onCropClose(): void {
  cropVisible.value = false;
  cropTarget.value = null;
}

function cropTargetLabel(): string {
  if (!cropTarget.value) return "";
  const { position, variant } = cropTarget.value;
  return variant === undefined
    ? labelOf(position)
    : `${labelOf(position)} #${variant}`;
}

/**
 * Render-friendly slot list for one role: a single `[undefined]` entry
 * for single-image roles, `[1, 2, …, N]` for variant roles. Keeps the
 * template a single v-for loop and removes the variant/non-variant
 * fork in the original implementation.
 */
function slotSequence(variantCount: number | undefined): Array<number | undefined> {
  if (!variantCount) return [undefined];
  return Array.from({ length: variantCount }, (_, i) => i + 1);
}

function tileLabel(roleLabel: string, variant: number | undefined): string {
  return variant === undefined ? roleLabel : `${roleLabel} #${variant}`;
}

onMounted(refreshArt);
void art;
</script>

<template>
  <div class="art-view">
    <section
      v-for="role in ROLE_LIST"
      :key="role.position"
      class="card"
    >
      <div class="card-head">
        <h2 class="card-title">
          {{ role.label }}
          <span class="count">
            <template v-if="role.variantCount">
              ({{ filledCount(role.position) }} / {{ role.variantCount }})
            </template>
            <template v-else-if="entryFor(role.position)">
              （已上傳）
            </template>
            <template v-else>（未上傳）</template>
          </span>
        </h2>
        <p v-if="role.variantCount" class="role-hint">
          可上傳 {{ role.variantCount }}
          張不同卡面；同場遊戲中依座位順序對應使用，不重複。
        </p>
      </div>

      <div class="art-grid" :class="{ single: !role.variantCount }">
        <RoleArtTile
          v-for="variant in slotSequence(role.variantCount)"
          :key="variant ?? 'single'"
          :label="tileLabel(role.label, variant)"
          :faction="role.faction"
          :entry="entryFor(role.position, variant)"
          @upload="(file) => onTileUpload(role.position, variant, file)"
          @delete="deleteArt(role.position, { variant })"
        />
      </div>
    </section>

    <ArtCropModal
      v-if="cropTarget"
      :visible="cropVisible"
      :file="cropTarget.file"
      :position-label="cropTargetLabel()"
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
/* Single-image roles render one tile; cap its width so the lone
   tile doesn't stretch full-width on a 1100 px wrapper. */
.art-grid.single {
  grid-template-columns: minmax(180px, 240px);
}
</style>
