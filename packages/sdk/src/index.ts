// ── v2 API（正式路徑）────────────────────────────────────────────────────────
export {
  definePlugin,
  definePluginCommand,
  defineGuildFeature,
  definePluginCapability,
  definePluginComponent,
  componentCustomId,
} from "./plugin.js";
export type {
  PluginConfigV2,
  PluginCommandDefinition,
  GuildFeatureDefinition,
  PluginCapabilityDefinition,
  PluginComponentDefinition,
  PluginInstance,
  StartedPlugin,
  StartOptions,
} from "./plugin.js";

export type {
  PluginManifestV2,
  ManifestPluginCommand,
  ManifestCapability,
  ManifestGuildFeatureV2,
  ManifestConfigField,
  ManifestCommandOption,
} from "./manifest.js";

export type {
  CommandContext,
  CommandReply,
  CommandOption,
  InteractionContext,
  Logger,
  MessageAttachment,
  WebhookPayload,
  ComponentContext,
  ComponentReply,
} from "./types.js";

export { verifyWebhookToken } from "./webhook-token.js";

export {
  verifyPluginSession,
  hasPluginCapability,
} from "./verify-plugin-session.js";
export type { PluginSessionClaims } from "./verify-plugin-session.js";

// ── v1 API（廢棄，保留相容）──────────────────────────────────────────────────
/**
 * @deprecated 請改用 definePluginCommand。
 * 保留 export 以避免 v1 plugin import 立即爆炸；runtime 呼叫會拋出錯誤。
 * M1-E 升級後移除。
 */
export { defineCommand } from "./plugin.js";
export type {
  /** @deprecated 請改用 PluginConfigV2。 */
  PluginConfig,
  /** @deprecated 請改用 PluginCommandDefinition。 */
  CommandDefinition,
} from "./plugin.js";

/**
 * @deprecated 請改用 PluginManifestV2 + definePlugin（內部自動 buildManifestV2）。
 * M1-E 升級後移除。
 */
export { buildManifest } from "./manifest.js";
export type {
  /** @deprecated 請改用 PluginManifestV2。 */
  Manifest,
  /** @deprecated 請改用 PluginConfigV2。 */
  ManifestConfig,
} from "./manifest.js";
