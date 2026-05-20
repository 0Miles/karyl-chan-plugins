# karyl-avalon TESTPLAN

Indexed against [INVENTORY.md](./INVENTORY.md). Every invariant, every stage,
every persistent state has at least one entry here. If you add a new test
file, append it; if you delete a test, remove its row.

Column conventions:
- **id**: stable identifier — used by BUGS.md to point at "this is the
  test that should have caught it". Format: `<area>-<3-digit>` so a row
  stays addressable even if the table re-sorts.
- **invariant**: one-line description of what must hold.
- **trigger**: minimum recipe to put the engine in the failure state.
- **expected**: what passes the assertion.
- **target file/line**: source location the assertion guards.

Test surfaces:
1. **vitest unit/table tests** (`src/__tests__/*.test.ts`) — pure-function
   tests over `roles.ts`, `state.ts`, `vision.ts`, `manage-tokens.ts`,
   `art.ts`, presentation helpers.
2. **vitest integration tests** (`src/__tests__/flow.test.ts`) — exercise
   real stage dispatcher under a fake Discord I/O harness defined in
   `src/__tests__/_harness.ts`.
3. **simulator** (`scripts/simulate.ts`) — JSON scripts in
   `scripts/scenarios/*.json`, run via `pnpm --filter @karyl-chan/plugin-avalon simulate`.
4. **manual / docker E2E** — recipes documented at the bottom; not part
   of `pnpm test` because they require a Discord guild + tokens.

## Coverage matrix

### A. Role-deck math  (`roles.ts: rolesForPlayerCount`)

| id      | invariant                                                | trigger                              | expected                                          | target file/line                    |
|---------|----------------------------------------------------------|--------------------------------------|---------------------------------------------------|-------------------------------------|
| roles-001 | n=4 either supported or rejected loudly at engine boundary | `rolesForPlayerCount(4)`             | either deck `[merlin,assassin,loyal,loyal]` (preferred) OR throw with a clear message — current state throws "role table mismatch" inconsistent with `MISSION_SIZE[4]` | `roles.ts:66-95` (BUGS B-001) |
| roles-002 | n=5 deck                                                 | `rolesForPlayerCount(5)`             | `["merlin","assassin","morgana","loyal","loyal"]` | `roles.ts:77-94`                    |
| roles-003 | n=6 deck                                                 | `rolesForPlayerCount(6)`             | merlin, percival, assassin, morgana, + 2 loyal    | `roles.ts:77-94`                    |
| roles-004 | n=7 deck                                                 | `rolesForPlayerCount(7)`             | + mordred (5 reds total: assassin, morgana, mordred — count=3; +percival+merlin+2 loyal) | `roles.ts:77-94`                    |
| roles-005 | n=8 deck                                                 | `rolesForPlayerCount(8)`             | same as n=7 + 1 loyal                              | `roles.ts:77-94`                    |
| roles-006 | n=9 deck                                                 | `rolesForPlayerCount(9)`             | same as n=7 + 2 loyal                              | `roles.ts:77-94`                    |
| roles-007 | n=10 deck                                                | `rolesForPlayerCount(10)`            | + oberon (4 reds), 6 blues incl. 4 loyal           | `roles.ts:77-94`                    |
| roles-008 | n<4 / n>10 throws                                        | `rolesForPlayerCount(3)`, `(11)`     | throws "Avalon supports 4–10 players, got X"      | `roles.ts:67`                       |
| roles-009 | mission size lookup correctness                          | `missionSize(7, 4)`                  | 4                                                 | `roles.ts:113-118`                  |
| roles-010 | round-out-of-range guards                                | `missionSize(5, 0)`, `(5, 6)`        | throws                                            | `roles.ts:116-117`                  |
| roles-011 | r4 two-fails threshold                                   | `round4Needs2Fail(6)` / `(7)`        | false / true                                      | `roles.ts:121-123`                  |
| roles-012 | every red role is in `Faction.mordred`                   | `ROLES[p].faction` per role          | merlin/percival/loyal → arthur; assassin/morgana/mordred/oberon → mordred | `roles.ts:30-54`        |

### B. Vision (`vision.ts: visionFor` + `buildVision`)

