# karyl-avalon INVENTORY

Generated from a full read of `packages/avalon/src/**` (commit base: HEAD as of
this file's first revision). Updated when the engine shape changes.

This document is the source-of-truth catalog the TESTPLAN and BUGS files index
against. Every game stage, every player-count config, every button and every
piece of persistent state lives here. If you add a new stage or rename a button
without updating this file, the TESTPLAN/BUGS pointers break — treat it like
a Rosetta stone, not a comment.

## Rules source

Cross-referenced against the **Avalon: Resistance** official rulebook
(Don Eskridge / Indie Boards & Cards, ©2012), specifically the public PDF:

  https://cdn.shopify.com/s/files/1/1019/4561/files/AvalonRulebook.pdf

Where the in-repo implementation diverges from the printed rulebook it is
called out explicitly under "Divergences from rulebook" below. Anywhere this
doc says "per rule" with no other source, that PDF is what it means.

The Python original this port is based on (TheResistanceCoach) supported
4-player tables; we inherit some of that surface (e.g. `MISSION_SIZE[4]`,
`newGameState` accepting 4) but the role-deck math actually rejects n=4 — see
the n=4 row in the deck table and BUGS for the resulting crash.

## High-level lifecycle

```
                            ┌──────────────────────────────────┐
  /avalon start  ──▶ signup │ button: sig:join/leave/start/cancel │
                            └────────────┬─────────────────────┘
                                         │ host clicks `start` w/ ≥4 players
                                         ▼
  state.stage="playing"          deal()  →  sendDealBoard()  →  openAppoint()
                                         │
                                ┌────────┴──────────────────────────────┐
                                ▼                                       │
                         appoint (round R)                              │
                         button: appt:s:<seat> / appt:c                 │
                                 │ leader confirms                      │
                                 ▼                                      │
                         publicVote                                     │
                         button: pub:y / pub:n                          │
                          ├── majority approve → privateVote            │
                          └── reject → ++rejections, rotateLeader       │
                                       │                                │
                                       ├── 5 rejections → endGame mordred
                                       └── else → openAppoint           │
                                                                        │
                         privateVote                                    │
                         button: priv:open  (+ ephemeral priv:s / priv:f)
                          │ resolveMission → record success/fail        │
                          ▼                                             │
                          evaluateVerdict?                              │
                           ├── 3 fails / 3 cleans-on-4p → endGame       │
                           ├── 3 successes (≥5p) → openAssassinate ─┐   │
                           ├── lake due (ladyEnabled & n≥7 & r∈2..4) │   │
                           │   → openLake → on click → rotateLeader │   │
                           │   → openAppoint ──────────────────────┘   │
                           └── else → rotateLeader → openAppoint ───────┘

  assassinate (state.stage="assassinate")
  button: asn:<seat>
   │ assassin picks → settleAssassinate → endGame (merlin-killed | -survived)

  endGame: state.stage="ended"; removeGame(channelId) wipes in-memory state.
```

## Stages

For each stage: `state.current.kind` (when relevant), entry conditions, public
board contents, ephemeral channels, buttons, transitions, timeout behaviour,
per-role vision.

### S1. signup  (not stored on GameState; separate `signups` Map in `flow/signup.ts`)

- **Entry**: `/avalon start` ⇒ `startSignup()` inside `withChannelLock` →
  refuses if `getGame(channelId)` OR `signups.has(channelId)`. Host auto-joins
  the roster.
- **Public board** `renderSignupEmbed()`:
  - title (`stage.signup.title`)
  - description with host mention
  - field: 目前人數 = `players.size`
  - field: 參加名單 (only when ≥1 name)
- **Buttons** (`signupComponents`):
  | customId tail              | label  | gate                       |
  |---------------------------|--------|---------------------------|
  | `kc:karyl-avalon:sig:join`   | 加入   | any user                  |
  | `kc:karyl-avalon:sig:leave`  | 離開   | any user                  |
  | `kc:karyl-avalon:sig:start`  | 開始   | host only; disabled until 4≤size≤10 |
  | `kc:karyl-avalon:sig:cancel` | 取消   | host only                 |
- **Transitions**:
  - `join` adds clicker to Map; refuse if already in, or if size>=10.
  - `leave` removes clicker (host can leave the roster but stays as host).
  - `start` (host only, size>=4): builds `GameState`, calls `deal()`,
    `setGame()`, deletes signup, edits signup message to lock + posts
    deal board.
  - `cancel` (host only): deletes signup, edits message to "已取消".
- **Timeout**: **none**. The signup lives forever in memory until cancel /
  start / process restart. No automatic expiry. (See BUGS.)
- **Vision**: not applicable — players have no role yet.
- **Force-stop from WebUI**: `removeSignup(channelId)` deletes the signup
  Map entry, but does NOT edit the signup Discord message (it remains
  visible with its buttons; clicking now triggers the `error.notRunning`
  ephemeral). See BUGS.

### S2. deal-reveal board (NOT tracked in `state.current`)

- **Entry**: `sendDealBoard(state)` posts the public deal-reveal embed right
  after `deal()` runs. Does NOT mutate `state.current`; the embed is read-only
  and stays in the channel for the whole game.
- **Public board**: title + description prompting players to click 查看身份.
- **Buttons**:
  | customId tail            | label    | gate          |
  |--------------------------|----------|---------------|
  | `kc:karyl-avalon:deal`     | 查看身份 | seated players only — non-players ephemeral "你不在這場對局裡" |
- **Transitions**: click ⇒ ephemeral role + vision embed (with optional
  admin-uploaded role art thumbnail at `<publicBaseUrl>/art/<position>.<ext>`).
  No state change. The embed never gets edited; players can re-tap to
  re-check info even mid-round.
- **Vision (per `vision.ts`)** — what each role sees on this board:
  | viewer        | sees                                                    |
  |---------------|---------------------------------------------------------|
  | merlin        | every evil EXCEPT mordred (i.e. assassin, morgana, oberon are 🔴) |
  | percival      | merlin AND morgana as 🟣 (indistinguishable)             |
  | assassin/morgana/mordred | each other as 🔴 — but NEVER oberon              |
  | oberon        | nothing (every other seat → ⬜)                          |
  | loyal         | nothing                                                  |
  | (anyone)      | self → 👤; lake-checked target → 🔴 or 🔵 by faction      |
- **Timeout**: none.
- After `sendDealBoard` returns it immediately calls `openAppoint(state)`
  so the deal board and round-1 appoint board coexist.

### S3. appoint  (`state.current.kind === "appoint"`)

- **Entry**: `openAppoint(state)` — called from
  (a) `handleStartClick` after deal,
  (b) `resolvePublicVote` after rejection (non-terminal),
  (c) `resolvePrivateVote` after a mission resolves and no other stage is due,
  (d) `handleLakeClick` after a lake check completes.
- **state.current**: `{ kind, messageId, selected: [] }`.
- **Public board** `renderAppointEmbed`:
  - title `stage.appoint.title` with `{round}`
  - description naming the leader and required mission size
  - field 任務進度 (`missionProgressLine` — 5 slots ✅❎🟡⚪ + optional `⚠ N/5`)
  - field 目前選擇 — list of names or "（尚未選擇）"
- **Buttons** (`appointComponents`):
  | customId tail              | label              | gate                |
  |---------------------------|--------------------|---------------------|
  | `appt:s:<seat 0..N-1>`    | `<seat+1>. <name>`  | leader only         |
  | `appt:c`                  | 確認               | leader only; disabled unless `selected.length === missionSize` |
  - Seat buttons rendered up to 5 per row. 10 seats → 2 rows of 5 + 1 confirm row = 3 action rows total. Within Discord's 5-row limit. ✓
  - A seat already in `selected` is green (style 3 success); not-yet-selected is grey (style 2 secondary).
- **Transitions**:
  - Toggle seat in/out of `selected`. If at-capacity, refuse with `stage.appoint.full` ephemeral.
  - Confirm: locks board (strip buttons), copies `selected` into `missionMembers`, calls `openPublicVote(state, missionMembers)`.
- **Timeout**: none.
- **Non-leader click**: `stage.appoint.notLeader` ephemeral.
- **Vision**: deal board still available — appoint stage does not change vision.

### S4. publicVote  (`state.current.kind === "publicVote"`)

- **Entry**: `openPublicVote(state, missionMembers)` from `confirmAppoint`.
- **state.current**: `{ kind, messageId, missionMembers, votes: Record<userId, "yes"|"no"> }`.
- **Public board** `renderPublicVoteEmbed` (repaints on every vote):
  - title `stage.publicVote.title` with round
  - field 任務進度
  - field 任務名單 — seat & name lines
  - field 投票狀況 — `{n}/{total}` voted (NO who-voted-what disclosure)
  - field 連續否決 (only when `state.consecutiveRejections > 0`)
- **Buttons**:
  | customId tail | label | gate |
  |--------------|-------|------|
  | `pub:y`       | 同意   | any seated player; one vote per player (refuse on second click) |
  | `pub:n`       | 反對   | any seated player; one vote per player |
- **Transitions**:
  - On click: write `votes[userId] = yes|no`, ephemeral "已記錄你的投票"
    , repaint progress field.
  - When `Object.keys(votes).length === players.length` → `resolvePublicVote`:
    - tally yes vs no; pass iff `yes > no` (a tie = reject; per Avalon rule
      "majority must approve").
    - repaint board to reveal final tally + result.
    - **pass**: dynamic-import `openPrivateVote`.
    - **reject**: `state.consecutiveRejections++`; `state.current = null`;
      `evaluateVerdict` (might end via `rejections`); else `rotateLeader` +
      `openAppoint`.
- **Timeout**: none.
- **Non-player click**: `stage.publicVote.notPlayer` ephemeral.
- **Already-voted click**: `stage.publicVote.alreadyVoted` ephemeral.
- **Vision**: unchanged.

### S5. privateVote  (`state.current.kind === "privateVote"`)

- **Entry**: `openPrivateVote(state, missionMembers)` from
  `resolvePublicVote` when a vote passes.
- **state.current**: `{ kind, messageId, missionMembers, votes: Record<userId, "success"|"fail"> }`.
- **Public board** `renderPrivateVoteEmbed` (repaints on each ballot):
  - title `stage.privateVote.title` with round
  - description naming leader + mission size
  - field 任務進度
  - field 任務名單
  - field 投票狀況 — `{n}/{total}` of *mission members* (NOT all players)
  - field ⚠ `stage.privateVote.need2Fail` only when round 4 + n≥7
- **Buttons**:
  | customId tail | label | gate |
  |--------------|-------|------|
  | `priv:open`   | 前往投票  | mission members only; refuse repeats; opens an *ephemeral* with [✅成功] [❎失敗] |
  | `priv:s`      | ✅ 成功 (ephemeral) | mission members; recorded as `success` |
  | `priv:f`      | ❎ 失敗 (ephemeral) | mission members; disabled visually for good (`!isEvil`) AND rejected at engine boundary if `factionOf(me) === "arthur"` |
- **Transitions**:
  - On ballot: write `votes[userId]`, ephemeral confirm, repaint count.
  - When everyone voted → `resolvePrivateVote`:
    - failCount = ballots filter "fail"
    - `passed = needs2 ? failCount < 2 : failCount < 1`
    - Reveal resolved board with failCount (no who-voted disclosure).
    - `recordMissionResult(passed ? "success" : "fail")`
    - `state.current = null`; `evaluateVerdict`:
      - ended ⇒ `endGame`
      - `missions-then-assassinate` ⇒ `openAssassinate`
    - else: `resolvedRound = state.round - 1` (round was just bumped);
      `lakeIsDueAfterRound(state, resolvedRound)` ⇒ `openLake`; otherwise
      `rotateLeader` + `openAppoint`.
- **Timeout**: none.
- **Non-member click**: `stage.privateVote.notMember` ephemeral.
- **Vision**: unchanged.

### S6. lake  (`state.current.kind === "lake"`)

- **Entry**: `openLake(state)` from `resolvePrivateVote` when
  `lakeIsDueAfterRound(state, resolvedRound)` returns true — i.e.
  `state.ladyEnabled && state.players.length >= 7 && resolvedRound ∈ {2,3,4}`.
- **state.current**: `{ kind, messageId, holderIndex }`.
- **Public board** `renderLakeEmbed`:
  - title `stage.lake.title`
  - description: holder name + n-th use (`ladyUseCount + 1`)
  - field 目前持有 — holder display name
- **Buttons** (`lakeComponents`):
  | customId tail              | label              | gate |
  |---------------------------|--------------------|------|
  | `lake:<seat 0..N-1>`      | `<seat+1>. <name>`  | holder only; excludes the holder themselves AND any seat with `lakeTarget !== null` (previously held the token — set when that player handed it off) |
- **Transitions**:
  - Click: ephemeral with target's faction; mutate
    `holder.lakeTarget = target.userId` (marks holder as "previously held"),
    `game.ladyHolderIndex = target.index`, `ladyUseCount++`.
  - Repaint public board with neutral "X 用湖中女神查驗了 Y" (no faction
    leak).
  - `state.current = null`; `evaluateVerdict` (defensive, almost never
    ends here); `rotateLeader` + `openAppoint`.
- **Timeout**: none.
- **Non-holder click**: `stage.lake.notHolder` ephemeral.
- **Self click**: `stage.lake.cannotSelf` ephemeral.
- **Repeat-target click** (target.lakeTarget !== null): `stage.lake.cannotRepeat`.
- **Vision**: the holder gets the target's faction added to their personal
  view; that flows through `buildVision()` which checks
  `viewer.lakeTarget === p.userId` and overrides the role-based marker.
- **Enabling the mechanic**: the host gates Lady-of-the-Lake at signup
  time via the `sig:lady` toggle button on the signup board (only
  visible when player count ≥ `LADY_MIN_PLAYERS` = 7). If the roster
  drops below 7 after toggling on, `handleLeaveClick` auto-resets the
  flag to `false`; `handleStartClick` additionally clamps the effective
  value at deal time. The optional public-board + ephemeral-result
  thumbnail comes from the `lake` admin-uploaded game-element asset
  (see § Role art slot model).

### S7. assassinate  (`state.current.kind === "assassinate"`, `state.stage === "assassinate"`)

- **Entry**: `openAssassinate(state)` from `resolvePrivateVote` when
  `verdict.reason === "missions-then-assassinate"` (Arthur reached 3
  successes AND n≥5).
- **state.current**: `{ kind, messageId }`.
- **state.stage**: flipped to `"assassinate"` (the only non-`"playing"` mid-game stage).
- **Public board** `renderAssassinateEmbed`: title + "由刺客 X 選擇刺殺對象".
- **Buttons** (`assassinateComponents`):
  | customId tail              | label              | gate |
  |---------------------------|--------------------|------|
  | `asn:<seat 0..N-1>`       | `<seat+1>. <name>`  | assassin only; excludes the assassin themselves; **does NOT pre-filter teammates** (so picking Oberon would not leak Oberon's existence to the assassin) |
- **Transitions**:
  - Click: ephemeral guard if non-assassin or self; otherwise:
    `state.assassinTargetIndex = seat`; `settleAssassinate(state)` →
    `target.position === "merlin"` ⇒ `merlin-killed` (mordred wins),
    else `merlin-survived` (arthur wins).
  - Lock board to a result embed revealing target's role to everyone.
  - `state.current = null`; `endGame(state, verdict)`.
- **Timeout**: none.
- **Vision**: unchanged for non-assassin viewers; the assassin's own
  vision is whatever role-vision gave them (mordred-faction sees other
  evil except oberon).

### S8. ended  (`state.stage === "ended"`)

- **Entry**: `endGame(state, verdict)` from any of:
  - `resolvePublicVote` (5 rejections)
  - `resolvePrivateVote` (3 fails OR 3-cleans-on-4p)
  - `handleAssassinateClick` (merlin-killed | -survived)
  - `handleLakeClick` (defensive — should not actually trigger end)
- **Public board**: Arthur / Mordred title + reason + roster reveal (every
  seat's role).
- **Buttons**: none.
- **Transitions**: `removeGame(channelId)` wipes the in-memory state, so a
  fresh `/avalon start` can immediately run. The signup Map is *not*
  touched (different lifecycle).

## Player-count configurations (4–10)

Source: `roles.ts:rolesForPlayerCount` + `MISSION_SIZE` table.

### Role deck per player count

(✓ matches Avalon rulebook table.  ⚠ = divergence/issue, see BUGS.)

| n   | Roles                                                       | Good : Evil | Notes |
|-----|-------------------------------------------------------------|-------------|-------|
| 4   | (intended) merlin, assassin, 2× loyal                       | 3 : 1       | ⚠ The deck-builder throws `role table mismatch: n=4 wanted 2 evil, got 1` — n=4 is **broken on start**. See BUGS B-001. |
| 5   | merlin, assassin, morgana, 2× loyal                         | 3 : 2       | ✓ matches rulebook |
| 6   | merlin, percival, assassin, morgana, 2× loyal               | 4 : 2       | ✓ matches rulebook |
| 7   | merlin, percival, assassin, morgana, mordred, 2× loyal      | 4 : 3       | ✓ matches rulebook |
| 8   | merlin, percival, assassin, morgana, mordred, 3× loyal      | 5 : 3       | ✓ matches rulebook |
| 9   | merlin, percival, assassin, morgana, mordred, 4× loyal      | 6 : 3       | ✓ matches rulebook |
| 10  | merlin, percival, assassin, morgana, mordred, oberon, 4× loyal | 6 : 4    | ✓ matches rulebook |

Source flags used by `rolesForPlayerCount`:
- `hasPercival = n >= 6`
- `hasMorgana  = n >= 5`
- `hasMordred  = n >= 7`
- `hasOberon   = n >= 10`
- `evilCount   = n <= 6 ? 2 : n <= 9 ? 3 : 4`

### Mission size table  (`MISSION_SIZE[n]`)

| n   | R1 | R2 | R3 | R4 | R5 |
|-----|----|----|----|----|----|
| 4*  | 2  | 3  | 2  | 3  | 3  |
| 5   | 2  | 3  | 2  | 3  | 3  |
| 6   | 2  | 3  | 4  | 3  | 4  |
| 7   | 2  | 3  | 3  | 4  | 4  |
| 8   | 3  | 4  | 4  | 5  | 5  |
| 9   | 3  | 4  | 4  | 5  | 5  |
| 10  | 3  | 4  | 4  | 5  | 5  |

(*) n=4 table present in source but unreachable due to deck math throwing.

### R4 two-fails rule

- `round4Needs2Fail(n) === n >= 7`.
- At round 4, mission passes iff `failCount < 2` (instead of `< 1`).
- Visible in `renderPrivateVoteEmbed` only when both conditions hold.

### Verdict transitions  (`evaluateVerdict`)

- `tally.fail >= 3` → ended, mordred wins, `missions-failed`.
- `consecutiveRejections >= 5` → ended, mordred wins, `rejections`.
- `tally.success >= 3 && players.length < 5` → ended, arthur wins,
  `missions-clean` (skips assassinate stage on the 4-player table — but
  that table is dead, see B-001).
- `tally.success >= 3 && players.length >= 5` → not ended,
  `missions-then-assassinate`.
- Else: not ended.

After assassinate: `settleAssassinate` returns
  - `merlin-killed`  → mordred wins
  - `merlin-survived` → arthur wins.

### Role art slot model

The `art.ts` storage splits uploaded images into three flavours:

- **Single-image positions** — `merlin`, `percival`, `assassin`,
  `morgana`, `mordred`, `oberon`. Exactly one file per role,
  `<position>.<ext>`.
- **Variant positions** — `loyal` (max 5 slots) and `minion` (max
  3 slots). Each slot is a separately uploaded file named
  `<position>-<variant>.<ext>` where variant ∈ 1..N. At
  `renderDealReveal` time, the engine computes the viewer's
  *seat-rank-among-same-role* (1-indexed, ascending seat index) and
  pulls the matching variant via `findVariantArt`. If the admin
  hasn't uploaded the variant for that rank, the embed omits the
  thumbnail (never reused — see B/A discussion below).
- **Game-element assets** — non-role uploads addressed by key.
  Current keys: `lake`. Filename: `<key>.<ext>` directly in
  `ART_DIR`. The lake asset's image, if uploaded, attaches as a
  thumbnail on the lake stage's public board AND the per-holder
  ephemeral result. Asset keys live in `ASSET_KEYS`; new ones extend
  that tuple + `ASSET_LIST` on the frontend.

`Position` includes `minion` so the art slots have somewhere to
attach, but `rolesForPlayerCount` doesn't currently put `minion`
in any deck — the slots are pre-staged for a future deck variant.
The plugin's `onReady` runs `cleanupOrphanArt` to sweep any
pre-rename `loyal.<ext>` / `minion.<ext>` files left from before
the variant redesign.

### Divergences from rulebook

- **n=4 dead-on-arrival**: rulebook says 5–10 only; this codebase pretends
  to support 4 (mission table, signup minimum), but the deck-builder
  throws. Fix: bump the signup minimum to 5 (or implement 1-evil n=4).
- **Lady-of-the-Lake now reachable (B-003 resolved)**: host enables it
  via the `sig:lady` toggle on the signup board (visible when n≥7).
  Optional thumbnail comes from the `lake` game-element asset.
- **Assassinate target picker not faction-filtered**: assassin sees ALL
  non-self seats. Rulebook is silent on UI; intentionally not filtered to
  avoid leaking Oberon. UX-only quirk, not a rule bug.
- **No 5-minute deal-board "everyone has revealed" pause**: rulebook
  describes a real-life 30s reveal pause; the bot just lets the leader
  start picking immediately. Acceptable for online play; flagged for
  awareness.
- **Tie public vote = reject**: matches rulebook ("majority approve").
  Tie ≠ majority. ✓

## Button / route table

### Button customIds (handled in `flow/dispatcher.ts`)

| componentId | tail forms          | handler                                | stage gate                          |
|-------------|---------------------|----------------------------------------|-------------------------------------|
| `sig`       | `join`/`leave`/`start`/`cancel` | `signup.handleSignupClick`            | signup map alive for channel         |
| `deal`      | (none)              | `stages.handleDealClick`               | game alive (any stage)               |
| `appt`      | `s:<seat>`/`c`      | `stages-appoint.handleAppointClick`    | `current.kind === "appoint"`         |
| `pub`       | `y`/`n`             | `stages-publicvote.handlePublicVoteClick` | `current.kind === "publicVote"`   |
| `priv`      | `open`/`s`/`f`      | `stages-privatevote.handlePrivateVoteClick` | `current.kind === "privateVote"` |
| `lake`      | `<seat>`            | `stages-lake.handleLakeClick`           | `current.kind === "lake"`            |
| `asn`       | `<seat>`            | `stages-assassinate.handleAssassinateClick` | `current.kind === "assassinate"` |

All component clicks land in `onComponent` which wraps the call in
`withChannelLock(channelId, …)` so clicks across a channel serialise.
Unknown componentId logs warn + returns null (no-op visible to user).

### HTTP routes (web-routes.ts, plugin-side only)

Public (no auth):
- `GET  /`                         — admin SPA (singlefile HTML, with CSP header)
- `GET  /art/:filename`            — serves uploaded role art (size guarded, sniff-protected)
- `GET  /api/manage/health`        — Docker healthcheck

Auth chain:
- `POST /api/manage/exchange`      — bot plugin-session JWT → plugin access+refresh pair
- `POST /api/manage/refresh`       — rotate plugin refresh → fresh pair
- `GET  /api/manage/games`         — admin list of active games + signups
- `POST /api/manage/games/:channelId/stop` — admin force-stop
- `GET  /api/manage/art`           — list uploaded art with cache-busting URLs. Response now carries both `art[]` (role entries) AND `assets[]` (game-element entries).
- `POST /api/manage/art/:position` — multipart upload for single-image positions (merlin/percival/assassin/morgana/mordred/oberon); 5 MB cap, 4 mime types. Variant positions (loyal/minion) get 400 here.
- `DELETE /api/manage/art/:position` — remove single-image art file(s). Variant positions get 400 here.
- `POST /api/manage/art/:position/:variant` — multipart upload for variant slots; `:variant` is 1-indexed (loyal 1..5, minion 1..3). 5 MB cap, 4 mime types.
- `DELETE /api/manage/art/:position/:variant` — remove a specific variant slot.
- `POST /api/manage/asset/:key` — multipart upload for a non-role game-element asset slot. Current keys: `lake`. Same 5 MB / 4-mime guards.
- `DELETE /api/manage/asset/:key` — remove a stored asset.

Auth model:
- `auth()`: bot-issued plugin-session JWT (Ed25519, 15 min); required for
  /exchange only. Verify key comes from `setAvalonSessionVerifyKey()`.
- `authManageBootstrap()`: bot JWT + plugin capability `plugin:karyl-avalon:manage`.
- `authManageAccess()`: plugin-issued HMAC-SHA256 access JWT (5 min);
  refresh path mints a new pair. Secret is `randomBytes(32)` at module
  init, so process restart wipes all live manage sessions.

### Slash command

`/avalon` is registered through the **`avalon` guild feature** (軌一)
— bot admins enable it per guild via the admin UI; the slash command
only appears in guilds that have the feature on. Off by default
(`enabledByDefault: false`). Mirrors how the radio plugin gates
`/radio`.

Subcommands:
- `start` → `signup.startSignup`. Refuses if channel already has signup or game.
- `stop`  → host or admin only; calls `removeGame(channelId)`. Does NOT
  delete the active stage's public board (the message lingers with broken
  buttons; clicks now show `error.notRunning` ephemeral).
- `manage` → mints a 15-min plugin-session JWT and returns an ephemeral
  message with a Link button to `<effectiveBase>/?token=<JWT>`.

The component (button) handlers are registered at plugin level (軌二)
not under the feature, so a guild that disables the feature mid-game
still gets its in-flight buttons handled cleanly until the game ends
or someone runs `/avalon stop` (in a guild where the feature is
still on).

## Persistent state

| Where                            | Lives in        | Survives container restart? | Survives image rebuild? |
|----------------------------------|-----------------|------------------------------|--------------------------|
| Active games (`game/store.ts: games` Map) | in-memory                | **No**                       | No                       |
| Per-channel lock chains (`store.chains`)  | in-memory                | **No**                       | No                       |
| Signups (`flow/signup.ts: signups`)       | in-memory                | **No**                       | No                       |
| Manage HMAC secret (`manage-tokens.ts: SECRET`) | in-memory               | **No** — wipes all sessions  | No                       |
| Role art (`/app/data/art`, env `AVALON_ART_DIR`) | Docker named volume `avalon-art` | **Yes**            | Yes                      |
| Bot's plugin-session Ed25519 key  | in karyl-chan (bot)      | depends on bot               | depends on bot           |

So on container restart:
- Every in-flight game **vanishes silently** (the public Discord messages
  remain but their buttons all return `error.notRunning`).
- All manage WebUI tabs lose their session and must re-run `/avalon manage`.
- Uploaded role art survives (only this one piece of state is durable).

## Dynamic imports & circular dependencies (worth knowing for tests)

- `stages-publicvote.ts` does `await import("./stages-privatevote.js")`
  inside `resolvePublicVote` to break a transitive cycle through
  stages-appoint → stages-publicvote → stages-privatevote → stages-appoint.
- `flow/stages.ts` re-exports every per-stage handler so the dispatcher
  switch sees a stable surface even though they live in sibling modules.
- `runtime.ts` is set up by `index.ts` *after* `start()` resolves. Anything
  calling `runtime()` before then throws.
- `web-routes.ts` `setAvalonSessionVerifyKey` / `setAvalonPublicBaseUrl` /
  `setPublicUrlEnvFallback` are likewise late-bound.

## i18n

- Single locale: `zh-TW` (`Locale = "zh-TW"`).
- `t(undefined, key, vars)` falls back to default locale and **logs +
  returns the key itself** on miss (so missing key shows up as e.g.
  `"stage.deal.legend"` in the embed — loud but not crashing).
- `LocaleKey` is the `keyof typeof zhTW`, so every literal `t()` call is
  TypeScript-checked. The only way to land an unknown key at runtime is
  to feed a dynamically-built string via `as const`. The current dynamic
  case is `` `role.flavor.${viewer.position}` as const `` in
  `stages.ts` — that resolves to one of 8 keys (after `minion` was
  added alongside the variant-art slots), all present in zhTW. Note
  `minion` is not currently dealt by any `rolesForPlayerCount` config,
  so `role.flavor.minion` is exercised only by upcoming deck variants.
- TESTPLAN "i18n 兩種語系不爆 missing key" is therefore really
  "verify every literal `t()` key has a value in zhTW + verify the
  `role.flavor.${position}` template has all 8 keys present". A second
  language doesn't exist yet.

## Known UX/behavioural quirks (not bugs per se — but worth seeing)

- Host can `leave` the signup roster but stays as host. If the host then
  clicks `start`, the game starts WITHOUT the host (they're a spectator).
  `/avalon stop` still works for them.
- After `/avalon stop`, the active stage's public board is left in place
  with live-looking buttons. Clicks on those buttons produce an
  `error.notRunning` ephemeral. There's no automatic "stripped" repaint.
- The signup message has the same problem if the host stops mid-signup.
- Lady-of-the-Lake stage code is *fully wired in the engine* but
  unreachable because the setup dialog is hard-coded `ladyEnabled: false`.
- Assassinate buttons show every non-assassin seat (intentional, to avoid
  leaking Oberon).
- There is no per-stage timeout — every interactive stage waits forever
  for the next click.

## Files & line anchors (quick navigation)

- `src/index.ts`                  — bootstraps plugin, wires runtime, sets late-bound web-routes deps
- `src/plugin.ts`                 — slash command + component definitions
- `src/constants.ts`              — `PLUGIN_KEY`, embed color
- `src/manage-tokens.ts`          — HMAC JWT (access/refresh)
- `src/art.ts`                    — art file io + filename guards
- `src/web-routes.ts`             — REST surface + SPA serving
- `src/game/state.ts`             — `GameState`, `deal`, `evaluateVerdict`, `settleAssassinate`, …
- `src/game/roles.ts`             — role catalog + `rolesForPlayerCount` + mission size table
- `src/game/vision.ts`            — per-role/per-target vision marker
- `src/game/store.ts`             — per-channel game map + `withChannelLock`
- `src/flow/runtime.ts`           — shared runtime handle
- `src/flow/discord.ts`           — typed Discord RPC wrappers
- `src/flow/presentation.ts`      — marker emoji, seat emoji, progress bar
- `src/flow/dispatcher.ts`        — onComponent switch
- `src/flow/signup.ts`            — signup map + sig:* buttons + start handoff
- `src/flow/stages.ts`            — deal reveal + per-stage re-exports
- `src/flow/stages-appoint.ts`
- `src/flow/stages-publicvote.ts`
- `src/flow/stages-privatevote.ts`
- `src/flow/stages-lake.ts`
- `src/flow/stages-assassinate.ts`
- `src/flow/stages-ending.ts`
- `src/i18n/index.ts`             — `t()` + locale registry
- `src/i18n/zh-TW.ts`             — dictionary (and `LocaleKey` type via `keyof typeof`)
