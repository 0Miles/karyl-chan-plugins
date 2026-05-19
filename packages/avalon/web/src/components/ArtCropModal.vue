<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";
import AppButton from "./AppButton.vue";
import AppModal from "./AppModal.vue";

/**
 * Square-aspect cropper modal for uploaded art (roles + game-element
 * assets). The modal is content-agnostic — it just cares about the
 * incoming `file` and the human label to put in its title. The
 * parent decides which slot the resulting blob belongs to.
 *
 * Flow:
 *   1. Parent passes (visible=true, file, positionLabel).
 *   2. The watcher fires `objectURL = URL.createObjectURL(file)` and
 *      mounts Cropper.js on the <img>.
 *   3. User zooms / rotates / drags the selection. Aspect ratio is
 *      locked to 1:1 (square) because the deal-reveal embed renders a
 *      square thumbnail.
 *   4. On confirm: read the selection canvas, downsize to ≤1024×1024,
 *      `canvas.toBlob('image/png', 0.9)` → emit('confirm', blob) so
 *      the parent uploads it through the existing apiUpload path.
 *   5. On close (button / backdrop / Esc / unmount): destroy Cropper
 *      and revoke the objectURL so no blob leaks.
 *
 * The output format is PNG: deterministic, alpha-preserving, and the
 * 5 MB server cap is wildly larger than a 1024² png ever needs. We
 * could pick webp for size but support / banner consistency with the
 * existing GET /art/<file>.<ext> mime mapping wins.
 */

const props = defineProps<{
  visible: boolean;
  file: File | null;
  positionLabel: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "confirm", blob: Blob): void;
}>();

const imgEl = ref<HTMLImageElement | null>(null);
const objectURL = ref<string | null>(null);
const ready = ref(false);
const submitting = ref(false);
let cropper: Cropper | null = null;

/** Max output edge (px). 1024 is enough for Discord embed thumbs and
 *  keeps the upload under the 5 MB server cap with margin to spare. */
const MAX_EDGE = 1024;

function cleanupCropper(): void {
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
  if (objectURL.value) {
    URL.revokeObjectURL(objectURL.value);
    objectURL.value = null;
  }
  ready.value = false;
}

// `immediate: true` so the modal works the first time it's mounted
// with truthy props — its parent uses `v-if="cropTarget"`, so the
// modal mounts with `visible=true, file=<File>` and would otherwise
// never see a prop change to trigger this watcher. `flush: 'post'`
// keeps the DOM read deferred until after Vue has flushed the
// initial render so `imgEl.value` is set.
watch(
  () => [props.visible, props.file] as const,
  async ([visible, file]) => {
    cleanupCropper();
    if (!visible || !file) return;
    objectURL.value = URL.createObjectURL(file);
    // Wait for the <img> to be in DOM with the new src before
    // instantiating cropper.js.
    await nextTick();
    if (!imgEl.value) return;
    cropper = new Cropper(imgEl.value, {
      aspectRatio: 1,
      viewMode: 1, // restrict crop box to the canvas
      autoCropArea: 0.85,
      dragMode: "move",
      background: false,
      responsive: true,
      checkOrientation: true,
      // No fullscreen / no scale flip — keep the UI focused.
      zoomable: true,
      scalable: false,
      ready() {
        ready.value = true;
      },
    });
  },
  { flush: "post", immediate: true },
);

onBeforeUnmount(cleanupCropper);

function onRotateLeft(): void {
  cropper?.rotate(-90);
}
function onRotateRight(): void {
  cropper?.rotate(90);
}
function onReset(): void {
  cropper?.reset();
}
function onZoomIn(): void {
  cropper?.zoom(0.1);
}
function onZoomOut(): void {
  cropper?.zoom(-0.1);
}

async function onConfirm(): Promise<void> {
  if (!cropper || submitting.value) return;
  submitting.value = true;
  try {
    const canvas = cropper.getCroppedCanvas({
      maxWidth: MAX_EDGE,
      maxHeight: MAX_EDGE,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
      // Background only matters for non-square / rotated crops with
      // transparency outside the selection; PNG handles alpha so
      // leave undefined.
    });
    if (!canvas) {
      submitting.value = false;
      return;
    }
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/png", 0.9);
    });
    if (!blob) {
      submitting.value = false;
      return;
    }
    emit("confirm", blob);
  } finally {
    // Parent closes the modal on confirm; reset locally too so reopen
    // on a different file doesn't re-enter the submitting state.
    submitting.value = false;
  }
}

function onClose(): void {
  if (submitting.value) return;
  emit("close");
}
</script>

<template>
  <AppModal
    :visible="visible"
    :title="`裁切圖像 — ${positionLabel}`"
    width="min(640px, 95vw)"
    @close="onClose"
  >
    <div class="crop-body">
      <p class="crop-hint">
        拖曳調整位置與裁切框，使用滾輪或下方按鈕縮放、旋轉。輸出為正方形 PNG，最長邊
        {{ MAX_EDGE }} px。
      </p>
      <div class="crop-stage">
        <img
          v-if="objectURL"
          ref="imgEl"
          :src="objectURL"
          alt="待裁切圖像"
          class="crop-img"
        />
      </div>
      <div v-if="ready" class="crop-tools">
        <AppButton
          variant="secondary"
          size="sm"
          title="放大"
          @click="onZoomIn"
        >
          ➕
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          title="縮小"
          @click="onZoomOut"
        >
          ➖
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          title="向左旋轉 90°"
          @click="onRotateLeft"
        >
          ↺
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          title="向右旋轉 90°"
          @click="onRotateRight"
        >
          ↻
        </AppButton>
        <AppButton
          variant="ghost"
          size="sm"
          title="重設"
          @click="onReset"
        >
          重設
        </AppButton>
      </div>
    </div>
    <template #footer>
      <AppButton variant="ghost" :disabled="submitting" @click="onClose">
        取消
      </AppButton>
      <AppButton
        variant="primary"
        :loading="submitting"
        :disabled="!ready"
        @click="onConfirm"
      >
        確認並上傳
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.crop-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.crop-hint {
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1.45;
}
.crop-stage {
  background: var(--bg-surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  /* Cropper.js claims the height of the <img>; cap so it never blows
     past viewport on portrait phones. */
  max-height: min(65vh, 480px);
  overflow: hidden;
}
.crop-img {
  display: block;
  max-width: 100%;
  /* cropper.js needs the <img> in the DOM but visually replaces it
     with its own canvas overlay — we still set a sensible default
     height so the modal doesn't collapse pre-ready. */
  max-height: min(65vh, 480px);
}
.crop-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: center;
}
</style>