| id         | invariant                                              | trigger                                                       | expected                                                       | target file/line     |
|------------|--------------------------------------------------------|---------------------------------------------------------------|----------------------------------------------------------------|----------------------|
| vision-001 | Merlin sees Assassin/Morgana/Oberon red                | `visionFor("merlin", "assassin")`, `("merlin","morgana")`, `("merlin","oberon")` | each → `"red"`                                                  | `vision.ts:62-66`    |
| vision-002 | Merlin does NOT see Mordred                            | `visionFor("merlin", "mordred")`                              | `"unknown"`                                                    | `vision.ts:64-66`    |
| vision-003 | Merlin sees loyal/percival/self as unknown             | `visionFor("merlin", "loyal")`, `("merlin","percival")`        | `"unknown"`                                                    | `vision.ts:64-66`    |
| vision-004 | Percival sees Merlin AND Morgana as purple             | `visionFor("percival", "merlin")`, `("percival","morgana")`    | each → `"purple"`                                              | `vision.ts:58-60`    |
| vision-005 | Percival otherwise sees unknown                        | `visionFor("percival", "assassin")`, etc.                      | `"unknown"`                                                    | `vision.ts:58-77`    |
| vision-006 | Evil (non-Oberon) sees other evil red, except Oberon   | `visionFor("assassin","morgana")`, `("morgana","mordred")`, `("assassin","oberon")` | red, red, unknown                                  | `vision.ts:68-76`    |
| vision-007 | Oberon sees nothing                                    | `visionFor("oberon", "*")` for every other position           | `"unknown"`                                                    | `vision.ts:68-76`    |
| vision-008 | Loyal sees nothing                                     | `visionFor("loyal", "*")`                                     | `"unknown"`                                                    | `vision.ts:62-77`    |
| vision-009 | `buildVision` returns `"self"` for the viewer's own row | full game; viewer is seat 0; check row 0 marker               | `"self"` and `seat === 1`                                      | `vision.ts:37`       |
| vision-010 | Lake override beats role vision                        | viewer = merlin, target = loyal (would be unknown); set `viewer.lakeTarget = target.userId` | row marker = `"blue"` (target is arthur faction) | `vision.ts:42-48`    |
| vision-011 | Lake override on evil target                           | viewer.lakeTarget = some mordred player                       | marker = `"red"`                                               | `vision.ts:42-48`    |

### C. State transitions (`state.ts: evaluateVerdict`, `settleAssassinate`, mutation helpers)

| id        | invariant                                                | trigger                                                        | expected                                                                 | target file/line       |
|-----------|----------------------------------------------------------|----------------------------------------------------------------|--------------------------------------------------------------------------|------------------------|
| state-001 | 3 fails ends game with mordred / `missions-failed`       | `state.missionResults = [fail,fail,fail,null,null]`; verdict   | `ended=true, winner=mordred, reason=missions-failed`                     | `state.ts:266-268`     |
| state-002 | 5 consecutive rejections ends game                       | `consecutiveRejections=5`; verdict                             | `ended=true, winner=mordred, reason=rejections`                          | `state.ts:269-271`     |
| state-003 | 3 successes on 5+ player table → assassinate handoff     | n=5; `missionResults` 3 success; verdict                        | `ended=false, reason=missions-then-assassinate`                          | `state.ts:275-280`     |
| state-004 | 3 successes on 4p table → immediate arthur win           | n=4 manually built; 3 success                                   | `ended=true, winner=arthur, reason=missions-clean`                       | `state.ts:276-278`     |
| state-005 | settleAssassinate hits Merlin → mordred wins             | `assassinTargetIndex` points at the Merlin seat                | `winner=mordred, reason=merlin-killed`                                   | `state.ts:288-296`     |
| state-006 | settleAssassinate misses Merlin → arthur wins            | target is any non-merlin                                       | `winner=arthur, reason=merlin-survived`                                  | `state.ts:295-296`     |
| state-007 | settleAssassinate without target throws                  | `assassinTargetIndex=null`; call settleAssassinate              | throws                                                                  | `state.ts:289-291`     |
| state-008 | `rotateLeader` wraps around                              | leaderIndex = n-1; rotate                                       | leaderIndex = 0                                                          | `state.ts:220-222`     |
| state-009 | `recordMissionResult` ticks round, zeroes rejections     | `consecutiveRejections=3`; record success on r2                 | `missionResults[1]==='success'`, rejections=0, round=3                   | `state.ts:225-232`     |
| state-010 | `deal()` assigns each role exactly once                  | n=7 deck of 7 distinct positions                                | `players.map(p => p.position).sort()` matches the deck (with frequency)  | `state.ts:172-188`     |
| state-011 | `deal()` selects Lady holder right before leader, when enabled | n=7, ladyEnabled=true; pin Math.random; check `ladyHolderIndex === (leaderIndex + n - 1) % n` | true | `state.ts:183-186` |
| state-012 | `deal()` leaves Lady holder null when disabled           | ladyEnabled=false                                              | `ladyHolderIndex === null`                                              | `state.ts:184-186`     |
| state-013 | `newGameState` rejects <4 / >10                          | signups of size 3 or 11                                        | throws                                                                  | `state.ts:128-130`     |
| state-014 | `evaluateVerdict` ordering: fail count beats rejections | both fail>=3 and rejections>=5                                  | `missions-failed` wins (checked first)                                  | `state.ts:266-271`     |

