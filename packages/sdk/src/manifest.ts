import type { CommandOption, InteractionContext } from "./types.js";

// ── v1（廢棄，保留相容）──────────────────────────────────────────────────────

/**
 * @deprecated v1 manifest schema。v2 請改用 PluginManifestV2。
 */
export interface Manifest {
  schema_version: string;
  plugin: {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    url: string;
    healthcheck_path?: string;
  };
  rpc_methods_used: string[];
  storage: { guild_kv: boolean };
  commands: Array<{
    name: string;
    description: string;
    options?: unknown[];
    contexts?: string[];
    default_member_permissions?: string;
  }>;
  /**
   * Endpoint paths advertised to the bot.
   * Schema source: karyl-chan/src/modules/plugin-system/plugin-registry.service.ts:168-173
   */
  endpoints: { command?: string; command_autocomplete?: string };
}

export interface CommandDefinitionForManifest {
  name: string;
  description: string;
  options?: CommandOption[];
  contexts?: InteractionContext[];
  /**
   * Discord PermissionFlagsBits key (e.g. `"ManageGuild"`, `"Administrator"`).
   * The bot's manifest parser translates these names to a numeric bitfield;
   * supplying the raw bitfield as a string also works.
   */
  defaultMemberPermissions?: string;
}

/**
 * @deprecated v1 plugin config for buildManifest(). 請改用 PluginConfigV2 + definePlugin。
 */
export interface ManifestConfig {
  key: string;
  name: string;
  version: string;
  description?: string;
  pluginUrl: string;
  /**
   * @deprecated Has no effect — healthcheck path is always "/health".
   * The SDK mounts GET /health unconditionally. Kept for backward compatibility;
   * will be removed in a future major version.
   */
  healthcheckPath?: string;
  rpcMethodsUsed: string[];
  storage?: { guildKv?: boolean };
  commands: CommandDefinitionForManifest[];
}

/**
 * @deprecated 請改用 PluginManifestV2（schema_version "2"）。
 * 保留以支援既有 v1 plugin build，M1-E 升級後移除。
 * Build a bot-facing manifest from plugin config.
 */
export function buildManifest(cfg: ManifestConfig): Manifest {
  return {
    schema_version: "1",
    plugin: {
      id: cfg.key,
      name: cfg.name,
      version: cfg.version,
      description: cfg.description,
      url: cfg.pluginUrl,
      healthcheck_path: "/health",
    },
    rpc_methods_used: cfg.rpcMethodsUsed,
    storage: { guild_kv: cfg.storage?.guildKv ?? false },
    commands: cfg.commands.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      ...(cmd.options ? { options: cmd.options } : {}),
      ...(cmd.contexts ? { contexts: cmd.contexts } : {}),
      ...(cmd.defaultMemberPermissions
        ? { default_member_permissions: cmd.defaultMemberPermissions }
        : {}),
    })),
    endpoints: { command: "/commands/{command_name}" },
  };
}

// ── v2 介面 ──────────────────────────────────────────────────────────────────

/**
 * Per-field config schema（供 admin UI 渲染用）。
 * 同 karyl-chan bot 端的 ManifestConfigField，此為 SDK 端的對應定義。
 */
export interface ManifestConfigField {
  key: string;
  type:
    | "text"
    | "textarea"
    | "number"
    | "boolean"
    | "select"
    | "channel"
    | "role"
    | "user"
    | "url"
    | "secret"
    | "regex";
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: Array<{ value: string; label: string }>;
}

/**
 * Slash command option 定義（v1 CommandOption 的 manifest-facing alias）。
 * 兩軌共用（軌一 guild_features.commands 與軌三 plugin_commands 皆使用）。
 */
export type ManifestCommandOption = CommandOption;

/**
 * 軌一：Guild Feature v2（結構不變，僅改名標示屬於 v2 schema）。
 * guild_features 完全沿用 v1 ManifestGuildFeature，
 * 內部欄位結構不變，commands[] 改為 ManifestPluginCommand 格式（三軸必填）。
 */
