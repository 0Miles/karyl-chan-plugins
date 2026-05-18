# karyl-avalon BUGS

Issues surfaced by the INVENTORY/TESTPLAN reading + simulator/integration
test runs. Each entry is reproducible against the current HEAD; entries
that turn out to be intentional behaviour are kept as **Acknowledged**
records pointing at the design rationale, not as bugs to fix.

Severity:
- **HIGH** — breaks gameplay or has unbounded resource impact.
- **MEDIUM** — degrades UX or surfaces stale state to players.
- **LOW** — minor; documented expectations.

Status:
- **OPEN** — reproduces, no fix in this branch.
- **FIXED** — addressed in a commit; the linked test now defends it.
- **DEFERRED** — known issue, fix touches scope the goal asks to
  stop-and-report on (UI rework, persistence, timeouts).
- **ACK** — by design; documented in INVENTORY.

---

## B-001 — n=4 game crashes at deal time  &nbsp;&nbsp;[HIGH, FIXED]

**Repro**
```
1. Host runs /avalon start.
2. 4 (≥4, the documented minimum) players join the signup.
3. Host clicks 開始.
   → handleStartClick → newGameState (allows ≥4) → deal() →
     rolesForPlayerCount(4) throws "role table mismatch: n=4 wanted 2 evil, got 1"
4. Dispatcher's catch ephemeral-nudges the error to the host.
5. signups Map still has the channel; game state never set.
6. Host re-clicks 開始 → same crash.
```

**Actual** Game is unstartable for n=4. Channel hosts get a confusing
"role table mismatch" message they can't act on.

**Expected** EITHER an n=4 deck that's actually balanced (1 evil + merlin
+ 2 loyal — a "half-cooked" Avalon variant), OR a clean "Avalon supports
5-10 players" rejection at the signup boundary so the host sees the
problem *before* clicking start.

**File/line** `src/game/roles.ts:66-95` (deck math) +
`src/flow/signup.ts:186-191` (signup minimum 4).

**Fix taken** Bumped the signup minimum from 4 to 5 to match the
official Avalon rulebook and updated the deck math's error to mention
the supported range explicitly. The n=4 mission-size table is left in
source for historical clarity but is now unreachable through normal
play (we still keep the explicit throw at the roles boundary in case a
future caller bypasses the signup check).

**Test that catches it (red→green)** `roles.test.ts: roles-001` — pinned
the rejection error to mention 5-10 player support after fix.

---

## B-002 — /avalon stop leaves the active stage's buttons clickable  &nbsp;&nbsp;[MEDIUM, FIXED]

**Repro**
```
1. /avalon start; players join; host clicks start; game in publicVote stage.
2. Host runs /avalon stop.
   → removeGame(channelId); ephemeral "已強制終止對局".
3. The publicVote Discord message is still in the channel with live
   pub:y / pub:n buttons.
4. A player clicks pub:y. Dispatcher emits "error.notRunning" ephemeral.
```

**Actual** Stale buttons that look live; players think they can still
vote until they click and get an error.

**Expected** The active stage's buttons should be stripped (or the
embed marked "已強制終止") so the visual state matches reality.

**File/line** `src/plugin.ts:91-103` (/avalon stop handler);
`src/flow/signup.ts:334-336` (`removeSignup` similarly leaves the
signup message stale).

**Fix taken** /avalon stop now also strips the active stage's message
buttons via the captured `state.current.messageId`. Pending signups
get the same treatment via `removeSignupWithCleanup`. Failures of the
edit RPC are best-effort (logged, not retried).

**Test that catches it** `flow-stop.test.ts` — drives a game into
publicVote, runs the stop handler, and asserts a `messages.edit`
captured with `components: []`.

---

## B-003 — Lady-of-the-Lake stage is unreachable from production  &nbsp;&nbsp;[MEDIUM, DEFERRED]

**Repro**
```
1. /avalon start with 7+ players; host clicks 開始.
2. handleStartClick (signup.ts:194) hard-codes ladyEnabled: false.
3. The full lake stage code (stages-lake.ts, lakeIsDueAfterRound,
   etc.) never runs.
```

**Actual** Engine has fully wired lake mechanics, vision overrides,
i18n strings, and a `state.options.lady` family of keys — but the
toggle UI doesn't exist, so production games never enable it.

**Expected** A lady-of-the-lake toggle visible on the signup board
when n>=7 (rule book says n>=7 only).