### D. Stage / dispatcher transitions  (integration; `flow/*` via the test harness)

| id       | invariant                                                        | trigger                                                               | expected                                                                 | target file/line                  |
|----------|------------------------------------------------------------------|-----------------------------------------------------------------------|--------------------------------------------------------------------------|-----------------------------------|
| flow-001 | signup → deal → appoint pipeline                                  | `/avalon start`; 5 players join; host clicks start                    | `sig` message gets edited (buttons stripped), deal board posted, appoint board posted; `state.current.kind==="appoint"` | `signup.ts:175-227`, `stages.ts:26-51` |
| flow-002 | appoint toggle/confirm flow                                       | leader clicks 2 seats then `appt:c` on r1 (5p, missionSize=2)         | board repaints with selected names; on confirm, board buttons cleared, publicVote opens | `stages-appoint.ts`               |
| flow-003 | non-leader appoint click rejected                                 | non-leader player taps `appt:s:0`                                     | ephemeral `stage.appoint.notLeader`; state unchanged                     | `stages-appoint.ts:69-74`         |
| flow-004 | appoint refuses extra select when full                            | leader selects missionSize+1 seats                                    | refuses the extra with `stage.appoint.full`                              | `stages-appoint.ts:101-106`       |
| flow-005 | appoint confirm requires exact count                              | leader presses confirm with fewer than missionSize selected           | ephemeral `stage.appoint.needExact`; stage unchanged                     | `stages-appoint.ts:130-137`       |
| flow-006 | public vote pass → privateVote                                    | majority yes, minority no                                              | privateVote opens; appoint board locked                                  | `stages-publicvote.ts:114-140`    |
| flow-007 | public vote tie = reject                                          | yes==no                                                                | `passed=false`; rejections++; new appoint                                | `stages-publicvote.ts:117-119`    |
| flow-008 | non-player public-vote click rejected                             | clicker not in `state.players`                                         | ephemeral `stage.publicVote.notPlayer`; vote map unchanged              | `stages-publicvote.ts:68-75`      |
| flow-009 | duplicate public vote rejected                                    | same userId clicks `pub:y` then `pub:n`                                | second click ephemeral `stage.publicVote.alreadyVoted`; first vote kept | `stages-publicvote.ts:76-82`      |
| flow-010 | 5 consecutive rejections ends game (mordred)                      | 5p game; reject every appoint for 5 cycles                             | `endGame` posts mordred winner with `reasonRejections`                  | `stages-publicvote.ts:144-149`    |
| flow-011 | mission success records correctly (r1, n=5, fail=0)               | 2 success ballots from members                                         | `missionResults[0]==='success'`, round=2, appoint opens for next leader | `stages-privatevote.ts:196-241`   |
| flow-012 | mission with 1 fail and n<7 fails the round                       | n=5; round 1; 1 success + 1 fail ballot                                | recorded as `'fail'`; missionResults[0]==='fail'                         | `stages-privatevote.ts:200-201`   |
| flow-013 | r4 two-fails rule applies for n≥7                                 | n=7; advance to round 4; 1 fail + 2 success ballots                    | recorded as `'success'`                                                  | `stages-privatevote.ts:200-201`   |
| flow-014 | r4 two-fails does NOT apply for n=6                               | n=6; advance to round 4; 1 fail ballot                                 | recorded as `'fail'`                                                     | `stages-privatevote.ts:200-201`   |
| flow-015 | non-member private-vote rejected                                  | non-mission member clicks `priv:open`                                  | ephemeral `stage.privateVote.notMember`; votes unchanged                | `stages-privatevote.ts:93-100`    |
| flow-016 | arthur trying to vote fail rejected at engine                     | a loyal mission-member tries `priv:f`                                  | ephemeral `stage.privateVote.evilOnly`; vote unrecorded                 | `stages-privatevote.ts:159-165`   |
| flow-017 | duplicate private vote rejected                                   | same member clicks twice                                               | second click `stage.privateVote.alreadyVoted`                            | `stages-privatevote.ts:101-106`   |
| flow-018 | 3 successful missions on n=5 opens assassinate stage              | n=5; record success r1,r2,r3                                           | `state.stage="assassinate"`, `current.kind="assassinate"`                | `stages-privatevote.ts:228-231`   |
| flow-019 | assassin hits Merlin → mordred wins                               | open assassinate; click seat of merlin                                 | `endGame` posts mordred title with `reasonMerlinKilled`                  | `stages-assassinate.ts:75-105`    |
| flow-020 | assassin misses Merlin → arthur wins                              | open assassinate; click any non-merlin seat                            | endGame arthur with `reasonMerlinSurvived`                               | `stages-assassinate.ts:88-105`    |
| flow-021 | non-assassin assassinate click rejected                           | a loyal taps `asn:<seat>`                                              | ephemeral `stage.assassinate.notAssassin`; stage unchanged              | `stages-assassinate.ts:68-73`     |
| flow-022 | assassin cannot self-target                                       | assassin clicks own seat                                               | ephemeral `stage.assassinate.cannotSelf`                                 | `stages-assassinate.ts:78-83`     |
| flow-023 | lake stage fires when due (n=7, ladyEnabled, after r2 mission)    | force `ladyEnabled=true`; simulate r1 mission then r2 mission resolution | after r2 success: `current.kind="lake"` (NOT next appoint)              | `stages-privatevote.ts:232-237`, `stages-lake.ts:38-42` |
| flow-024 | lake stage does NOT fire when disabled                            | n=7, ladyEnabled=false                                                 | after r2 mission: appoint reopens immediately, no lake board posted     | `stages-lake.ts:38-42`            |
| flow-025 | lake stage does NOT fire when n<7                                 | n=6, ladyEnabled=true                                                  | after r2 mission: appoint reopens                                       | `stages-lake.ts:40`               |
| flow-026 | lake holder vision update                                         | n=7, after lake check on a loyal target                                | `buildVision` for holder marks that target as `"blue"`                  | `vision.ts:42-48`                 |
| flow-027 | lake refuses repeat-target (previous holders)                     | after 1st lake gives token A→B, force 2nd lake on B targeting A        | ephemeral `stage.lake.cannotRepeat`; token stays with B                 | `stages-lake.ts:94-100`           |
| flow-028 | non-holder lake click rejected                                    | another player taps `lake:<seat>`                                      | ephemeral `stage.lake.notHolder`                                         | `stages-lake.ts:73-79`            |
| flow-029 | deal-button click from non-player                                 | spectator clicks `deal`                                                | ephemeral `stage.deal.notInGame`                                         | `stages.ts:117-121`               |
| flow-030 | dispatcher rejects clicks for non-current stage                   | game in `publicVote`; click `appt:s:0`                                 | ephemeral `error.notRunning`; state unchanged                            | `stages-appoint.ts:60-67`         |
| flow-031 | dispatcher catches thrown handler error and ephemeral-nudges      | force a handler to throw                                               | dispatcher's catch logs error + sends ephemeral; game state untouched   | `dispatcher.ts:66-76`             |
| flow-032 | per-channel lock serialises clicks                                | spam 10 simultaneous `pub:y` from 10 different players                 | all votes recorded; no votes lost; transition fires exactly once        | `dispatcher.ts:42-65`, `store.ts:43-58` |
| rank-001 | seatRankAmongSameRole 1-indexes by ascending seat                  | players at seats [0,1,2,3,4] with loyals at 1,3,4                      | ranks 1, 2, 3 for those loyals                                          | `seat-rank.test.ts` |
| rank-002 | single-of-its-kind viewer is rank 1                                | merlin alone of its position                                            | rank = 1                                                                | `seat-rank.test.ts` |
| rank-003 | returns 0 when viewer not in same-role set (error path)            | phantom viewer not in `players`                                         | rank = 0 (caller logs warn + skips thumbnail)                           | `seat-rank.test.ts`, `stages.ts` |
| rank-004 | ranks by seat-index field, not array order                         | array shuffled so order ≠ seat order                                    | rank matches `.index` ascending                                          | `seat-rank.test.ts` |

