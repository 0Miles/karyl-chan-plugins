import { computed, ref } from "vue";
import { api, apiUpload } from "../api";
import type { ArtResponse, RoleArtEntry, RolePosition } from "../types";
import { useToast } from "./use-toast";

/**
 * Role-art list + upload/delete state, shared module-level so the
 * tab views read the same source of truth.
 *
 * The backend has two flavours of slots:
 *  - Single-image positions (merlin, percival, assassin, morgana,
 *    mordred, oberon): one image, route `/api/manage/art/:position`.
 *  - Variant positions (loyal, minion): N images, route
 *    `/api/manage/art/:position/:variant` where variant is 1..N.
 *
 * Uploads always go through uploadBlob — accepts a File or Blob so
 * the cropper modal can hand us either a fresh canvas blob or (less
 * commonly) the raw file.
 */
const art = ref<RoleArtEntry[]>([]);

export type RoleFaction = "arthur" | "mordred";

export interface RoleDef {
  position: RolePosition;
  label: string;
  faction: RoleFaction;
  /** undefined for single-image roles; positive integer for variant. */
  variantCount?: number;
}

/**
 * Single source of truth for the per-role UI. Order is render order.
 * Variant counts mirror VARIANT_POSITIONS on the backend; if either
 * side changes, update both.
 */
export const ROLE_LIST: RoleDef[] = [
  { position: "merlin", label: "梅林", faction: "arthur" },
  { position: "percival", label: "派西維爾", faction: "arthur" },
  { position: "loyal", label: "亞瑟的忠臣", faction: "arthur", variantCount: 5 },
  { position: "assassin", label: "刺客", faction: "mordred" },
  { position: "morgana", label: "莫甘娜", faction: "mordred" },
  { position: "mordred", label: "莫德雷德", faction: "mordred" },
  { position: "oberon", label: "奧伯倫", faction: "mordred" },
  { position: "minion", label: "莫德雷德的爪牙", faction: "mordred", variantCount: 3 },
];

export function labelOf(position: RolePosition): string {
  return ROLE_LIST.find((r) => r.position === position)?.label ?? position;
}

/** Key for the artByKey map below: `<position>` for single, `<position>:<variant>` for variant. */
function slotKey(position: RolePosition, variant?: number): string {
  return variant === undefined ? position : `${position}:${variant}`;
}

const artByKey = computed<Record<string, RoleArtEntry | undefined>>(() => {
  const m: Record<string, RoleArtEntry | undefined> = {};
  for (const e of art.value) m[slotKey(e.position, e.variant)] = e;
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
   * Upload to a single-image slot (variant undefined) OR a variant
   * slot (variant: 1..N). Accepts Blob (cropper output) or File.
   */
  async function uploadBlob(
    position: RolePosition,
    blob: Blob,
    options: { variant?: number } = {},
  ): Promise<boolean> {
    const path =
      options.variant === undefined
        ? `/api/manage/art/${position}`
        : `/api/manage/art/${position}/${options.variant}`;
    const filename =
      options.variant === undefined
        ? `${position}.png`
        : `${position}-${options.variant}.png`;
    try {
      const file =
        blob instanceof File
          ? blob
          : new File([blob], filename, { type: blob.type || "image/png" });
      await apiUpload(path, file);
      await refresh();
      const slotLabel =
        options.variant === undefined
          ? labelOf(position)
          : `${labelOf(position)} #${options.variant}`;
      toastOk(`已上傳 ${slotLabel}`);
      return true;
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function deleteArt(
    position: RolePosition,
    options: { variant?: number } = {},
  ): Promise<boolean> {
    const slotLabel =
      options.variant === undefined
        ? labelOf(position)
        : `${labelOf(position)} #${options.variant}`;
    if (!window.confirm(`刪除「${slotLabel}」的圖像？`)) return false;
    const path =
      options.variant === undefined
        ? `/api/manage/art/${position}`
        : `/api/manage/art/${position}/${options.variant}`;
    try {
      await api("DELETE", path);
      await refresh();
      toastOk(`已刪除 ${slotLabel}`);
      return true;
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /** Look up the entry for a given slot. */
  function entryFor(
    position: RolePosition,
    variant?: number,
  ): RoleArtEntry | undefined {
    return artByKey.value[slotKey(position, variant)];
  }

  /** How many variant slots are filled (for the count badge). */
  function filledCount(position: RolePosition): number {
    return art.value.filter((e) => e.position === position).length;
  }

  /** Total slot count: 1 for single, variantCount for variant. */
  function totalSlots(position: RolePosition): number {
    const def = ROLE_LIST.find((r) => r.position === position);
    return def?.variantCount ?? 1;
  }

  return {
    art,
    artByKey,
    refreshArt,
    uploadBlob,
    deleteArt,
    entryFor,
    filledCount,
    totalSlots,
  };
}