export interface ManifestGuildFeatureV2 {
  key: string;
  name: string;
  icon?: string;
  description?: string;
  enabled_by_default?: boolean;
  events_subscribed?: string[];
  config_schema?: ManifestConfigField[];
  surfaces?: string[];
  overview_metrics?: Array<{ key: string; label: string; type: string }>;
  /** guild-scoped slash commands，隨 feature toggle 管理。 */
  commands?: ManifestCommand[];
}

/** 內部用：guild_features[].commands[] 元素型別（v1 相容格式）。 */
export interface ManifestCommand {
  name: string;
  description: string;
  scope?: "guild" | "global";
  default_member_permissions?: string;
  default_ephemeral?: boolean;
  required_capability?: string;
  dm_permission?: boolean;
  contexts?: ("Guild" | "BotDM" | "PrivateChannel")[];
  integration_types?: ("guild_install" | "user_install")[];
  options?: ManifestCommandOption[];
}

/**
 * 軌三：Plugin 自訂指令（plugin 鎖死三軸，admin 只能 on/off）。
 * scope / integration_types / contexts 三欄全為必填；
 * bot 端 validateManifest 拒絕任何違反三軸規則的 manifest。
 */
export interface ManifestPluginCommand {
  /** Discord slash command name，格式 [a-z0-9][a-z0-9-]{0,31}。 */
  name: string;
  /**
   * 指令說明文字。必填且必須是非空字串（v2 強制要求）。
   */
  description: string;
  /** 三軸：plugin manifest 寫死，admin 不可改。 */
  scope: "guild" | "global";
  integration_types: Array<"guild_install" | "user_install">;
  contexts: Array<"Guild" | "BotDM" | "PrivateChannel">;
  options?: ManifestCommandOption[];
  /**
   * Discord permission bitfield（plugin manifest 寫死，admin 不可改）。
   * 格式同 v1：PermissionFlagsBits key 名稱字串，例如 "ManageGuild"。
   */
  default_member_permissions?: string;
  default_ephemeral?: boolean;
  required_capability?: string;
}

/**
 * Plugin 宣告的一個 RBAC capability 詞條（manifest 形式）。
 */
export interface ManifestCapability {
  /** 詞條 key（plugin 內唯一），格式 [a-z0-9][a-z0-9._-]*。 */
  key: string;
  /** 給 admin 看的說明文字（非空）。 */
  description: string;
}

/**
 * v2 Plugin Manifest 頂層結構。
 * schema_version 必須是字串 "2"；bot 端 validateManifest 拒絕任何其他值。
 */
export interface PluginManifestV2 {
  schema_version: "2";

  plugin: {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    homepage?: string;
    url: string;
    healthcheck_path?: string;
  };

  rpc_methods_used?: string[];
  storage?: {
    guild_kv?: boolean;
    guild_kv_quota_kb?: number;
    requires_secrets?: boolean;
  };
  /** Plugin 級 admin config（不變）。 */
  config_schema?: ManifestConfigField[];

  /** 軌一：Guild features（結構不動）。 */
  guild_features?: ManifestGuildFeatureV2[];

  /** 軌三：Plugin 自訂指令（三軸寫死於 manifest）。 */
  plugin_commands?: ManifestPluginCommand[];

  /**
   * Plugin 自身需要的 RBAC capability 詞條。bot 端在 register 時持久化，
   * 並在 admin「身分組權限」modal 開專屬分頁；plugin 移除時一併清除。
   * 實際 token 形式 `plugin:<plugin.id>:<key>`。
   */
  capabilities?: ManifestCapability[];

  events_subscribed_global?: string[];

  endpoints?: {
    events?: string;
    /** 取代 v1 的 endpoints.command。 */
    plugin_command?: string;
    /** plugin 元件（按鈕）互動派送端點；只有宣告 components 時才出現，預設 `/components`。 */
    plugin_component?: string;
    guild_feature_action?: string;
  };
}