### E. Signup edge cases

| id        | invariant                                                | trigger                                                         | expected                                                                  | target file/line     |
|-----------|----------------------------------------------------------|-----------------------------------------------------------------|---------------------------------------------------------------------------|----------------------|
| signup-001 | second `/avalon start` while signup live → "alreadyRunning" | host starts signup; clicks `/avalon start` again                 | reply `error.alreadyRunning`; existing signup intact                       | `signup.ts:52-55`    |
| signup-002 | second `/avalon start` while game live → "alreadyRunning" | game in flight; another user runs `/avalon start`                | reply `error.alreadyRunning`; existing game intact                         | `signup.ts:52-55`    |
| signup-003 | host can leave roster but stays as host                  | host clicks `sig:leave`, then `sig:start` with 4 non-hosts        | game starts WITHOUT host; only host gains "started" status                | `signup.ts:153-172`, `signup.ts:175-227` |
| signup-004 | non-host start rejected                                  | non-host clicks `sig:start` with 4 players                       | ephemeral `stage.signup.onlyHost`                                          | `signup.ts:178-184`  |
| signup-005 | start with <4 rejected                                   | host clicks `sig:start` with 3 in roster                         | ephemeral `stage.signup.notEnough`                                          | `signup.ts:186-191`  |
| signup-006 | cap at 10 join                                           | 10 in roster; 11th tries to join                                 | ephemeral `stage.signup.tooMany`                                            | `signup.ts:137-143`  |
| signup-007 | host cancel deletes signup + edits message               | host clicks `sig:cancel`                                          | signups Map empty; message edited to "已取消"                              | `signup.ts:229-254`  |
| signup-008 | `/avalon stop` on signup-only state wipes signup         | signup live (no game yet); host runs `/avalon stop`              | reply `error.stopped`; signups empty; signup message left stale (BUGS B-002) | `plugin.ts:91-103`, `signup.ts:334-336` |
| signup-009 | lady toggle below 7 players is rejected (B-003)          | 6-player signup; host clicks `sig:lady`                          | ephemeral `stage.signup.ladyNeeds7`; board NOT repainted                  | `signup.ts: handleLadyClick`, `flow-signup.test.ts` |
| signup-010 | host toggles lady on then off at ≥7 (B-003)              | 7-player signup; two `sig:lady` clicks by host                   | each click repaints + ephemeral ladyOn / ladyOff                          | `signup.ts: handleLadyClick`, `flow-signup.test.ts` |
| signup-011 | non-host lady click rejected (B-003)                     | non-host clicks `sig:lady`                                       | ephemeral `stage.signup.onlyHost`; no board repaint                       | `signup.ts: handleLadyClick`, `flow-signup.test.ts` |
| signup-012 | leaving below 7 forces ladyEnabled back to false (B-003) | 7p toggle on → u6 leaves (n=6) → host clicks lady at 6           | second click ephemeral-rejects (ladyNeeds7); board not repainted          | `signup.ts: handleLeaveClick`, `flow-signup.test.ts` |

