/**
 * Default vitest setup — runs once per test file.
 *
 * The avalon flow code reaches the bot through `runtime()` (see
 * `flow/runtime.ts`). Tests that exercise stages bring their own
 * captured-call fake via `_harness.ts`; tests that DON'T touch the
 * flow (pure roles/state/vision tests) shouldn't have to set anything
 * up to use `t()`. So this setup file:
 *
 *  1. Wires a "throws on use" placeholder runtime — flow code that
 *     accidentally fires during a unit test surfaces loudly.
 *  2. Provides nothing else by default; integration tests opt in to a
 *     real fake via `installFakeRuntime()` from `_harness.ts`.
 *
 * Each test file resets module state to keep cross-file pollution out.
 */
import { wireRuntime } from "../flow/runtime.js";

wireRuntime({
  botRpc: () => {
    throw new Error(
      "test botRpc not wired — call installFakeRuntime() from _harness.ts",
    );
  },
  log: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  },
  publicBaseUrl: () => "http://test.local",
});
