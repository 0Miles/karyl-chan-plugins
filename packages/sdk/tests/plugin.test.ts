/**
 * Build-time validation in the v2 plugin constructors:
 *   - definePluginCommand: name format + non-empty description
 *   - defineGuildFeature: key format + non-empty name
 *   - definePlugin: command names unique across pluginCommands AND
 *     every guildFeatures[].commands[] (they share one /commands/:name
 *     dispatch map)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  definePlugin,
  definePluginCommand,
  defineGuildFeature,
} from "../src/plugin.js";

const okCmd = (name: string) =>
  definePluginCommand({
    name,
    description: "test command",
    scope: "guild",
    integrationTypes: ["guild_install"],
    contexts: ["Guild"],
    handler: async () => "ok",
  });

describe("definePluginCommand validation", () => {
  it("accepts a well-formed command", () => {
    assert.equal(okCmd("radio").name, "radio");
    assert.equal(okCmd("foo-bar2").name, "foo-bar2");
  });
  it("rejects a bad name", () => {
    assert.throws(() => okCmd("Radio"), /must match/i); // uppercase
    assert.throws(() => okCmd("has space"), /must match/i);
    assert.throws(() => okCmd(""), /must match/i);
    assert.throws(() => okCmd("x".repeat(33)), /must match/i); // too long
  });
  it("rejects an empty description", () => {
    assert.throws(
      () =>
        definePluginCommand({
          name: "x",
          description: "  ",
          scope: "guild",
          integrationTypes: ["guild_install"],
          contexts: ["Guild"],
          handler: async () => "ok",
        }),
      /description/i,
    );
  });
});

describe("defineGuildFeature validation", () => {
  it("accepts a well-formed feature", () => {
    const f = defineGuildFeature({
      key: "radio",
      name: "Karyl Radio",
      enabledByDefault: false,
      commands: [okCmd("radio")],
    });
    assert.equal(f.key, "radio");
  });
  it("rejects a bad key", () => {
    assert.throws(
      () => defineGuildFeature({ key: "Radio", name: "X" }),
      /must match/i,
    );
    assert.throws(() => defineGuildFeature({ key: "", name: "X" }), /must match/i);
  });
  it("rejects an empty name", () => {
    assert.throws(
      () => defineGuildFeature({ key: "radio", name: "  " }),
      /name/i,
    );
  });
});

describe("definePlugin command-name uniqueness", () => {
  const base = {
    key: "test-plugin",
    name: "Test",
    version: "0.1.0",
    rpcMethodsUsed: [],
    storage: { guildKv: false },
  };

  it("accepts disjoint command names across pluginCommands + guildFeatures", () => {
    const p = definePlugin({
      ...base,
      pluginCommands: [okCmd("alpha")],
      guildFeatures: [
        defineGuildFeature({ key: "f1", name: "F1", commands: [okCmd("beta")] }),
        defineGuildFeature({ key: "f2", name: "F2", commands: [okCmd("gamma")] }),
      ],
    });
    assert.equal(p.config.key, "test-plugin");
  });

  it("throws on a duplicate name within guildFeatures", () => {
    assert.throws(
      () =>
        definePlugin({
          ...base,
          guildFeatures: [
            defineGuildFeature({ key: "f1", name: "F1", commands: [okCmd("dup")] }),
            defineGuildFeature({ key: "f2", name: "F2", commands: [okCmd("dup")] }),
          ],
        }),
      /duplicate command name "dup"/,
    );
  });

  it("throws when a guild-feature command collides with a pluginCommand", () => {
    assert.throws(
      () =>
        definePlugin({
          ...base,
          pluginCommands: [okCmd("clash")],
          guildFeatures: [
            defineGuildFeature({ key: "f1", name: "F1", commands: [okCmd("clash")] }),
          ],
        }),
      /duplicate command name "clash"/,
    );
  });
});