### F. Manage tokens (`manage-tokens.ts`)

| id     | invariant                                                | trigger                                                | expected                          | target file/line     |
|--------|----------------------------------------------------------|--------------------------------------------------------|-----------------------------------|----------------------|
| mt-001 | issued access token verifies                             | `issueManagePair("u",["plugin:karyl-avalon:manage"])` → verify access | claims match; purpose=access | `manage-tokens.ts:70-87`, `89-144` |
| mt-002 | refresh token verifies as refresh, not access            | issue, then verify refresh as `"manage-access"`        | null                              | `manage-tokens.ts:127`     |
| mt-003 | tampered signature rejected                              | issue, mutate signature segment, verify                | null                              | `manage-tokens.ts:113-117` |
| mt-004 | expired token rejected                                   | issue with TTL = 0; sleep; verify                      | null                              | `manage-tokens.ts:135`     |
| mt-005 | wrong segment count rejected                             | feed "a.b" or "a"                                      | null                              | `manage-tokens.ts:95`      |
| mt-006 | alg / typ mismatch rejected                              | hand-built JWT with `alg=none`                         | null                              | `manage-tokens.ts:105`     |

### G. Art file storage (`art.ts`)

| id     | invariant                                                | trigger                                                              | expected                                       | target file/line  |
|--------|----------------------------------------------------------|----------------------------------------------------------------------|------------------------------------------------|-------------------|
| art-001 | extForMime accepts the 4 documented mime types          | `extForMime("image/jpeg")` etc.                                       | "jpg" / "png" / "webp" / "gif"                  | `art.ts:49-51`    |
| art-002 | extForMime rejects others                                | `extForMime("image/svg+xml")`                                         | null                                            | `art.ts:49-51`    |
| art-003 | isValidPosition allows the 8 positions (incl. minion)    | each `Position` including `minion`                                    | true                                            | `art.ts:31-47`    |
| art-004 | isSafeArtFilename blocks traversal & garbage             | `../foo`, `merlin.svg`, `..jpg`, `merlin.JPG`                          | first three false; "merlin.JPG" true (re is /i) | `art.ts:58-67`    |
| art-005 | saveArt + listArt + findArt round-trip                   | write to a `tmpdir/art`; saveArt("merlin", buf, "png"); listArt        | one entry; findArt returns it with stable etag  | `art.ts:91-186`   |
| art-006 | saveArt deletes any previous extension for same position | save merlin.jpg then merlin.png to same tmpdir                         | only merlin.png remains                         | `art.ts:78-101`   |
| art-007 | removeArt is best-effort and reports                     | removeArt with nothing on disk                                         | returns false                                   | `art.ts:103-115`  |
| art-008 | saveVariantArt + listArt variant round-trip              | save loyal-1 + loyal-2; listArt                                        | 2 entries with variants [1,2]                   | `art-fs.test.ts`  |
| art-009 | saveVariantArt replaces prior extension for same slot    | save loyal-1.jpg then loyal-1.png                                      | only loyal-1.png remains                        | `art-fs.test.ts`  |
| art-010 | saveVariantArt rejects out-of-range variant              | save loyal variant 6 / merlin variant 1                                 | throws `/out of range/`                         | `art-fs.test.ts`  |
| art-011 | findArt returns null for variant positions               | upload loyal-1; findArt("loyal")                                       | null                                            | `art-fs.test.ts`  |
| art-012 | findVariantArt returns null when rank not uploaded        | upload loyal-1; findVariantArt("loyal", 2)                              | null (no thumbnail; never reuses a variant)     | `art-fs.test.ts`  |
| art-013 | findVariantArt returns matching filename + stable etag    | upload loyal-3; findVariantArt("loyal", 3)                              | `{filename: "loyal-3.png", etag: /^[a-f0-9]{8}$/}` | `art-fs.test.ts`  |
| art-014 | cleanupOrphanArt sweeps legacy loyal/minion + junk        | plant loyal.png + minion.jpg + stray.txt on disk; call cleanup          | removed ⊇ those 3; legitimate merlin.png remains | `art-fs.test.ts`  |
| art-015 | cleanupOrphanArt is no-op on a clean dir                  | saveArt + saveVariantArt + cleanup                                      | `{removed: [], errors: []}`                     | `art-fs.test.ts`  |
| art-016 | listArt sorts by position then variant ascending          | insert out-of-order; listArt                                            | `[loyal-1, loyal-2, merlin, minion-1, minion-3]` | `art-fs.test.ts`  |
| art-017 | isVariantPosition flags loyal + minion only               | isVariantPosition for each Position                                     | true for loyal/minion; false for others         | `art.test.ts`     |
| art-018 | maxVariantsForPosition returns 5 / 3 / 0                  | maxVariantsForPosition("loyal" / "minion" / "merlin")                   | 5 / 3 / 0                                       | `art.test.ts`     |
| art-019 | isValidVariant clamps to 1..max + rejects non-integer     | various boundaries + NaN / Infinity / 1.5                               | true only for ints in 1..max for variant role   | `art.test.ts`     |
| art-020 | saveAsset + findAsset + listAssets round-trip             | `saveAsset("lake", buf, "png")`; findAsset + listAssets                 | findAsset returns entry; listAssets includes it; listArt does NOT include it | `art-fs.test.ts` |
| art-021 | saveAsset replaces prior extension for same key           | saveAsset("lake", …, "jpg") then ("lake", …, "png")                     | only lake.png remains                            | `art-fs.test.ts` |
| art-022 | removeAsset true/false branches                           | removeAsset twice on lake                                                | first true, second false; findAsset null after  | `art-fs.test.ts` |
| art-023 | listArt and listAssets are disjoint                       | mixed disk content (merlin.png + loyal-1.png + lake.png)                | listArt excludes lake; listAssets excludes role files | `art-fs.test.ts` |
| art-024 | cleanupOrphanArt keeps a legitimate lake.<ext>            | upload lake.png; call cleanup                                            | removed=[]; findAsset still returns lake.png    | `art-fs.test.ts` |
| art-025 | isValidAssetKey accepts known keys only                   | "lake" / "LAKE" / "throne" / ""                                          | true / false / false / false                     | `art.test.ts`    |
| art-026 | isSafeArtFilename accepts asset filenames                  | lake.png / lake.jpg / lake.webp / lake.gif                               | true                                             | `art.test.ts`    |
| art-027 | isSafeArtFilename rejects unknown asset keys              | throne.png / questCard.png                                                | false                                            | `art.test.ts`    |
| art-028 | ASSET_KEYS exports just `lake`                             | spread ASSET_KEYS                                                        | ["lake"]                                         | `art.test.ts`    |

