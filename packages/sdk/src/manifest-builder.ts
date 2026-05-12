import type {
  ManifestBehavior,
  ManifestCapability,
  ManifestCommand,
  ManifestGuildFeatureV2,
  ManifestPluginCommand,
  PluginManifestV2,
} from "./manifest.js";
import type {
  BehaviorDefinition,
  GuildFeatureDefinition,
  PluginCapabilityDefinition,
  PluginCommandDefinition,
  PluginConfigV2,
} from "./plugin.js";

/**
 * 將 PluginConfigV2 + pluginUrl 轉成 PluginManifestV2，
 * 提供給 startPluginClient 註冊用。
 * Plugin 作者不需要手動呼叫此函式（definePlugin.start() 內部自動呼叫）。
 */
export function buildManifestV2(
  cfg: PluginConfigV2,
  pluginUrl: string,
): PluginManifestV2 {
  const plugin_commands: ManifestPluginCommand[] = (
    cfg.pluginCommands ?? []
  ).map(
    (cmd: PluginCommandDefinition): ManifestPluginCommand => ({
      name: cmd.name,
      description: cmd.description,
      scope: cmd.scope,
      integration_types: cmd.integrationTypes,
      contexts: cmd.contexts,
      ...(cmd.options ? { options: cmd.options } : {}),
      ...(cmd.defaultMemberPermissions
        ? { default_member_permissions: cmd.defaultMemberPermissions }
        : {}),
      ...(cmd.defaultEphemeral !== undefined
        ? { default_ephemeral: cmd.defaultEphemeral }
        : {}),
      ...(cmd.requiredCapability
        ? { required_capability: cmd.requiredCapability }
        : {}),
    }),
  );

  const behaviors: ManifestBehavior[] = (cfg.behaviors ?? []).map(
    (b: BehaviorDefinition): ManifestBehavior => ({
      key: b.key,
      name: b.key,
      description: b.description,
      webhook_path: b.webhookPath,
      ...(b.slashHints
        ? {
            slashHints: {
              suggested_name: b.slashHints.suggestedName,
              suggested_description: b.slashHints.suggestedDescription,
              options: b.slashHints.options,
            },
          }
        : {}),
    }),
  );

  const capabilities: ManifestCapability[] = (cfg.capabilities ?? []).map(
    (c: PluginCapabilityDefinition): ManifestCapability => ({
      key: c.key,
      description: c.description,
    }),
  );
  if (capabilities.length > 32) {
    throw new Error(
      `buildManifestV2: at most 32 capabilities allowed (got ${capabilities.length})`,
    );
  }
  const seenCapKeys = new Set<string>();
  for (const c of capabilities) {
    if (seenCapKeys.has(c.key)) {
      throw new Error(
        `buildManifestV2: capability key '${c.key}' is declared more than once`,
      );
    }
    seenCapKeys.add(c.key);
  }

  const guild_features: ManifestGuildFeatureV2[] = (
    cfg.guildFeatures ?? []
  ).map(
    (f: GuildFeatureDefinition): ManifestGuildFeatureV2 => ({
      key: f.key,
      name: f.name,
      ...(f.icon ? { icon: f.icon } : {}),
      ...(f.description ? { description: f.description } : {}),
      ...(f.enabledByDefault !== undefined
        ? { enabled_by_default: f.enabledByDefault }
        : {}),
      ...(f.eventsSubscribed ? { events_subscribed: f.eventsSubscribed } : {}),
      ...(f.configSchema ? { config_schema: f.configSchema } : {}),
      ...(f.surfaces ? { surfaces: f.surfaces } : {}),
      ...(f.overviewMetrics ? { overview_metrics: f.overviewMetrics } : {}),
      ...(f.commands && f.commands.length > 0
        ? {
            commands: f.commands.map(
              (cmd): ManifestCommand => ({
                name: cmd.name,
                description: cmd.description,
                scope: cmd.scope,
                integration_types: cmd.integrationTypes,
                contexts: cmd.contexts,
                ...(cmd.options ? { options: cmd.options } : {}),
                ...(cmd.defaultMemberPermissions
                  ? { default_member_permissions: cmd.defaultMemberPermissions }
                  : {}),
                ...(cmd.defaultEphemeral !== undefined
                  ? { default_ephemeral: cmd.defaultEphemeral }
                  : {}),
                ...(cmd.requiredCapability
                  ? { required_capability: cmd.requiredCapability }
                  : {}),
              }),
            ),
          }
        : {}),
    }),
  );

  const manifest: PluginManifestV2 = {
    schema_version: "2",
    plugin: {
      id: cfg.key,
      name: cfg.name,
      version: cfg.version,
      ...(cfg.description ? { description: cfg.description } : {}),
      ...(cfg.author ? { author: cfg.author } : {}),
      ...(cfg.homepage ? { homepage: cfg.homepage } : {}),
      url: pluginUrl,
      healthcheck_path: "/health",
    },
    ...(cfg.rpcMethodsUsed.length > 0
      ? { rpc_methods_used: cfg.rpcMethodsUsed }
      : {}),
    ...(cfg.storage
      ? {
          storage: {
            guild_kv: cfg.storage.guildKv,
            guild_kv_quota_kb: cfg.storage.guildKvQuotaKb,
            requires_secrets: cfg.storage.requiresSecrets,
          },
        }
      : {}),
    ...(cfg.configSchema ? { config_schema: cfg.configSchema } : {}),
    ...(guild_features.length > 0 ? { guild_features } : {}),
    ...(behaviors.length > 0 ? { behaviors } : {}),
    ...(plugin_commands.length > 0 ? { plugin_commands } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    endpoints: {
      plugin_command: "/commands/{command_name}",
      ...((cfg.components ?? []).length > 0
        ? { plugin_component: "/components" }
        : {}),
    },
  };

  return manifest;
}
