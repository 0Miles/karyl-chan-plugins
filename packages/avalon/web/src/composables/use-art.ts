import { computed, ref } from "vue";
import { api, apiUpload } from "../api";
import type {
  ArtResponse,
  AssetEntry,
  AssetKey,
  RoleArtEntry,
  RolePosition,
} from "../types";
import { useToast } from "./use-toast";

/**
 * Role-art + game-element-asset state, shared module-level so the
 * tab views read the same source of truth.
 *
 * The backend exposes three storage flavours:
 *  - Single-image positions (merlin, percival, assassin, morgana,
 *    mordred, oberon): one image, route `/api/manage/art/:position`.
 *  - Variant positions (loyal, minion): N images, route
 *    `/api/manage/art/:position/:variant` where variant is 1..N.
 *  - Non-role assets (lake, …): one image per key, route
 *    `/api/manage/asset/:key`.
 *
 * Uploads always go through uploadBlob/uploadAssetBlob — both accept
 * a File or Blob so the cropper modal can hand us either a fresh
 * canvas blob or (less commonly) the raw file.
 */
const art = ref<RoleArtEntry[]>([]);
const assets = ref<AssetEntry[]>([]);

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

/** Source of truth for the game-element side of the UI. */
export interface AssetDef {
  key: AssetKey;
  label: string;
  /** Optional descriptive line under the title. */
  hint?: string;
}

export const ASSET_LIST: AssetDef[] = [
  {
    key: "lake",
    label: "湖中女神",
    hint: "n≥7 且主持人在報名時啟用時觸發；公開查驗版 + ephemeral 結果都會帶上這張縮圖。",
  },
];

export function assetLabelOf(key: AssetKey): string {
  return ASSET_LIST.find((a) => a.key === key)?.label ?? key;
}

const assetByKey = computed<Record<string, AssetEntry | undefined>>(() => {
  const m: Record<string, AssetEntry | undefined> = {};
  for (const a of assets.value) m[a.assetKey] = a;
  return m;
});

async function refresh(): Promise<void> {
  const r = await api<ArtResponse>("GET", "/api/manage/art");
  art.value = r.art || [];
  assets.value = r.assets || [];
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

  /** Upload to a non-role asset slot (e.g. lake). */
  async function uploadAssetBlob(
    key: AssetKey,
    blob: Blob,
  ): Promise<boolean> {
    try {
      const file =
        blob instanceof File
          ? blob
          : new File([blob], `${key}.png`, {
              type: blob.type || "image/png",
            });
      await apiUpload(`/api/manage/asset/${key}`, file);
      await refresh();
      toastOk(`已上傳 ${assetLabelOf(key)}`);
      return true;
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function deleteAsset(key: AssetKey): Promise<boolean> {
    const label = assetLabelOf(key);
    if (!window.confirm(`刪除「${label}」的圖像？`)) return false;
    try {
      await api("DELETE", `/api/manage/asset/${key}`);
      await refresh();
      toastOk(`已刪除 ${label}`);
      return true;
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  function entryForAsset(key: AssetKey): AssetEntry | undefined {
    return assetByKey.value[key];
  }

  return {
    art,
    artByKey,
    assets,
    assetByKey,
    refreshArt,
    uploadBlob,
    deleteArt,
    entryFor,
    filledCount,
    totalSlots,
    uploadAssetBlob,
    deleteAsset,
    entryForAsset,
  };
}