### H. Web routes (`web-routes.ts`) — integration via fastify.inject

| id      | invariant                                                | trigger                                              | expected                                              | target file/line       |
|---------|----------------------------------------------------------|------------------------------------------------------|-------------------------------------------------------|------------------------|
| web-001 | upload requires manage access token                      | POST `/api/manage/art/merlin` with no Authorization  | 401                                                   | `web-routes.ts:109-131`|
| web-002 | upload rejects unsupported mime                          | POST multipart `file.svg`                            | 415                                                   | `web-routes.ts:300-305`|
| web-003 | upload rejects oversize                                  | POST multipart `>5MiB`                               | 413 (or 500 swallowed — see B-004)                    | `web-routes.ts:306-313`|
| web-004 | upload writes file when bytes & mime ok                  | POST multipart `merlin.png` 1 KiB                    | 200 + filename in body; disk has `<artDir>/merlin.png` | `web-routes.ts:285-324`|
| web-005 | unknown position rejected                                | POST `/api/manage/art/unicorn`                       | 400                                                   | `web-routes.ts:290-292`|
| web-006 | GET /art/:filename serves bytes & content-type           | upload first; then GET `/art/merlin.png`             | 200; correct mime; sniff-protected header             | `web-routes.ts:343-362`|
| web-007 | GET /art with path traversal blocked                     | GET `/art/..%2F..%2Fetc%2Fpasswd`                    | 400 or 404                                            | `web-routes.ts:346-349`|
| web-008 | upload re-replaces existing art (cache busting URL changes) | upload merlin.png twice; check list URLs differ      | second `url` has different `?v=` query                | `web-routes.ts:280-321`|
| web-009 | art volume EACCES surfaced as 500 with clear log         | force `saveArt` to throw EACCES (chmod 0 tmpdir)     | 500 with logged err.code='EACCES' — `Dockerfile.avalon` fix already chowns volume; regression-guard test only | `art.ts:96-100`, `Dockerfile.avalon` |
| web-010 | manage games list returns active games + signups         | start signup + game; GET `/api/manage/games`         | both entries present                                  | `web-routes.ts:233-239`|
| web-011 | manage force-stop removes a game by channel              | POST `/api/manage/games/:channelId/stop`             | game gone; 200                                        | `web-routes.ts:245-266`|
| web-012 | manage refresh rotates token pair                        | POST `/api/manage/refresh` with valid refresh        | new access+refresh; old refresh still valid until exp | `web-routes.ts:206-230`|
| web-013 | SPA root serves HTML with publicBaseUrl basePath injected | GET `/` with getEffectiveBase having a non-/ path    | response body contains `__PLUGIN_BASE__ = "<path>"`   | `web-routes.ts:384-414`|
| web-014 | variant upload accepted for loyal / minion                | POST `/api/manage/art/loyal/1` multipart png         | 200 with `{ position, variant, filename, url }`        | `web-routes.ts:349-376` |
| web-015 | variant upload rejected for single-image position         | POST `/api/manage/art/merlin/1`                       | 400 "Unknown variant role"                              | `web-routes.ts:354-360` |
| web-016 | variant out-of-range rejected                              | POST `/api/manage/art/loyal/6`                        | 400 "Variant out of range"                              | `web-routes.ts:362-365` |
| web-017 | variant delete happy path                                  | upload loyal-1; DELETE `/api/manage/art/loyal/1`     | 200 `{ ok: true }`; file gone                           | `web-routes.ts:378-397` |
| web-018 | variant delete 404 when slot empty                         | DELETE `/api/manage/art/loyal/2` with nothing there  | 404 "No artwork stored for this slot"                   | `web-routes.ts:393-395` |
| web-019 | asset upload happy path                                    | POST `/api/manage/asset/lake` multipart png          | 200 `{ assetKey, filename, url }`; lake.png on disk      | `web-routes.ts: /api/manage/asset/:key POST` |
| web-020 | asset upload unknown key rejected                          | POST `/api/manage/asset/throne`                      | 400 "Unknown asset"                                      | `web-routes.ts: /api/manage/asset/:key POST` |
| web-021 | asset delete happy path                                    | POST + DELETE `/api/manage/asset/lake`               | 200 `{ ok: true }`; file gone                            | `web-routes.ts: /api/manage/asset/:key DELETE` |
| web-022 | asset delete 404 when nothing stored                       | DELETE `/api/manage/asset/lake` cold                 | 404 "No asset stored"                                    | `web-routes.ts: /api/manage/asset/:key DELETE` |
| web-023 | GET /api/manage/art response shape carries `assets[]`     | upload lake + role art; GET /api/manage/art          | response body has both `art[]` (role) and `assets[]` arrays | `web-routes.ts: GET /api/manage/art` |