**File/line** `src/flow/signup.ts:193-204` — the TODO comment is
explicit ("TODO (next commit): show the lady-of-the-lake option
dialog"). i18n already has `stage.options.title/lady/yes/no`.

**Fix proposal** Add an `options` sub-stage between signup-start and
deal: another Discord message with two buttons (启用 / 不启用), gated
by n>=7. New customId `kc:karyl-avalon:opt:lady-on / lady-off`. Then
build GameState with the chosen ladyEnabled.

**Why deferred** Per the goal's "停下回報" rules, this is a new
user-facing feature (new buttons, new flow step, new i18n surface
that needs reviewer sign-off) rather than a bug fix. The engine is
ready and the lake tests (`flow-lake.test.ts`, simulator scenarios 08,
15) already cover the path it would expose. Flagged for follow-up.

---

## B-008 — No timeout on signups or in-flight games  &nbsp;&nbsp;[MEDIUM, DEFERRED]

**Repro**
```
1. /avalon start in channel A; players join the signup.
2. Host wanders off. Signup lives in memory indefinitely.
3. Repeat for channels B, C, … N → N stale signups in the signups Map.
4. Same applies to in-flight games whose channel goes inactive.
```

**Actual** Unbounded in-memory state. No automatic expiry. Restart is
the only cleanup.

**Expected** Stale signups / games should self-clean after some
inactivity. Industry-typical: 30 min signup TTL, 4-6 h game TTL.

**File/line** `src/game/store.ts:13-29`, `src/flow/signup.ts:38`.

**Fix proposal** Wire a setInterval in plugin.ts that walks signups +
games, drops anything older than its TTL, and edits the stale Discord
message to "對局逾時自動結束".

**Why deferred** The goal asks to "停下回報" for state-recovery
architectural decisions. Pick a TTL (30 min? 1 h? configurable?) and
get reviewer sign-off; the cleanup interval itself is straightforward.

---

## B-007 — Assassin's seat picker shows evil teammates (incl. Oberon)  &nbsp;&nbsp;[LOW, ACK]

**Repro**
```
1. Reach assassinate stage in any game.
2. assassinateComponents (stages-assassinate.ts:121) filters out only
   the assassin's own seat.
3. Assassin sees buttons for their teammates (morgana, mordred, oberon).
```

**Actual** Assassin can shoot a teammate by misclick → game ends with
arthur winning (target ≠ merlin).

**Expected per rulebook** Either the same (assassinate is "pick anyone
who isn't you") or limited to non-evil. Rulebook leaves this implicit
because IRL the assassin announces verbally.

**Status** Intentional — INVENTORY § Stages > S7 documents that
filtering would leak Oberon's existence to the assassin (Oberon is
faction:mordred but invisible to other evil). Keeping current
behaviour. ACK.

---

## B-016 — openX failure leaves the game in a zombie sub-stage  &nbsp;&nbsp;[LOW, FIXED]

**Repro**
```
1. Force `sendMessage` to return null (e.g. fake runtime returns null
   for /api/plugin/messages.send).
2. Call openAppoint/openPublicVote/openLake/openAssassinate.
3. Function returns void without setting state.current.
4. Subsequent clicks on stale stage buttons emit error.notRunning.
```

**Actual** A silent failure mode — no log, no in-channel notice, just
a stuck state where the host has to /avalon stop.

**Expected** A logged warning at minimum; ideally an in-channel
follow-up so the host knows to take action.

**File/line** `src/flow/stages-appoint.ts:46-53`,
`src/flow/stages-publicvote.ts:46-48`,
`src/flow/stages-privatevote.ts:57-58`,
`src/flow/stages-lake.ts:52-58`,
`src/flow/stages-assassinate.ts:46-52`.

**Fix taken** Added `runtime().log.error(...)` calls on each openX
null-send path with the stage name + channel + round so SREs can
correlate against Discord rate-limit / outage incidents.

**Test that catches it** `flow-openx-failure.test.ts` — fakes a null
response on messages.send, calls each openX, asserts log.error was
invoked with the right stage label.

---

## Acknowledged design choices (not bugs)

- **Single locale (`zh-TW`)** — INVENTORY § i18n; LocaleKey is enforced
  at the type level so missing keys can't sneak past tsc.
- **In-memory state, no persistence** — INVENTORY § Persistence;
  restart drops every game. Documented + tested (persist-001..004).
- **No per-stage timeout** — overlaps with B-008; clicking is the
  only thing that drives the game forward.
- **Tie public vote = reject** — matches Avalon rule "majority approve".
- **Host can leave roster but stays as host** — design choice for a
  game-master mode; signup-003 pins it.

---

## Out-of-scope (would need cross-package change)

- karyl-chan-main session JWT verification key rotation — touches the
  bot, not the plugin.
- plugin-sdk's `definePluginComponent` doesn't carry interaction
  expiration to the handler — would need an SDK API change to detect
  "stale-button" clicks at the framework layer.
