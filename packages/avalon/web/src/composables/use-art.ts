import { computed, ref } from "vue";
import { api, apiUpload } from "../api";
import type { ArtResponse, RoleArtEntry, RolePosition } from "../types";
import { useToast } from "./use-toast";

/**
 * Role-art list + upload/delete. Shared module-level refs so the
 * games poll and the art tab read the same source of truth.
 *
 * Uploads always go through `uploadBlob` so the caller can ship a
 * cropper-output Blob OR a raw File without branching — the multipart
 * helper in api.ts handles both.
 */
const art = ref<RoleArtEntry[]>([]);

export const ROLE_LIST: Array<{
  position: RolePosition;
  label: string;
  faction: "arthur" | "mordred";
}> = [
  { position: "merlin", label: "梅林", faction: "arthur" },
  { position: "percival", label: "派西維爾", faction: "arthur" },
  { position: "loyal", label: "亞瑟的忠臣", faction: "arthur" },
  { position: "assassin", label: "刺客", faction: "mordred" },
  { position: "morgana", label: "莫甘娜", faction: "mordred" },
  { position: "mordred", label: "莫德雷德", faction: "mordred" },
  { position: "oberon", label: "奧伯倫", faction: "mordred" },
];

export function labelOf(position: RolePosition): string {
  return ROLE_LIST.find((r) => r.position === position)?.label ?? position;
}

const artByPosition = computed<
  Record<RolePosition, RoleArtEntry | undefined>
>(() => {
  const m = {} as Record<RolePosition, RoleArtEntry | undefined>;
  for (const e of art.value) m[e.position] = e;
  return m;
});

async function refresh(): Promise<void> {
  const r = await api<ArtResponse>("GET", "/api/manage/art");
  art.value = r.art || [];
}

export function useArt() {
  const { ok: toastOk, error: toastError } = useToast();

  async function refreshArt(): Promise<void> {
    try {
      await refresh();
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Upload a Blob or File. We accept both so the cropper modal can
   * hand us a freshly-canvased Blob, AND the legacy raw-file fallback
   * (no crop) still works. `apiUpload` wraps it in a FormData under
   * field name `file`.
   */
  async function uploadBlob(
    position: RolePosition,
    blob: Blob,
    filename = `${position}.png`,
  ): Promise<boolean> {
    try {
      const file =
        blob instanceof File
          ? blob
          : new File([blob], filename, { type: blob.type || "image/png" });
      await apiUpload(`/api/manage/art/${position}`, file);
      await refresh();
      toastOk(`已上傳 ${labelOf(position)}`);
      return true;
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function deleteArt(position: RolePosition): Promise<boolean> {
    if (!window.confirm(`刪除「${labelOf(position)}」的圖像？`)) return false;
    try {
      await api("DELETE", `/api/manage/art/${position}`);
      await refresh();
      toastOk(`已刪除 ${labelOf(position)}`);
      return true;
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  return {
    art,
    artByPosition,
    refreshArt,
    uploadBlob,
    deleteArt,
  };
}