### I. Persistence & restart

| id        | invariant                                                | trigger                                                          | expected                                                              | target file/line  |
|-----------|----------------------------------------------------------|------------------------------------------------------------------|-----------------------------------------------------------------------|-------------------|
| persist-001 | game state does NOT survive container restart            | start game; `docker compose restart karyl-plugin-avalon`         | `getGame(channelId)` empty after restart; any prior buttons return `error.notRunning`; **no half-state crash** | `store.ts:13-29`  |
| persist-002 | manage HMAC secret regenerated on restart                | issue token, restart, attempt to verify                          | verification fails (`null`); user must re-run `/avalon manage`        | `manage-tokens.ts:23` |
| persist-003 | art survives restart                                     | upload art, restart                                              | art file still on volume; `findArt` returns it                        | `art.ts:78-101`, `Dockerfile.avalon` |
| persist-004 | second `/avalon start` after stale stop works            | start game; SIGTERM the container; restart; same channel `/avalon start` | second start succeeds (no zombie game in memory)                      | `signup.ts:52-55`, `store.ts:13-29` |

### J. i18n

| id     | invariant                                                | trigger                                              | expected                                              | target file/line  |
|--------|----------------------------------------------------------|------------------------------------------------------|-------------------------------------------------------|-------------------|
| i18n-001 | every literal `t()` key in src/** exists in zhTW         | grep `t\(undefined, "..."` across src; cross-check against `zhTW` keys | all keys resolve (no `console.warn` triggered)         | `i18n/zh-TW.ts`, `i18n/index.ts:30-36` |
| i18n-002 | role.flavor.{position} covers all 7 positions             | iterate over `Position`; call `t(undefined, "role.flavor.${p}")`     | every call returns a non-key string                    | `stages.ts:82`    |
| i18n-003 | missing key returns key and warns                         | `t(undefined, "fake.nonexistent" as LocaleKey)`      | returns the literal `"fake.nonexistent"`; warns       | `i18n/index.ts:32-36` |
| i18n-004 | LocaleKey enforces `t()` literals at compile time         | tsc on the project                                   | typecheck passes                                       | tsconfig          |

### K. End-to-end (manual / docker) — not in `pnpm test`

| id     | invariant                                                | trigger                                                              | expected                                              | how                |
|--------|----------------------------------------------------------|----------------------------------------------------------------------|-------------------------------------------------------|--------------------|
| e2e-001 | 5-player complete game to arthur win                      | docker compose up; 5 dummy accounts; play 3 cleans → assassinate → miss merlin | arthur titles; full roster reveal                     | manual + screenshot |
| e2e-002 | 5-player complete game to mordred win via 3 fails         | same; mission roster always evil; 3 fails                             | mordred title with `reasonFailures`                   | manual              |
| e2e-003 | 7-player r4 two-fails: 1 fail at r4 ≠ fail                | reach r4 with n=7; 1 fail ballot                                       | mission succeeds                                       | manual              |
| e2e-004 | image upload happy path: upload → crop → GET serves new art | use /avalon manage; upload merlin.png; reload list                     | new thumbnail in WebUI; GET /art/merlin.png returns it | manual              |
| e2e-005 | image upload mime/oversize rejection                       | try .svg upload, >5MB upload                                           | WebUI shows correct error toast                       | manual              |

## Coverage check vs goal's mandatory list

- ✅ 5 / 7 / 10 人各跑一場完整對局到 ending: state-003/004, flow-006 → flow-020,
  e2e-001/002/003 — and the simulator covers full-table 5p / 7p / 10p variants.
- ✅ 第 4 局 two-fails 規則 7+ 生效 / <7 不生效: roles-011, flow-013/014, e2e-003.
- ✅ 連續 5 次提案否決 → 邪惡方勝: state-002, flow-010.
- ✅ lady of the lake 啟用 / 關閉兩條路徑: state-011/012, flow-023/024/025/026/027/028.
- ✅ 同一人對同一按鈕快速雙擊 (race): flow-009, flow-017, flow-032 (lock test).
- ✅ 非當前 stage 點到舊按鈕: flow-030.
- ✅ 非局內玩家點按鈕: flow-008, flow-021, flow-029.
- ✅ host 中途消失 / 開新局把舊頻道擠掉: signup-002, persist-004; the WebUI
  force-stop covered in web-011.
- ✅ 程序重啟：對局中 SIGTERM → restart: persist-001/002/003/004 — restart
  drops the game cleanly; old buttons emit `error.notRunning`. **No
  resume-across-restart is implemented; this is a documented design
  choice (see INVENTORY § Persistence).**
- ✅ 圖檔上傳 EACCES / 5MB+ / 415 mime / 重複覆寫快取失效: web-002/003/008/009;
  art-001/002/004/005/006/007; e2e-004/005.
- ✅ i18n 不爆 missing key: i18n-001/002/003/004.
  *(The codebase ships a single locale; "兩種語系" is reinterpreted in
  INVENTORY § i18n as "all literal keys + the one dynamic template
  pattern resolve".)*

## Tests that DO NOT exist yet, by design

These are listed so the reviewer knows what's not been validated:
- Discord-side rate-limit handling on `messages.send` / `messages.edit`.
  The thin wrappers in `flow/discord.ts` just return null on RPC failure;
  the recovery is "give up and leave the board stale".
- Concurrent guilds load test (multi-channel parallelism beyond the
  unit-level lock test). The lock is per-channel, so cross-channel
  parallelism should be safe by construction.
- Browser-side cropper UX. Outside engine scope.
- karyl-chan main bot regressions. Out of scope.
