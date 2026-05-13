<script setup lang="ts">
import { ref, watch } from "vue";
import AppButton from "./AppButton.vue";
import AppModal from "./AppModal.vue";
import { api, apiUpload } from "../api";
import { useToast } from "../composables/use-toast";
import type { LibraryTrack } from "../types";

const props = defineProps<{
  track: LibraryTrack | null;
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "saved"): void;
}>();

const { ok, error } = useToast();

const title = ref("");
const author = ref("");
const album = ref("");
const coverUrl = ref("");
const coverFile = ref<File | null>(null);
const saving = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

watch(
  () => props.track,
  (t) => {
    if (!t) return;
    title.value = t.title || "";
    author.value = t.author || "";
    album.value = t.album || "";
    coverUrl.value = t.coverUrl || "";
    coverFile.value = null;
    if (fileInput.value) fileInput.value.value = "";
  },
);

function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null;
  coverFile.value = f;
}

async function uploadCover() {
  const t = props.track;
  if (!t) return;
  if (!coverFile.value) {
    error("Pick an image file first");
    return;
  }
  uploading.value = true;
  try {
    const r = await apiUpload<{ track?: LibraryTrack }>(
      `/api/tracks/${encodeURIComponent(t.id)}/cover`,
      coverFile.value,
    );
    if (r?.track?.coverUrl) coverUrl.value = r.track.coverUrl;
    ok("Cover uploaded");
    emit("saved");
  } catch (e: any) {
    error(e.message);
  } finally {
    uploading.value = false;
  }
}

async function save() {
  const t = props.track;
  if (!t) return;
  saving.value = true;
  try {
    await api("PATCH", `/api/tracks/${encodeURIComponent(t.id)}`, {
      title: title.value,
      author: author.value,
      album: album.value,
      coverUrl: coverUrl.value,
    });
    ok("Saved");
    emit("saved");
    emit("close");
  } catch (e: any) {
    error(e.message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :visible="visible" title="Edit metadata" @close="emit('close')">
    <form class="edit-form" @submit.prevent="save">
      <div class="field">
        <label>Title</label>
        <input v-model="title" />
      </div>
      <div class="field">
        <label>Author / artist</label>
        <input v-model="author" />
      </div>
      <div class="field">
        <label>Album</label>
        <input v-model="album" />
      </div>
      <div class="field">
        <label>Cover image URL</label>
        <input v-model="coverUrl" placeholder="https://… (or upload below)" />
      </div>
      <div class="field">
        <label>Upload cover image (jpg / png / webp / gif, ≤ 5 MB)</label>
        <div class="row">
          <input
            ref="fileInput"
            type="file"
            class="grow"
            accept="image/jpeg,image/png,image/webp,image/gif"
            @change="onFile"
          />
          <AppButton variant="ghost" :loading="uploading" @click="uploadCover">
            ⬆ Upload
          </AppButton>
        </div>
      </div>
      <div class="foot">
        <AppButton variant="ghost" @click="emit('close')">Cancel</AppButton>
        <AppButton type="submit" :loading="saving">Save</AppButton>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.edit-form { display: flex; flex-direction: column; gap: 0.85rem; }
.field { display: flex; flex-direction: column; gap: 0.3rem; }
.field label {
  font-size: 0.78rem;
  color: var(--text-muted);
  font-weight: 550;
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.25rem;
}
</style>
