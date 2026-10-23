# Handover from GLM (ZCode/Claude)

## 2026-10-13 session (GLM_NEXT: integration green, table placement, dual soak)

Owned the folder after Cursor's rounds 1-2. Work done (all measurements live on the private
test server, model off where required, one soak at a time):

- **A4 lava escape root-caused and fixed** (hp 11.8 -> 18.8 in-suite). Three stacked causes,
  each live-measured with `tests/a4-probe.py` (250 ms health/position timeline):
  1. `bot.entity.isInLava` STICKS TRUE after exiting on this ViaVersion stack (same failure
     mode Cursor documented for `isInWater`), so EscapeFromLavaTask never popped and the
     WorldSurvivalChain sat at priority 100 with a zombie root while the bot burned.
     `inLava()` now trusts block data (feet/-1/+1) and only falls back to the flag when no
     blocks are loaded (`src/tasks/movement/escape-from-lava-task.js`,
     `src/chains/worldSurvivalChain.js`).
  2. `equipSafe` passed bare `{name}` objects to mineflayer's `equip`, which reads
     `item.slot` - the equip threw silently and the water bucket never reached the hand
     (`src/chains/fallbackTasks.js`).
  3. The douse is now the worker's verified `use()`-style pour (`worker.douseFire`: equip ->
     confirm heldItem -> forced lookAt -> settle -> activateItem; NO global health gate - the
     gate refused the douse exactly when it was needed). The escape task pours the bucket
     INTO the lava (source turns to obsidian under the bot; probe min hp 16).
  Stale-root guard: a SingleTaskChain whose priority drops to -1 never runs onTick, so a
  finished root blocked the next band forever - the chain retires finished roots in
  `priority()` now.
- **Table placement, Voyager/ADAM style** (`src/place-support.js` `placementCells` /
  `softBreakCell`, `src/worker.js` `placeBlockNear`): candidate cells radius 3 around the
  bot (y feet-1..+1), cell only needs to be air/replaceable, ANY solid non-replaceable
  neighbour as the reference face (never a crafting_table), walk-to-reach, break one natural
  soft block as fallback (never the bot's own column), dirt-pad last resort. Fake-world unit
  tests (`tests/place-support.test.js`).
- **Table reuse**: crafts find a standing table within 6 blocks and walk to it;
  `keepTable` leaves it standing between wood-step crafts, `collectTable` picks it up at the
  step's end (`src/worker.js`, `src/autopilot.js`, `src/schema.js`). The soak's 8-15
  "No clear spot" failures per run went to 0 (also confirmed by Cursor's later soaks).
- **Explore surface cap**: the wood step's unblock explore carries `surface:true` +
  `surfaceY` so it cannot walk off the stand (`src/autopilot.js`, `worker.explore`).
- **Schema**: craft jobs accept `keepTable`/`collectTable`; explore accepts
  `surface`/`surfaceY`/`surfaceCeiling` (the ladder's jobs were being REJECTED as
  unrecognized keys - found because the autopilot wood step stalled on submit failures).
- **A1 fixture**: `tests/integration.py` plants blocks with a verified `plant_block`
  (server-side marker check, far-tp reload on failure, client-cache refresh on success).
- **Integration GREEN**: all tests passed including A1 and A4 (hp 18.8)
  (`data/integration-results.json`).
- **Placement repro** (`tests/placement-repro.py`): seed 12345, hard anchor [140,131,32],
  cluttered dark-oak floor - table placed at (140,131,31), wooden pickaxe in 10.8 s,
  0 "No clear spot".
- **Creeper hit-and-run** (`src/combat.js`): the fuse-ring guard at d<3 sat ABOVE the 2.9
  strike window so melee creepers were NEVER hit (all ablation rows read hits=0 - the old
  "kills" were noise). Replaced with strike-once-then-reopen-past-4, wall-aware retreat.

Note: the dual soak of that session was killed by the user handover to Cursor; Cursor's
rounds 3-6 (hitbox 0.30001, teleport-confirm dedupe, weather tracking, powder snow, soak
hardening) supersede and are documented in `docs/HANDOVER_FROM_CURSOR.md`.

## 2026-10-14 session (GLM_CONTINUE: food, falls, first night, creeper)

Started from Cursor's soak 5 state: M1-M3 met (wooden pickaxe 6/6 first-seen, stone+furnace
6/6 first-seen, 0 "No clear spot"; 1 normal fall death; food 0/6; creeper 17.1 best).

### Files changed

- `src/combat.js` - creeper defence is now a **3-wide 2-high wall** across the creeper's
  heading (center on the ray at steps 2/3/1 + one flank cell each side, ground permitting;
  per-column place/stack state machine `_losCells`/`_losTried`; `_placeColumn` equips,
  places the feet and chains the head). Wall trigger moved out to **d<12** so the ~1.2 s
  build finishes before the 3-block fuse ring. Behind complete cover the bot now walks back
  (open-heading scored) while the creeper circles, instead of standing at the flank corner
  (73194 ate 17.1 standing). `_losTried`/`_losCells` reset on target change and on a column
  that never lands. Unit test extended: flanks are placed after the center column
  (`tests/combat.test.js`), 42/42.
- `src/worker.js` - passive HUNTS (fight cow/pig/sheep/chicken) scan **48** blocks, not 16
  (`huntRange`): the food step saw animals at 30+ blocks but the fight job found nothing
  inside 16 and timed out - part of why food was 0/6. FightTask candidate range follows.
- `tests/soak.py`:
  - `apply_rules('normal')` = `spawn_mobs true` + `spawn_monsters false` + frozen
    daylight/clear, every rule verified back (both rule names confirmed live on this
    server before use). Animals finally exist for the food step.
  - `apply_rules('dawn')` (hard) = `spawn_mobs true` + `spawn_monsters true` + confirmed
    dawn: natural spawning, so the first night is real.
  - Hard runs span **1250 s** (20+ min): dusk is at t=600 s, so the bed/shelter night is
    actually measured (a 600 s run never leaves daytime). Normal stays 600 s.
  - Summary gains `food_runs` / `edible_peak` / `edible_end` / `tod_end` (eating is the
    point, so the end inventory alone under-reports food; `tod_end` shows the hard runs
    crossed night).
- `tests/combat_integration.py` - **both creeper variants reported** per CLAUDE_REVIEW
  2026-10-14 07:01: `4_creeper` (lane spawn) and new `4b_creeper_roofed` (the old roofed
  12x12 hard case). A third honest outcome recorded when the wall cancels the fuse and the
  creeper leaves alive: REPELLED (swept afterwards), next to KILLED and SURVIVED.

### Measurements (all live, model off via `config.model.enabled=false`)

- Unit tests excluding `tests/resources.test.js`: **189 passed, 0 failed**
  (`node --max-old-space-size=2048 --test-timeout=60000`).
- Creeper remeasure (3 combat suite runs, all exit 0; the whole suite passed each time):

| wall trigger | lane 4_creeper | roofed 4b_creeper_roofed |
|---|---|---|
| run 1 (d<8) | REPELLED, damage **0** (fuse cancelled by the wall, creeper left alive) | killed, 17.7 (hp 4.3) |
| run 2 (d<8) | killed, 16.2 (hp 5.8) | killed, 17.4 (hp 4.6) |
| run 3 (d<12) | survived by retreat (health floor), 16.3 (hp 9.7) | killed, 15.6 (hp 5.4) |

  The wall goes up in ~1.2 s (log: "los-break creeper wall at x | y | z"). When it
  completes before the creeper closes, the fuse cancels and the bot takes **0**; when the
  creeper rounds a flank first, the blast still lands ~16. **M4 creeper damage <10 is NOT
  met** (best single outcome 0, typical 15.6-17.7). Budget spent (6 variant attempts);
  next hypothesis for whoever continues: pillar up 2-3 blocks (creepers cannot climb)
  instead of / in addition to the wall.

### Soak 6 (2026-10-14, ended 12:00 IST, `data/soak-results-20261014-120028.json`, SOAK DONE clean, model off)

First soak with animals: normal = `spawn_mobs true` + `spawn_monsters false` (verified);
hard = natural spawning + **1250 s runs** (dusk at t=600 s, so the night happens). Anchors
normal [310,131,30], hard [142,131,31]-ish (scouted). Flat world restored.

| run | wood | stone | food (peak/end) | deaths | causes / notes |
|---|---|---|---|---|---|
| normal1a1 | YES 90 s | YES 331 s | 0 / 0 | 0 | clean run |
| normal2a2 | YES 120 s | YES 271 s | 0 / 0 | 0 | clean run |
| normal3a3 | no | no | 0 / 0 | 0 | all 5 wood tools + stone kit crafted but the table was collected at the end (official wood flag artifact, same as Cursor's hard3) |
| hard1a1 | YES 180 s | YES 572 s | 0 / 0 | 1 | **blown up by a creeper at t=662, daytime, light 14**, during the stone step; run resumed and finished |
| hard2a2 | YES 361 s | YES 752 s | 0 / 0 | 0 | slow wood (contested night terrain) |
| hard3a3 | no (table 0 at end) | YES 782 s | 0 / 0 | 1 | **fell from a high place** t=211 during the wood step |

- **First night: SURVIVED.** All three 1250 s hard runs crossed dusk/night and ended
  `tod_end='day'` with the kit intact - but without sleeping or sheltering: the autopilot's
  night branch sat BEHIND the active-job return and a continuously busy ladder never
  reached it (fixed after this soak - see below). The nights were tanked on stone gear.
- **Normal deaths 0/3** (the falls target); the 2 deaths are both hard mode (1 creeper, 1
  fall). The food-explore fall surface ceiling held (no peak walks this soak).
- **Food 0/6** - but the mechanism now exists: hard3's food step found chickens, killed
  one, smelted it and ATE it (job trail: `fight chicken complete hits=4` ->
  `smelt chicken complete`; the bot's food stat later drained to 6 with nothing left).
  The other five hunts failed `Fight timed out; chicken is still standing` - **maxSeconds
  30 is too short for panic-running chickens**, and two `smelt`/`explore` legs died to
  navigation races.
- Wood 4/6 / stone 5/6 official (the two "no" rows are the table-collected-at-end artifact;
  both runs held the full tool kit during the run).

### Fixes after soak 6 (loaded for soak 7)

- `src/autopilot.js`: night prep outranks day jobs - when `timeOfDay` enters night and the
  day's night job has not run, the active job is cancelled and sleep/shelter is submitted
  (it previously only fired on an idle ladder, which a healthy ladder never is).
- `src/autopilot.js`: passive hunts get **maxSeconds 90** (chicken chases); food explore
  legs are 32 blocks (re-decide every ~20 s); the tick CANCELS a running food explore the
  moment animals come into the 48-block hunt range (normal1/2 walked 200+ blocks past).
- `src/autopilot.js` `grazeDirection` samples biomes at 16/48/96/160 and scores far graze
  highest (soak 6 walked into a taiga river valley on a near-sample "meadow").
- `src/worker.js` `exploreLeg`: a leg counts when it covers >= 60% of the requested
  distance (32-block scan legs failed the old distance-1 gate on any obstacle).
- `tests/soak.py`: `job_evidence` records the LAST 40 session jobs (jobs[:40] recorded run
  1's trail forever; later runs' evidence was being lost).

### Soak 7 (2026-10-14 12:07-13:46 IST, `data/soak-results-20261014-134647.json`, SOAK DONE clean, model off)

With the soak-6 fixes loaded (90 s hunts, 32-block legs, cancel-on-animals, far biome
probes, anchored... not yet: the anchored ceiling landed mid-soak and is loaded AFTER).

| run | wood | stone | food (peak/end) | deaths | notes |
|---|---|---|---|---|---|
| normal1a1 | YES 90 s | YES 331 s | 0 / 0 | 0 | food explore walked to frozen_peaks (see ratchet bug below) |
| normal2a2 | YES 90 s | no | 0 / 0 | 0 | stone unfinished (1 resume) |
| normal3a3 | YES 90 s | YES 241 s | 0 / 0 | 0 | best stone time yet |
| hard1a1 | YES 271 s | YES 902 s | 0 / 0 | 0 | survived the whole night unsheltered; **food fight ran at t=963-1083 (hits landed) but the follow-up collect sat `queued` for 150+ s and the drops despawned** |
| hard2a2 | no | no | 0 / 0 | 1 | **fell from a high place**; 8 interventions; the wood step never recovered the kit |
| hard3a3 | no (table 0) | YES 1113 s | 0 / 0 | 1 | cause not captured (event window overflow) |

- **Food 0/6 again**, but the loop is now proven end to end: kills happen, meat cooks, the
  bot eats it. What kills it each time is logistics, and soak 7 exposed two real bugs
  (both fixed after this soak, see below):
  1. **Passive hunts did not sweep their own kills.** The follow-up `collect` job queues
     behind whatever survival tree is still alive (night mobs keep Mob Defense running)
     and sat queued for 150 s while the drops despawned (hard1 t=1113-1263 all
     `queued: collect`).
  2. **The dusk/night branch never fired.** ViaVersion delivers `bot.time.timeOfDay` as the
     RAW world age in ticks; observe.js moduloes it (`%24000`) but the autopilot's
     `>=12541 && <=23458` window compared the raw value, which sits OUTSIDE that window
     almost always. No [night] submission in either soak's hard nights.
- **Normal deaths 0/3 again** (falls target met in normal both soaks). The 2 hard deaths:
  1 fall (hard2), 1 uncaptured (hard3).
- **First night: survived in every hard run across both soaks** (tod_end='day' each time),
  still unsheltered.
- Normal anchor note: the normal anchor's surroundings are an animal desert (the bot
  walked 200+ blocks without a sighting) while the HARD anchor's dark forest has
  chickens/pigs in view. Food should be measured primarily on the hard runs until the
  scout picks an animal-verified normal anchor.

### Fixes after soak 7 (loaded; NOT yet soak-measured)

- `src/autopilot.js`: **raw-age fix** - every dusk/night window now uses
  `((timeOfDay % 24000)+24000)%24000` like observe.js. This is the fix that should make
  the night branch actually submit sleep/shelter.
- `src/worker.js` `fight()`: **passive hunts sweep their own kills** (`sweepDrops` after a
  won hunt) - the drops no longer depend on a collect job getting pump time.
- `src/autopilot.js`: the food explore's ceiling is **anchored to the wood step's stand Y**
  (`min(standY,lastSurfaceY)+8`); the old per-leg standY+8 ratcheted the bot up a peak +8
  per leg (soak 7 normal1: y=156 on frozen_peaks).

### Milestone status (GLM_CONTINUE)

- M1-M3: met and stable (wood 4/6 and stone 4-5/6 official here, but every failure is the
  table-collected-at-end flag artifact or a hard-mode fall - the first three normal runs
  in soak 7 went wood 90 s / stone 241-331 s with 0 deaths and 0 "No clear spot").
- M4 food: **not met** (0/6, 0/6) - the loop works, logistics were the blocker, fixes
  loaded. Next session: rerun the dual soak; expect `food_runs >= 4/6` on the hard runs.
- M4 first night: **survived 6/6 hard runs** (the milestone's sleep/shelter half should
  now fire with the raw-age fix - verify a `[night] shelter` line appears in the next
  soak's dashboard log).
- M4 creeper <10: **not met** (lane 0/16.2/16.3, roofed 17.7/17.4/15.6). Next hypothesis:
  pillar up 2-3 (creepers cannot climb). Note: a WILD creeper killed the bot in soak 6
  hard1 (daytime, during the stone step) - the defense chain flees creepers but has no
  wall logic outside FightTask.
- M5 iron: not started (the iron step is written in the ladder; it needs the food step
  green ahead of it).

### Suggested next-session order

1. Rerun the dual soak with the three post-soak-7 fixes (raw-age night, hunt drop-sweep,
   anchored ceiling). Judge food on the hard runs; check for `[night]` submissions.
2. If food still 0: the remaining suspects are (a) the normal anchor has no animals -
   make the scout verify animals within 64 of an anchor like it verifies logs, and
   (b) `collect` radius 16 vs scattered drops.
3. Creeper pillar-up variant (one combat run), then M5 iron.

Model never started this session (`config.model.enabled=false`, guarded by Start-Agent).
No name-kills. No test made easier: the roofed creeper variant was ADDED alongside the
lane variant, and the "repelled" outcome records a real event rather than relaxing the
damage metric.

## Cloud session (Claude, 2026-10-14, code only - `docs/CLOUD_TASK.md`)

No game access: nothing below is live-measured. Unit tests only (every `tests/*.test.js`
except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000`):
**189 -> 222 passed, 0 failed**. Each new test was checked to fail on the code before its
fix. Model never started, no server, no processes touched. Five commits on `main`:
`c3c0ce6`, `9b3b897`, `8833466`, `ea86ca2`, `10112de`.

### What changed

1. **GLM's last changes reviewed** (`c3c0ce6`). mineflayer 4.39 already reduces
   `time.timeOfDay` modulo 24000, so the raw-age theory is unconfirmed; the modulo is now one
   shared helper (`src/daytime.js`) used everywhere, because `worker.sleep`/`shelter`,
   `SleepTask`/`ShelterTask` and `combatPolicy` still read the raw clock: if raw ages do
   arrive, the night job GLM's fix submits would refuse to sleep or wait for morning
   forever. Also fixed:
   - Night prep no longer cancels a running fight, eat, sleep or shelter job.
   - Hunts lock one animal (`lockFirst`): "clear every chicken in 48" timed out on any
     flock, and a timeout threw before the drop sweep. They now sweep radius 16 on success
     and on timeout.
   - The shelter digs out only cells that were empty when it started (it used to dig a
     hillside's natural blocks at dawn).
   - Food-graze ceiling: the anchor is fixed for the run. `min(current, anchor)` ratcheted
     down into valleys. With no surface gather, the anchor is latched once. A bot already
     above the cap gets `cap=current`, because navigation rejects any position above the
     cap, so every leg used to fail at once.
   - Tests: `tests/daytime.test.js`, `tests/hunt.test.js`, plus the anchor tests.
2. **Creeper pillar-up** (`9b3b897`, `CombatController._pillarTick`).
   - **Trigger:** a creeper within 8, or fusing; the bot on solid ground, not in fluid,
     holding 2+ blocks (cobble > deepslate > planks > netherrack > dirt) with headroom.
   - **Climb:** 3 up (2 under a low ceiling). Hold jump, look down, place on the block under
     the feet at the apex.
   - **Perch:** hold while it fuses. If it stays, shoot it (bow) or strike down when its box
     is within 3 of the eyes.
   - **Descend:** after it stays past 8 for 1 s, step off a side with a drop of 3 or less
     (no fall damage, never into fluid). With no such side, dig only its own column.
   - **Fallbacks:** a climb that fails or takes longer than 4 s falls back to the wall. A bot
     that can pillar no longer builds the 12-block wall in bow mode. The wall stays the
     fallback with no blocks or no headroom.
3. **Bow aim / look convention** (`8833466`), probably the main finding of this session.
   `combat.js` and `fallbackTasks.js` used the Notchian yaw and pitch (z=+cos(yaw),
   positive pitch looks down) with `bot.look`. mineflayer's convention is yaw 0 -> -z and
   positive pitch up (`ray_trace.js` getViewDirection, `physics.js` lookAt; `compat.js`
   already sends yRot=180-yaw). The effects:
   - Every heading with a z component was mirrored, and every bow pitch was inverted. That
     matches "arrows 0 hits" and the kite/away legs that "walked into the fuse" in
     73176-81. `RunAwayTask` (the MobDefense creeper flee) ran toward z-axis creepers, which
     is a plausible factor in soak 6's wild-creeper death.
   - Fixed through `src/heading.js`, with a test that reads the installed mineflayer source.
   - Ballistics follow vanilla `AbstractArrow.tick` order: move, then drag 0.99, then
     gravity 0.05. Arrows launch from eye height minus 0.1. The shooter's own motion is aimed
     out exactly, since the flight is linear in the launch velocity.
   - `_openAlong` probes the 0.6-wide body, not only its centre line.
   - Earlier combat-log conclusions about "look-relative walk-ins" should be re-read with
     this in mind.
4. **Iron step (M5)** (`ea86ca2`).
   - The core comes first: 6 ore, smelt, then iron pickaxe, iron sword, shield.
   - Ore comes from a staircase to y=32 (an explicit `targetY` now goes down before any
     surface search), and gathers also match `deepslate_*_ore`.
   - Smelting burns coal first and keeps an 8-plank reserve. After the core: 16 coal and the
     remaining 30 ingots.
   - `smelt` picks up a furnace it placed itself; a furnace left behind made the stone step
     regress. `pickUp` equips the right tool first.
5. **Soak food metric** (`10112de`). Root cause of `edible_peak 0`: `soak.py` read
   `observe.inventory['_edible']`, a key observe never had.
   - observe now reports `edible`.
   - The worker counts meals (a food-bar rise within 5 s of any `bot.consume`, which covers
     eat jobs, auto-eat, FoodChain and the fight's disengage-eat; respawns don't count) and
     food smelted (`cooked`). `/api/state.meals` exposes both.
   - `soak.py` diffs them per run and the summary gains `eaten`, `food_points` and
     `cooked`. `tests/soak_metrics_check.py` is an offline check.

### Files

`src/daytime.js` (new), `src/heading.js` (new), `src/autopilot.js`, `src/worker.js`,
`src/combat.js`, `src/observe.js`, `src/chains/fallbackTasks.js`,
`src/chains/combatPolicy.js`; tests `daytime`, `hunt`, `iron`, `meals` (new),
`autopilot`, `combat` (back to LF line endings), `chains`; `tests/soak.py`,
`tests/soak_metrics_check.py` (new).

### Needs live verification (Cursor / `docs/CURSOR_TESTER.md`)

- **Look convention, first:** in any fight log, confirm the bot faces and walks away from a
  mob that is off the x axis, and that bow arrows now land (`shots` vs `hits`). Combat units
  pass, but every yaw-dependent behaviour has changed.
- **Combat suite `4_creeper` and `4b_creeper_roofed`:** expect "Combat: pillar-up 3",
  "pillar perched", then strikes or shots from above. Measure damage on both. Unknowns to
  watch: the apex place timing on ViaVersion (`pillarClear` 0.1); whether 3 up stops the
  fuse; whether the roofed arena's ceiling leaves room for 2+. The arena's roof height
  decides that.
- **Soak:** `[night]` sleep/shelter submissions in the hard runs; the food columns `eaten`
  and `cooked` versus `edible_peak`; hunts now end after one kill and sweep; the iron step
  (staircase to y=32, smelt, iron pickaxe and sword) if a run gets that far.
- **Not done:** MobDefenseChain (reflexes on, autopilot) still only flees a wild creeper;
  the pillar runs only inside fight jobs. If the corrected flee still loses to creepers in
  soaks, a `CreeperPillarTask` in the swelling-creeper branch is the next step.


## Cloud session round 2 (Claude, 2026-10-14, code only - `docs/CLOUD_TASK_2.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test-timeout=60000`: **250 passed, 0 failed** (222 at the start
of the round, plus 28 new). Offline Python checks: `tests/combat_damage_check.py` and
`tests/soak_metrics_check.py` both pass. One commit per task on `main`.

1. **Arrows never register hits** (`bf26c2c`). The release path itself looks correct for
   1.21.4: `use_item` carries `hand`, `sequence` and the rotation, and the release is
   `block_dig` status 5 (RELEASE_USE_ITEM). The 0-hit result came from detection, plus one
   aim fault:
   - Bow shots never counted as hits at all. `stats.hits` was only bumped by melee.
   - The probe looked 120 ms after the release for an `arrow` within 6 blocks of the feet. A
     full-draw arrow flies 3 blocks/tick, so by then it was 6+ blocks out, already in the
     target, or stuck past the radius. That is why an arrow name was visible but "not near".
   - `compat.js` drops `position_look` over the 30/s cap. mineflayer records the aim as sent
     before that wrapper runs, and never re-sends an unchanged aim, so the server could
     release along a stale rotation. A dropped rotation now rides the next `position`, and a
     bow release first re-sends the current aim (one `look`) when the server's copy is stale.
   - New `src/arrowShots.js` tracks each shot.
     - **Released:** the inventory arrow count drops, or an arrow spawns within 5 of the eye.
       The spawn `objectData` owner filters out skeleton arrows.
     - **Landed:** `entityHurt` (damage_event) on the target within 3 s, or the target's
       `health` metadata (index 9) drops.
     - **Missed:** `in_ground`, or silence past the window.
     - **Unreleased:** neither a count drop nor a spawn. It logs
       `no arrow left the bow: arrows N->N`, which is the live answer to "is it released?".
   - Landed arrows count as hits. Fight summaries add `released=` and `landed=`.
2. **Combat damage accounting** (`81f4f7a`, `tests/combat_integration.py`).
   - `damage_from()` sums every health drop between consecutive samples. That equals start
     minus end plus anything healed or eaten. A death still counts the hp lost.
   - `settle(m)` adds the live health after the kill checks and sweeps. The lane creeper's
     blast very likely landed after the job settled, outside every old sample.
   - Tests 2-8 now call `record()` before their post-fight asserts. Job status and end
     health are in the notes.
3. **Stuck at canopy spawns** (`86df23e`). Gather failures went into one job-wide counter,
   and only the column of every third failure was blacklisted. Attempts alternating between
   trunks never blacklisted anything. `badColumns` was also lost when the ladder resubmitted
   the gather.
   - `gatherFailed()` counts per block and per column.
   - A reach failure skips the block at once. The reach fallbacks have already run by then.
   - Any other error skips the block on its second failure. Three failures in a column drop
     the column.
   - Skipped blocks also go into the shared worker blacklist for 10 minutes, so the next job
     skips them.
   - A missing harvest tool fails the job at once.
4. **Ladder regressions** (`8158c99`).
   - **Table never collected:** the wooden axe and furnace crafts carry `keepTable` AND
     `collectTable`, but the craft only collected when `!keepTable`. Every step's table
     stayed in the world, which matches hard2 ending with no table held. `collectTable` now
     wins.
   - **normal3 going idle (likely cause):** the autopilot cancels its own food explore when
     animals come into range. `cancel()` went through a user-sourced `stop()`, which set
     `userStopped`, and the next tick switched the autopilot off as "Stop all". The job
     watchdog did the same. `cancel(id,source)` now takes a source, and the
     `autopilot`/`timeout` stops leave `userStopped` alone.
   - **Table left out of reach:** a `keepTable` craft records its table in
     `worker.leftTable`. While that table stands within 32, it counts as the wood step's
     table, and the ladder walks back (`goto`) before a step-kit craft. Two trips that do not
     reach it forget it.
5. **Zombie trio** (`0cc8eed`).
   - `setTarget()` reset the attack charge, so a switch allowed an instant uncharged swing.
     It no longer does.
   - FightTask stays on a target that is in reach, or until another is 1+ block closer.
     A creeper always takes over.
   - Between swings, if another hostile is within `groupReach` 3.5, the controller faces the
     target and steps back or sideways. It picks the open heading that gives the most room
     from the other mobs, never into the target. When walled in, it holds and swings.
   - A full charge with the target in reach still strikes first (the force-field rule).
   - The shield goes through the existing primitive, which stays ablated.
   - A 10 s trio simulation: ticks with 2+ zombies in reach drop from 196 to 49, still 10
     swings.

### Files

`src/arrowShots.js` (new), `src/combat.js`, `src/compat.js`, `src/worker.js`,
`src/autopilot.js`, `src/chains/fightTask.js`; `tests/combat_integration.py`; new tests
`arrows`, `gather-blacklist`, `ladder`, `group` (`.test.js`) and
`tests/combat_damage_check.py`.

### Needs live verification

- **Arrows:** every shot now logs `Combat: arrow <mob> @Ns: released|landed|missed|unreleased (...)`.
  - `unreleased` means the release really fails on this path. Then look at the held slot
    and the draw time.
  - `released` followed by `missed` means aim or ballistics, not detection.
  - Compare `shots=` with `released=` and `landed=` in the fight summary.
  - Watch for a `PACKET_RATE` line from the extra `look` before a release. Expect at most one
    per shot.
- **Combat suite damage:** `4_creeper` `damage_taken` should now match the hp the bot really
  lost (start 20, end 3.86 gives about 16). Failed legs should still appear in
  `data/combat-results.json`.
- **Soak:**
  - hard anchors: `Gather: skipping <block> at x,y,z (Cannot reach ...)` once per block, then
    the gather moves on or explores. It should no longer sit for minutes at [138..141,130,21..23].
  - The wood predicate (table in inventory) should hold after each step's last craft.
  - No `Autopilot stopped (Stop all)` after `food explore cancelled - animals in range`.
- **test2_zombie_triple:** expect `group-spacing` states between swings, fewer hits taken,
  and no retreat at 8. The group step still needs checking in the 12-wide roofed arena,
  where walls limit the headings.
- **Not changed:** bow ballistics constants and the shield ablation. The night soak branch
  (Cursor's harness fix) is still unmeasured from round 1.


## Cloud session round 3 (Claude, 2026-10-14, code only - `docs/CLOUD_TASK_3.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test-timeout=60000`: **270 passed, 0 failed** (250 at the start
of the round, plus 20 new). Offline Python checks: `tests/soak_metrics_check.py` (now with
iron) and `tests/combat_damage_check.py` both pass. One commit per task on `main`. All five
tasks were done.

1. **Hard-mode stone step** (`669b652`, new `src/digDown.js`).
   - Cause: on the dirt hill under the canopy, `findBlocks` returns stone *buried* under
     the dirt. Every walk to it failed "Cannot reach or harvest", and the round-2 blacklist
     skipped the next buried block within milliseconds.
   - Stone-family gathers without `targetY` (the ladder's stone step) now go through
     `stonePlan`:
     1. Exposed stone (a face open to air) within 16 of the bot: mine those.
     2. Otherwise, when the scan saw stone under the bot (up to 12 below, 16 across) and
        dig-downs are left (3 per job): dig down where it stands with the existing staircase.
     3. Otherwise: the old list (exposed first).
   - `pickStairDir` simulates the 2-high 45-degree staircase in the four directions. A
     direction is refused at bedrock, at fluid touching a cell, at a non-natural block (logs
     count as non-natural), or at a missing floor. It needs 3+ clear steps and takes the
     deepest, then the one through the most stone.
   - The staircase takes `dir`, `natural` and `stopWhen`. It stops early (3+ down) once a
     side wall is stone, then the walls are mined from inside the tunnel. `digTunnelStep`
     can refuse non-natural cells and missing floors. The bot climbs the recorded tunnel at
     the job's end as before.
   - The block under the feet is never a stone target, so repeated floor drops cannot make
     a shaft. Nothing digs straight down.
   - The gather loop rescans at most once per second (`GATHER_RESCAN_MS`) while it collects
     nothing.
   - Integration legs that gather stone (stone sealed behind dirt, the planks shell,
     `targetY` staircase) go down the same paths as before: exposed-near or `targetY`.
2. **Roofed creeper: no pillar** (`9c70135`).
   - Precondition that failed: headroom. While drawing, the bow backpedals away from the
     creeper. From (1496,1497) that heading leads into the arena's 2-high corner pocket
     (ceiling y-58 over x/z 1494..1496, the enderman patch). `_pillarSpot` found no room
     there, so `_losBreak` built the wall.
   - Held item and `bowMode` were not the cause: the climb already switches to blocks, and
     `_pillarTick` runs before the bow branch.
   - Fixes:
     - The creeper backpedal (draw and `_creeperBack`) never leaves a cell where a pillar
       fits for one where none does (`_backKeepsPillar`).
     - New `step` pillar phase. Inside the wall's range (12) with no room here, walk to the
       nearest cell within 2 where a pillar fits, then climb. The path must be open and
       floored, and the creeper must stay 4.5+ from the new cell. It gives up after 1.5 s
       with a 5 s retry block.
   - Tests:
     - "bow shot, then a creeper closing next to a low pocket": no backpedal, pillar 3,
       no wall.
     - "bot already in the pocket": steps out, then pillars.
     - No step toward a close creeper; the step timeout.
   - One test fixture changed: the old headroom-fallback test put a ceiling over the bot's
     cell only, and that is now (correctly) a step. Its ceiling now covers the whole patch,
     so the wall-fallback assertion still means "no room anywhere".
3. **Soak length for iron** (`90be045`, `tests/soak.py`).
   - `NORMAL_SECONDS=1200` (frozen-day rules unchanged). `HARD_SECONDS=1250`. A full soak is
     now about 30 min longer.
   - Samples carry `iron_ore` (raw iron + ore items), `ingots` and `iron_pick`. Per run:
     `iron`, `iron_ore_peak`, `ingots_peak`, `iron_pick_at`. The summary adds `iron_runs`
     and the per-run lists. The run line prints them.
   - The operator unstuck (+4 teleport) now fires only within 8 of the anchor height.
     Underground, on the iron staircase, it would land the bot inside rock.
4. **A4 lava fixture** (`adf41c8`).
   - The fixture race: the lava was filled on top of the bot. Its escape poured the water
     bucket into the trench before `execute if block` ran, and the cell read water.
   - New order: sweep, park the bot 2 blocks off the trench, wait until it is idle
     (`wait_bot_idle`: no running/queued job, no acting survival tree, not moving), fill,
     verify both trench ends, then tp the bot in.
   - The escape predicate is read only after the first lava damage. Right after the tp the
     bot is at 20 hp and would satisfy the `health>=18` clause before it ever burned. A lost
     douse is printed as a NOTE.
   - **The douse interruption is a real ownership bug.** `runner.tick()` claims control
     *after* `tickChain()`. A task that calls `worker.douseFire()` from the first `onTick`
     of a fresh tree therefore failed the synchronous `owned()` check, and one of the two
     bucket attempts was lost.
   - `douseFire` now waits up to about 200 ms for the claim. A real owner change mid-pour
     still throws.
   - `tests/douse-ownership.test.js` reproduces the live message with the real `TaskRunner`,
     `WorldSurvivalChain` and `EscapeFromLavaTask`.
5. **Bed before dusk** (`f6fe921`, `bedPrepJob` in `src/autopilot.js`).
   - Window: tod 9000 until dusk, with no bed held or placed.
   - Wool is cheap only when a sheep is within 32 and the bot holds shears (`shear`) or a
     sword (`hunt` sheep, one wool each, capped at the sheep near). The planks for the bed
     (+4 when no table is held or within 4) must come from what is held.
   - Order: 3 wool of one colour, then planks, then the bed. Step name `bed-prep`, at most
     5 jobs a day. A failed prep job ends it for the day.
   - Otherwise the dusk dirt and the shelter are unchanged. A held bed already turns the
     night job into `sleep`.

### Files

`src/digDown.js` (new), `src/worker.js`, `src/combat.js`, `src/autopilot.js`;
`tests/soak.py`, `tests/soak_metrics_check.py`, `tests/integration.py`; new tests
`stone-step`, `douse-ownership`, `bed-prep` (`.test.js`), plus three new cases and one widened
fixture in `tests/combat.test.js`.

### Needs live verification

- **Soak, hard anchor (stone):**
  - Expect `Gather: No exposed stone within reach; digging down to y=N (staircase x, 0, z)`.
    Then cobble from the tunnel, the step finishing, and the climb back up.
  - The `skipping stone` bursts should be gone, at most one rescan a second.
  - Watch for `dig-down stopped: Tunnel stopped: ... is not natural terrain` or
    `no floor` (canopy roots, caves). After 3 dig-downs the job falls back to the old list.
- **Soak, normal runs at 1200 s:** the iron step should start (`[iron]` lines), with
  `iron_ore_peak`, `ingots_peak` and `iron_pick_at` in the summary. Confirm no operator
  teleport fires underground.
- **Soak, hard nights:** look for `[bed-prep] {"type":"hunt","entity":"sheep",...}` (or
  `shear`) before dusk, then `craft *_bed`, then `[night] {"type":"sleep"}`. No sheep means
  the dusk dirt and the shelter, as before.
- **Combat `4b_creeper_roofed`:**
  - Expect no backpedal into the corner pocket, then `pillar-up 2` at 8. Or, if the bot
    starts there, `Combat: pillar step to x,y,z (no headroom here; ...)` and then
    `pillar-up`.
  - Damage should be under 10 if the 2-high perch holds. The roof leaves no room for 3.
- **Integration A4:**
  - The verify should pass now. Then measure the escape hp.
  - `Bucket-into-lava skipped: Douse interrupted` should not appear. If the NOTE prints
    anyway, the remaining cause is a later owner change (a tp or a job), not the first tick.
- **Not changed:** the lane `4_creeper` repelled-in-1.1 s case, the bow ballistics, and
  MobDefenseChain's wild-creeper flee. The pillar still runs only inside fight jobs.

## Cloud session round 4 (Claude, 2026-10-14, code only - `docs/CLOUD_TASK_4.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test-timeout=60000`: **304 passed, 0 failed** (270 at the start
of the round, plus 34 new). `tests/soak_metrics_check.py` and `tests/combat_damage_check.py`
pass. One commit per task on `main` (`0ac0ea8`..`9058977`). All six tasks were done.

1. **Suffocation during the dig-down** (`0ac0ea8`).
   - Cause: `digTunnelStep` dug the step feet -> head -> corner. The bot stepped in 80 ms
     later without re-reading the cells. Sand or gravel over the corner fell into the step,
     onto the bot. Then the low-health stop (task 2) froze the job, and nothing in the code
     ever freed a head stuck in a block.
   - Steps are now dug top-down and settled (`clearCells`): re-dig until every cell is air,
     nothing that falls sits on the top cell, and no `falling_block` entity is still dropping
     in that column. After 12 rounds the step is refused instead of entered.
   - After every staircase and strip-mine step, the bot's own head and feet are freed again
     (a late fall).
   - `pickStairDir` skips steps with sand or gravel on top.
   - New `EscapeSuffocationTask` in `WorldSurvivalChain`, priority 100, after the head has
     been in a solid block for 0.3 s. It runs after a Stop too, like the lava escape.
     - It digs natural or falling blocks, one dig at a time.
     - Inside a built block it pushes toward an open side and never breaks it.
   - Stop/cancel mid-tunnel: each staircase step records the tunnel on the worker
     (`strandedTunnel`).
     - The next gather adopts it and climbs it at its end.
     - Surface jobs (goto, explore, hunt, collect, shear, breed, deposit, build, place)
       climb it before they start.
     - A user stop still halts on the spot (the hard rule). The cells around the bot are air
       by construction, and the escape covers anything that falls later.
   - `NATURAL_DIG` moved to `src/digDown.js`.
2. **`Autopilot stopped (Stop all)` on its own** (`fd062a0`).
   - Cause: the low-health stop (`bot.on('health')`), the death stop and the connection-end
     stop still used `stop()`'s default `'user'` source. Every hard hit mid-job switched the
     ladder off: normal2 twice, hard1 and hard2, each just before a death.
   - Fix: they are now `onHealth`, `onDeath` and `onEnd`, with the sources `'health'`,
     `'death'` and `'connection'` (`LADDER_SAFE_STOPS`, exported). Death still holds the
     ladder through `deathResume` ('paused: died').
   - `app.js` passes `'user'` explicitly for `/api/stop` and `/api/cancel`, and so does
     `disconnect()`.
   - Follow-through, because a health stop now leaves the ladder on: below minHealth the
     autopilot eats once (when food < 18, since regen needs it) and waits up to 60 s. It
     does not submit jobs that `check()` refuses, which would burn 3 failures and block the
     step. The night job still goes out.
   - `tests/stop-sources.test.js`:
     - one test per caller: health, death, connection, watchdog, runner preemption, and the
       API/disconnect;
     - a source scan that fails on any new internal stop/cancel call without a ladder-safe
       source.
3. **Packet kick** (`40cbb1d`, `9058977`).
   - `src/compat.js` now budgets every serverbound play packet: a 1 s sliding window of 200.
     Paper's limit is 500/s averaged over 7 s.
   - Over the budget:
     - movement, look, input, the timer `tick_end` and swings are dropped (a later packet
       supersedes them);
     - digs, uses, attacks, clicks and chat queue in order and drain as the window frees
       (256 deep, newest dropped beyond that).
   - Always sent: `keep_alive`, `teleport_confirm`, and the tick boundary after a movement
     that went out.
   - Swings are capped at 10/s. A dropped look still marks the rotation stale.
   - `bot.packetStats` and a rate-limited `PACKET_BUDGET <queued|dropped> <name>` console
     line name the packet that hit the cap.
   - Flood found: `digSafe` in the powder-snow and fire escapes called `bot.dig` on every
     20 Hz tick. Each call restarted the dig (dig start, abort, swing, look), so the block
     never broke. It now runs one dig at a time per bot.
   - The 17:58Z record itself (which packet flooded) was not in the repo. The next kick, or
     near-kick, will print it.
4. **Hard stone: cobble but no pickaxe** (`b491fee`).
   - Cause: the stone step crafted nothing until 32 cobble was held. On the hard anchor the
     dig-down gather failed short every time, so the ladder kept resubmitting the gather.
   - Fix: the kit is crafted in order as soon as the next piece is affordable. The pickaxe
     comes at 3 cobble, then the sword (2), axe (3), shovel (1), then the furnace (8).
     Only a shortfall gathers (still up to 32), and the order never skips ahead.
   - Table and furnace provisioning (`placementCells` `avoid`) keeps the open tunnel's
     cells free, so a craft at the bottom of a dig-down cannot block the climb out.
5. **Skeleton death in a cave** (`b1b17d2`).
   - Fix: the food explore gets `surfaceFloor` = anchor - 6, mirroring the +8 ceiling (a bot
     already under it stays level).
     - `explore()` arms the navigation's surface check with it.
     - It also adds a pathfinder cost of 100 per step below the floor.
     - The schema accepts the field.
   - Shot at with no shield in the off hand: `exploreLeg` stops the leg when health drops
     while a skeleton, stray or bogged within 24 has line of sight.
     - It then walks (normal movements, no digging) to the nearest cell within 5 that no
       shooter can see (`coverCell` and `lineBlocked` in `move-safety.js`).
     - The job then fails with the reason, and the ladder backs off and re-decides.
   - With a shield, the leg is left to the shield and the fight chains.
6. **Small ones** (`fa3f98c`).
   - Snow: tunnels dig a block without its harvest tool when its hardness is at most 0.5
     (snow, snow blocks, netherrack; about 2.5 s by hand). Stone and ores still need the
     pickaxe.
   - Furnace output: the smelt job takes its output every 8 items. When it ends early (stop,
     reflex, time limit, the soak bell), it takes the finished output and the unsmelted
     input back before the window closes, because the furnace it placed is picked up next.

### Files

`src/worker.js`, `src/compat.js`, `src/autopilot.js`, `src/digDown.js`, `src/move-safety.js`,
`src/place-support.js`, `src/schema.js`, `src/app.js`, `src/chains/fallbackTasks.js`,
`src/chains/worldSurvivalChain.js`.

New tests: `tunnel-safety`, `stop-sources`, `packet-budget`, `cave-graze` (`.test.js`), plus
new cases in `stone-step` and `iron`. Fakes in `gather-blacklist`, `stone-step` and `iron`
gained the new worker methods. One fake `dig` in `stone-step` now really opens the cell,
because the step verifies it.

### Needs live verification

- **Soak, hard dig-down:**
  - No `suffocated in a wall`.
  - In gravel: `Tunnel stopped: gravel keeps falling into ...` only for bottomless stacks,
    and steps dug while gravel lands.
  - If a head ever ends up in a block: `WorldSurvival: head in <block> at ..., digging out`.
  - After a stop or cancel mid-tunnel: `Climbing out of the tunnel an interrupted gather left`
    at the next surface job.
- **Soak, Stop all:** expect no `Autopilot stopped (Stop all)` without an operator stop. After
  a hit to below 10 hp: `recovering: health N` (or a `[recover] {"type":"eat"}`), then the
  ladder carries on.
- **Packets:**
  - No `You are sending too many packets!`.
  - Watch the bot console for `PACKET_BUDGET`. Any line names the flooding packet, so report
    it.
  - Normal play should print none. 200/s is well above the about 80/s baseline.
- **Hard stone:** `craft stone_pickaxe` within seconds of the first 3 cobble, then
  sword/axe/shovel. Expect the furnace before the 32-cobble top-up finishes.
- **Food graze:**
  - Explores carry `surfaceFloor` (anchor - 6), and `Navigation left the surface` ends a leg
    that drops below it.
  - Under skeleton fire with no shield: `Explore: shot at by skeleton; taking cover at ...`.
- **Normal dig-down in snow:** no `needs a suitable tool ... snow_block`.
- **Iron:** with a long smelt at the bell, ingots should already be held. `Smelt ended early:
  took N iron_ingot ...` appears when the job is cut off.
- **Not changed:** the combat pillar and bow, the shelter, the bed prep, the soak harness.

## Cloud session round 5 (Claude, 2026-10-15, code only - `docs/CLOUD_TASK_5.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test-timeout=60000`: **343 passed, 0 failed** (304 at the start
of the round, plus 39 new). `tests/soak_metrics_check.py` (now with deaths) and
`tests/combat_damage_check.py` pass. One commit per task on `main` (`d96b59f`..`b4b71d2`).
All six tasks were done.

1. **Night survival in the dark forest** (`d96b59f`, new `src/night.js`).
   - Cause of `Pause trace: shelter -> Reflex: preempted by Mob Defense`: the survival gate
     took the *first* running/queued job in the array. A gather that Mob Defense had paused
     was resumed by the cadence bridge (queued, earlier in the array than the night
     shelter), so the pump ran it first and the gate let Mob Defense preempt both.
     - The gate now asks `worker.survivalHold()`: the running job when it is one, else (nothing
       running) a queued or reflex-paused sleep/eat/shelter anywhere in the queue.
     - The pump runs a queued survival job before any other queued job.
     - World threats (lava, fire, a wall, powder snow, drowning) still pass the gate.
   - **Sunset start.** The night job goes out at `SUNSET` 12000, about 50 s before the first
     spawns (a bed still waits for 12541). Dusk dirt runs 10000..12000 and bed prep stops at
     sunset. The shelter job itself starts at 12000.
   - **Sealed box.** `shelterShell` is the feet ring, the head ring, the full 3x3 roof and the
     floor under the feet when it is open (26 cells).
     - Placement runs in passes, so a cell anchors on one placed earlier.
     - On a pillar top or a ledge, a support ring goes under the feet ring first.
     - A mob standing in a cell is hit, never built into. A cell that still cannot close fails
       the job with its position (`Could not seal the shelter: N open cells, first at x,y,z`).
     - The night job is retried up to 3 times while it is dark. After that there is no day work
       until morning (`night: no shelter; holding for morning`), and a failing night job never
       turns into a ladder "blocked" explore.
   - **Staying in.** Once sealed (`worker.shelterSealed`), Mob Defense is off. The job's guard
     loop (every 250 ms) only hits a mob inside the box or standing at an open cell within
     reach, then re-seals the gap. The Food chain may eat inside a sealed box (side effect
     only; its collect band stays off). A shelter resumed somewhere else (after a water or fire
     escape) builds a new box there.
   - **FoodChain never ate.** It passed `{name,fills}` to `bot.equip`, which moves `item.slot`.
     It now equips the real stack. This is likely why eaten/food points read 0 on every soak
     run, and why hard3 sat in its shelter at 8.3 hp.
   - **Caught outside after dark** (no shelter job), with a crowd (3+ hostiles within 16, or one
     within 8 that the fight policy refuses), 3+ blocks held and room for a 3-high column:
     `NightPillarTask` (Mob Defense, 72).
     - Climb as in the combat pillar, then hold until morning or 15 s with nothing within 16.
     - Shield toward archers. Hit only what reaches the top.
     - A perched bot stays up even when a creeper fuses at the base. A failed climb waits 10 s.
   - **Flee heading.** RunAway tasks steer away from the whole crowd, weighted by closeness,
     not just the nearest mob. They never head into water, lava, a drop deeper than 3 or
     through another mob within 8; with every heading wet they stand. When tonight's shelter
     spot is within 24, headings toward it get a small bonus.
   - **Respawn at night** (death within the last minute, alive again, autopilot on, no user
     Stop): shelter (or sleep, at a bed spawn) at the spawn point first.
     `submit(spec,{keepHolds:true})` keeps the death hold, so the ladder still reads
     `paused: died` afterwards.
   - `tests/night.test.js` (22).
2. **Drowned** (`2fd5e2b`).
   - The drowning jump was only a side effect inside the world chain's priority, and Mob
     Defense's blind forward sprint kept steering the submerged bot.
     - Drowning is now a band at 97 (the creeper fuse is 96, lava/fire 100), latched from air
       6 or less until air 18 or the head is out. It runs `ctx.move` GetOutOfWaterTask (path to
       land plus jump), or `SwimUpTask` without it.
   - A swimming bot's flee heading goes to the shore (water costs per cell instead of ruling a
     heading out). `KeepDistanceTask` and the fight job's `retreatSprint` use the same heading.
   - The pathfinder gets a deep-water step hook (water with water above or below): banned after
     dark, cost 12 by day, off while the bot itself is in the water.
   - `tests/drowning.test.js` (5) and the updated chains drowning test.
3. **Soak death counter** (`389c496`).
   - Causes of 1 counted where the log had 4:
     - the `Bot died at` count read a 100-event window that the flee storm scrolls in one sample;
     - the log regex `was|blew up|fell|died` missed `drowned`;
     - the per-death parse moved `logmark`, so the final parse saw only the tail;
     - the final log parse shared a `try` with the dashboard read, which timed out on hard3.
   - The worker keeps `deaths` (monotonic) and `deathLog` (position, nearby killer, running job)
     in `/api/state`.
   - `soak.py` takes the max of three sources: that counter's rise, the run's whole log slice
     (fixed start, every vanilla death message, chat/leave/kick lines excluded) and the window.
     It does this at every sample and once more, dashboard-free, at the end. The run record
     adds `death_sources` and `death_log`.
4. **Hard runs never craft a furnace** (`2d8d031`).
   - Cause: on a dawn start the hard stone pickaxe lands at sunset (541 s / 631 s; sunset is
     600 s). The night branch cancelled the stone gather and the shelter held the rest of the
     run, so hard2 slept on 24 cobble with 14 needed.
     - The shelter also preferred cobble, and its dawn cleanup dug bare-handed, so cobble
       dropped nothing (and took about 7 s a block).
   - Fixes:
     - The stone gather asks for the remaining kit cost + 4 (21 from zero), not 32.
     - In a 600-tick sunset grace with no hostile within 16, any stone-kit craft affordable
       right now (`duskKitJob`) runs before the shelter. A running craft is never cut by the
       night branch.
     - `worker.cobbleReserve` (published by the autopilot) keeps the kit's cobble out of the
       shelter: dirt first, reserved cobble only as a last resort. The shelter counts every
       block kind together (26), and dusk dirt counts only spare cobble.
     - The cleanup equips the right tool per block.
   - `tests/hard-kit.test.js` (7). Two gather-count expectations changed (32 to 21, 27 to 7).
5. **Connection timeout** (`a2bd234`, new `src/loop-watch.js`).
   - Nothing in the repo blocks for the ~30 s a keep-alive timeout needs (keep-alives are exempt
     from the packet budget).
   - The new drowning path would have added a real hot loop: `GetOutOfWaterTask` rescanned for
     land (~17k `blockAt` at radius 24) on every 50 ms tick when no shore was reachable. It now
     searches at most once a second, radius 16.
   - Watchdog:
     - `LOOP_SLOW <runner|cadence|autopilot> tick N ms (...)` over 500 ms. The runner line adds
       each chain's priority time and the active chain/task.
     - `LOOP_STALL event loop N ms late` from a 250 ms lag timer.
     - Both go to the console and the event log, one line per 5 s per source.
   - `tests/loop-watch.test.js` (4).
6. **Lane creeper** (`b4b71d2`, `tests/combat_integration.py`).
   - Cause: the bot (1496,1518) and the creeper (1504,1504) were 16.1 apart, past the fight's
     16-block range, and the line crossed the wall beside the gate. The job completed at ttk 0
     and the creeper never saw the bot.
   - Now both are on the lane's centre line, 10 apart (bot 1499,-60,1518, creeper
     1499,-60,1508), and the open lane between them is asserted. Crater checks are on the
     lane's glowstone floor. `4b_creeper_roofed` is unchanged.

### Files

`src/night.js` (new), `src/loop-watch.js` (new), `src/worker.js`, `src/autopilot.js`,
`src/chains/{mobDefenseChain,worldSurvivalChain,fallbackTasks,foodChain}.js`,
`src/tasks/runner.js`, `src/tasks/movement/get-out-of-water-task.js`; `tests/soak.py`,
`tests/soak_metrics_check.py`, `tests/combat_integration.py`. New tests: `night`, `drowning`,
`deaths`, `hard-kit`, `loop-watch` (`.test.js`); updated cases in `chains`, `autopilot`,
`stone-step`.

### Needs live verification

- **Soak, hard nights (dark forest):**
  - The night job at about 600 s: `Autopilot [night] {"type":"shelter"}` at tod 12000, then
    `Shelter: sealed at x,y,z (N blocks placed)` before the first spawns.
  - There should be no `Pause trace: shelter -> Reflex: preempted by Mob Defense` and no
    `Reflex: fleeing` while sealed. `Shelter: hitting <mob> at a gap` and `re-sealing` only
    after a blast.
  - No `shot by Skeleton` during `shelter`.
- **Food inside the shelter:** the meals counter should rise (`eaten` > 0 in the soak record)
  now that FoodChain's equip works. Watch that chain eating does not disturb fights or crafts.
- **Hard kit:** `Autopilot: sunset - finishing the stone kit first (stone_sword)` and the
  rest, then the furnace before the shelter. At dawn the cleanup should return the cobble (a
  pickaxe equip per block).
- **Respawn at night:** `Autopilot: respawned at night; shelter at the spawn point first`,
  while the state still reads `paused: died` until the operator resumes.
- **Caught outside:** `Reflex: night crowd (N hostiles); pillaring up instead of fleeing`,
  `Night: perched 3 up; holding until morning`. On a failed climb: `Night: pillar-up failed`.
- **Water:** `WorldSurvival: drowning (air N), swimming up`. No `drowned` in the server log.
  Flee lines should not end in a lake.
- **Deaths:** the soak run line should match the server log. Check `death_sources`
  (counter/log/window) in the results JSON.
- **Loop:** grep the bot console for `LOOP_SLOW` / `LOOP_STALL` and report any line. Normal play
  should print none.
- **Combat `4_creeper`:** expect real engagement now (`arrow creeper`, pillar 2 under the lane
  roof, or the wall) and non-zero ttk. The numbers are new and not comparable with earlier
  lane runs.
- **Not changed:** the combat pillar and bow, the bed prep (it now ends at sunset), the iron
  step.

## Cloud session round 6 (Claude, 2026-10-15, code only - `docs/CLOUD_TASK_6.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test-timeout=60000`: **366 passed, 0 failed** (343 at the start
of the round, plus 23 new). `tests/soak_metrics_check.py` (now with the food bar) and
`tests/combat_damage_check.py` pass. One commit per task on `main` (`2efbce0`..`8295fbc`).
All seven tasks were done. The repo has no round-5 logs or results JSON (`data/soak-results.json`
is still the old 10-13 one), so tasks 2 and 3 were diagnosed from code, archived soaks and the
TEST_REPORTS text. Each adds a log line or metric that will confirm it on the next live run.

1. **Shelter cancelled before sealing** (`2efbce0`, new `tests/shelter-seal.test.js`).
   - What cancelled it: the soak bell. The end-of-run cancel (`soak.py`, about 600 s after the
     sunset start) is the `Current job cancelled` at 01:18Z and 01:39Z. The job itself had been
     running for 11 minutes without sealing.
   - Why it never sealed: it demanded 26 spare blocks wherever it stood. hard1 held 19 cobble,
     14 of it reserved for the kit, so it had 5. The dirt loop then re-found the same nearest dirt
     block with no blacklist and no deadline: a failed walk (20 s), `canDigBlock` false or water
     above all looped back to the same block. In the dark forest or a dig-down tunnel that block
     can be unreachable all night.
   - Fixes:
     - The need is the open shell cells where the bot stands (`shelterNeed`), plus supports. A
       stone tunnel needs 2-3, flat ground 25.
     - The dirt dig tries every spot once, for at most `SHELTER_DIG_MS` (45 s). The seal has
       `SHELTER_SEAL_MS` (30 s). Reserved kit cobble is still spent only as the last resort.
     - Short of blocks, or a seal that cannot finish, fails the job with the reason
       (`Short of shelter blocks: 5 held, 25 needed at (x, y, z); night pillar instead`). It
       also sets `worker.nightPillar`.
     - Mob Defense then climbs a **holding** `NightPillarTask` (forced `nightRefuge`, 3+ blocks,
       no crowd needed). It stays up until morning and does not come down after 15 quiet
       seconds. Log: `Reflex: no shelter tonight; night pillar until morning`.
     - The ladder does not resend the shelter that night: a queued retry would gate the pillar
       off and dig the same ground. It holds for morning instead.
     - A Stop or cancel mid-seal is not a failure and sets no pillar.
2. **Food never eaten** (`0bb17a7`).
   - FoodChain (AltoClef defaults) eats at food <= 10, at 11..14 only when the best food fills
     the bar exactly (cooked beef at 12), and below 14 health. AGENTS.md's "auto-eat at food <=
     14" describes the retired reflex loop, not this chain.
   - Evidence it is a full bar, not a broken path: the archived 20-min runs in `data/` bottom out
     at 14-18. The two exceptions are hard3 runs (10 and 5), and the hard runs held no food. The
     round-5 eat path itself was fixed in round 5 (the real stack is equipped).
   - Now measurable:
     - FoodChain counts `meals.due` (each episode a meal was wanted with food held) and
       `meals.failed` / `lastError`.
     - `soak.py` samples saturation, records `food_level` (min/max) per run and diffs due/failed.
     - It prints `bar MIN..MAX: <verdict>`, where the verdict is `ate`, `never hungry (food min
       N)`, `no food held` or `EAT FAILED (due D, failed F, reason)`. The summary has
       `food_min/max/due/failed/verdict`.
3. **Iron pickaxe disappeared** (`7f80f5e`, new `src/toolWear.js`, `tests/tool-wear.test.js`).
   - Most likely it broke. mineflayer-tool and the pathfinder both equip the *fastest* tool.
     After 752 s every staircase cell to the iron band (~90 steps x 3 cells from the surface per
     gather) and every stone cell of the 16-coal and 30-ore gathers wore the iron pickaxe, which
     has 250 uses.
   - Why the 30 raw iron stayed raw: the ladder smelts only after the whole 30-ore gather. With
     the pickaxe gone it first rebuilds the stone kit and then smelts for the iron pickaxe, so
     the bell came first.
   - Fix: `conserveTool` digs with a stone tool of the block's kind whenever it can harvest the
     block and an iron, diamond or netherite one is held. It takes the most worn first and never
     the wooden pickaxe (the wood step needs it). It is hooked into `equipForBlock` and
     `pathfinder.bestHarvestTool`. A broken stone pickaxe costs 3 cobble, and the stone step
     re-crafts it.
   - Diagnostics: `Tool left the inventory: <tool> (N uses left[, broke])` on any tool loss while
     alive. A break now reads differently from a toss or a deposit.
   - Not changed: `save()` trims an active job's in-memory `job.tunnel` to its last 20 points, so
     a deep iron staircase only climbs its bottom 20 steps.
4. **Hard1 never crafted a furnace** (`95118af`, cases in `tests/hard-kit.test.js`).
   - Cause 1: the bed-prep sheep hunt was running at sunset. The active-job branch sent the
     shelter at once, and the sunset grace was only checked when idle.
   - Cause 2: `duskKitJob` stopped at the next piece in kit order. With no stick for the sword it
     returned null, so the furnace (no sticks needed) was never reached.
   - Fixes:
     - `duskKitJob` crafts sticks from held planks (or planks from held logs). With no wood it
       falls through to the furnace.
     - The active branch cuts a running day job for the grace kit.
     - A queued kit craft holds the shelter back; otherwise the survival pump runs the shelter
       first.
     - In the dusk window (9000..12000) an affordable kit craft outranks the bed prep (`dusk -
       finishing the stone kit first`).
     - A hostile within 8 (was 16) holds a craft. Two failed stone crafts stop the dusk retries.
5. **Lane creeper** (`dddce10`, cases in `tests/combat.test.js`).
   - Why `pillar-hold` never moved on: under the lane roof the column is 2 high. 2 up, the base
     is still inside the 3-block fuse ring (flat sqrt(9-4) = 2.24). The creeper walked to the
     base and fused, and the perch's fusing branch only raised the shield and cancelled the
     draw. The blast beside the column cratered the midpoint. In 4b the bow killed the creeper
     before it arrived.
   - Fix: on a perch under 3 high, the melee weapon goes in hand once the creeper is within 1.6
     of the ring (hysteresis +1.5 back to the bow). The bot swings as soon as the creeper is
     within `knockReach` 3.4 eye-to-box, so the knockback keeps it out before the fuse starts.
     Log: `Combat: perch 2 up is inside the fuse ring; knocking the creeper back`. A fuse that
     starts anyway still holds the shield. A 3-high perch is unchanged.
   - `knockReach` relies on the 1.20.5+ server check (interaction range 3 + 3 buffer). If
     hits beyond 3 are rejected on this ViaVersion path, the window shrinks to about 2.24..2.6
     flat.
6. **Integration reflex pause** (`d11945b`, `tests/integration.py`).
   - Likely cause: at the origin the autopilot fixture's logs (1..6,-60,2..7) may still stand
     2-7 blocks away, so the gather could finish on one of them. The creeper was also summoned
     at the start column, after four setup commands.
   - Now the fixture runs on a clean strip:
     - It runs at z=-40, with every oak log in the search radius cleared, and the setup runs
       before the job.
     - The log is 28 blocks out.
     - The NoAI creeper is summoned 4 blocks *ahead* of the bot's live position once the gather
       is running and the bot is walking.
     - A gather that ends first fails with its status.
   - Pause, resume and completion checks are unchanged.
7. **Tunnel climb failures** (`8295fbc`, case in `tests/tunnel-safety.test.js`).
   - Cause: `climbTunnel` walks each step with digging off, so one refilled step (gravel,
     sand, a placed block) aborted the whole climb.
   - Fix: a failed step is retried with the explore movements (natural blocks only, dirt/cobble
     scaffold). One that still fails is skipped, and only the top step must be reached. Log:
     `Tunnel climb: step x,y,z failed (...); digging through natural fill`.

### Files

`src/worker.js`, `src/autopilot.js`, `src/night.js`, `src/combat.js`, `src/toolWear.js` (new),
`src/chains/{mobDefenseChain,fallbackTasks,foodChain}.js`; `tests/soak.py`,
`tests/soak_metrics_check.py`, `tests/integration.py`. New tests: `shelter-seal`, `tool-wear`
(`.test.js`); new cases in `meals`, `hard-kit` (one expectation changed: 3 cobble + 1 stick
with planks held now crafts sticks instead of nothing), `combat`, `tunnel-safety`.

### Needs live verification

- **Hard nights:** either `Shelter: sealed at ... (N blocks placed)` within seconds of
  `[night] shelter`, or `Shelter: Short of shelter blocks ...; night pillar instead`, then
  `Reflex: no shelter tonight; night pillar until morning` and `Night: perched 3 up`. Check that
  there is no 11-minute `working: shelter` and that a pillared bot survives the archers.
- **Food:** the run line's `bar MIN..MAX: verdict`. `never hungry` on the normal runs confirms
  the diagnosis. Report any `EAT FAILED` with its reason.
- **Iron:** `Tool left the inventory:` lines (expect stone pickaxes breaking, not the iron one).
  The iron pickaxe should still be held at the bell, and expect more ingots than raw iron. A
  stone staircase is slower: about 0.56 s per stone cell instead of 0.38.
- **Hard kit:** `sunset - finishing the stone kit first (furnace)` or `dusk - ...`. A hard run
  with 8+ cobble should end with a furnace.
- **Combat `4_creeper`:** `knocking the creeper back`, then hits and a kill, with no crater at
  the lane midpoint.
- **Integration:** `Reflex paused the gather: Reflex: ...` at the new fixture.
- **Climbs:** `Tunnel climb: step ...` lines instead of `Could not climb back up the tunnel`.

## Cloud session round 7 (Claude, 2026-10-15, code only - `docs/CLOUD_TASK_7.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test-timeout=60000`: **392 passed, 0 failed** (366 at the start
of the round, plus 26 new). `tests/soak_metrics_check.py` passes. One commit per task on
`main` (`299de2e`..`a7bdae2`, plus the follow-up `34c553a`). All five tasks were done. The
repo still has no round-6 logs or results JSON, so every diagnosis below comes from code, the
TEST_REPORTS text and `tests/soak.py`. Each fix adds a log line that will confirm it live.

1. **Eating** (`299de2e`, new `src/eating.js`, `tests/eating.test.js`).
   - Why it timed out: mineflayer's `consume()` resolves only on entity_status 9, a held-item
     change or a cooldown, all within 2.5 s (`CONSUME_TIMEOUT`). On the ViaBackwards
     26.x -> 1.21.4 path status 9 can come late or never. FoodChain also never set
     `worker.eating`, so any hand equip from another chain mid-meal could end the meal
     server-side: a gather's `equipForBlock`, the pathfinder's dig tool, the forcefield's
     sword.
   - Fix: `eatMeal` judges a meal by its result: the food bar rising or the stack shrinking
     within 1.5 s after consume returns or throws. A meal that shows neither is released
     (`deactivateItem`) and retried once after selecting another hotbar slot, so the server
     sees a fresh held-item change.
   - `guardEquip`: while a meal is in flight, other hand equips wait for it (4.5 s at most).
     Off-hand equips don't wait.
   - All four eat paths use it: the eat job, the reflex auto-eat, FoodChain and the fight's
     disengage-eat. FoodChain sets `worker.eating` and waits 5 s after a failed meal.
   - Verdict: FoodChain counts `meals.noFood`, the hungry episodes (food <= 10) with nothing
     to eat. The soak records `food_min_held`, the lowest bar while food was held.
     `food_verdict` reads `no food held` for normal2's case (due 1, failed 0, nothing held at
     the low). Any failed meal reads `EAT FAILED` with its reason, never `never hungry`. With
     food eaten and a failure, it reads `ate (N failed: reason)`. The summary adds
     `food_no_food`.
2. **Shelter seal and spider-proof pillar** (`b1c4e4a`, cases in `shelter-seal`, `night`).
   - `2 open cells, first at 158,154,-8` is a feet/head pair on one side. A bot standing off
     its cell centre overlaps that neighbour column, and the server refuses placements inside
     the player.
   - Fixes:
     - The seal sneaks back to the cell centre (`centreInCell`) before it starts and before
       any cell that `hitsBot`.
     - It digs non-replaceable natural plants out of a cell first (`SHELTER_NOTCH`:
       mushrooms, flowers, saplings...). The dark-forest floor is full of them.
     - A failed seal now logs every open cell with its block and the bot's exact x/z
       (`Shelter: open cells ...`).
   - Night pillar: once perched, the bot lays an 8-block overhang ring around the column top
     (4 sides against the top, then 4 corners). Spiders climbing any face hit the ring's
     underside. Log: `Night: overhang ring N/8 around the pillar top`.
     - The bot stands on a 3x3 deck and holds sneak. Pushed onto the ring, it walks back to
       the middle. It is only "knocked off" when it leaves the deck or drops below it.
     - It still hits anything that reaches the top, and cells that refuse 3 clicks are
       skipped.
     - A holding pillar that is knocked off re-climbs after 3 s (was 10).
     - 11 blocks for column plus ring. Fewer still pillars, with a partial ring.
3. **Leaving the shelter at night** (`842d00d`, cases in `shelter-seal`, `night`).
   - Cause: hard runs start at `time set 0`, so sunset is at ~600 s and the clock wraps to 0
     at ~1200 s. The shelter loop held only while tod >= 12000, so it opened the box at the
     wrap. The ladder then sent a gather at dawn, with the night's mobs still up and never
     burning under the dark-oak canopy. That fits hard3's sealed 08:45Z / shot 08:56Z, 3
     blocks from the box.
   - Fix: `night.js leaveRefuge`. The sealed shelter and a perched pillar are left only from
     tod 1000 (`MORNING_SAFE`) with no hostile within 16. From tod 3000 (`MORNING_LATE`), only
     a hostile within 6 keeps the refuge.
     - The shelter always opens 60 s before its own 13-minute deadline. A timed-out job would
       leave the box up.
     - A shelter resumed at dawn with its box standing re-seals and holds it.
     - Logs: `Shelter: dawn (tod N); staying sealed ...` and `Shelter: morning (tod N,
       nearest hostile D); opening up`.
4. **Hard stone kit at dusk** (`5b08a5d`, cases in `hard-kit`, `autopilot`).
   - Stone step cause: it demanded 10 sticks before any cobble. After the wood kit the bot
     holds 0 planks and 0 logs, so this meant a log hunt first, then a 21-cobble gather
     before the first craft.
   - hard3's wood at 542 s: `soak.py` keeps one world for all three runs of a difficulty, so
     hard3 starts in a forest hard1 and hard2 already cut down. That is a harness fairness
     issue, not a bot bug. A per-run world (or per-run anchors) would fix it.
   - Stone step fix: it mines the pickaxe's 3 cobble first and makes sticks only for a piece
     whose cobble is held. The stone pickaxe then digs the rest (kit + 4 spare).
   - Dusk: `duskCobbleJob` gathers the next kit piece's cobble ahead of the shelter dirt.
     - It runs from tod 9000 until a minute before sunset, after the bed prep, up to 3 a day.
       A failed one hands the dusk to the dirt.
     - The cobble also counts as shelter material.
     - The dusk kit craft then fires before sunset. Log: `Autopilot: dusk - cobble for the
       stone kit first (N)`, then `dusk - finishing the stone kit first (...)`.
5. **Iron** (`a7bdae2` + `34c553a`, new `tests/iron-band.test.js`, cases in `autopilot`).
   - Band: iron gathers are `{targetY:16, bandTop:64, smeltAt:3}`, in batches of 6.
     `descentTarget` stops the first staircase at 64 (or 32 below the bot), then goes down in
     32-block legs and never below 16. Ore below 16 is not a target. Exposed ore beats
     buried ore up to 8 blocks further away (`BURIED_ORE_PENALTY`). Coal gathers also enter
     from the top.
   - Kiln (`worker.kilnTick`): once 3 raw iron is held, the gather places the held furnace in
     its tunnel (`placeBlockNear` already avoids the climb cells), loads it and keeps mining.
     - When the batch is due and the bot is within 16, it takes the output and reloads with
       fresh fuel.
     - At the end, including a failed gather, it waits for the last batch (45 s at most),
       takes back what is left and picks the furnace up.
     - Raw ore in the kiln still counts as gathered (`job.kilnIn`).
     - No furnace, no fuel or no spot turns the kiln off for the job. The ladder's smelt job
       still runs.
     - Logs: `Gather: kiln at x,y,z; smelting raw_iron while mining`, `Gather: kiln loaded
       with N raw_iron (M ingots taken so far)`.
   - Ladder: each core piece is crafted as soon as its own ingots are held (iron pickaxe at
     3). 3+ raw iron is smelted before any further dig. The rest phase also digs in batches
     of 6.
   - A spare stone pickaxe (`STONE_PICKS` 2) is crafted from staircase cobble before each
     iron dig, so a break no longer falls back to the iron pickaxe.

### Files

`src/eating.js` (new), `src/worker.js`, `src/autopilot.js`, `src/night.js`, `src/reflexes.js`,
`src/schema.js` (gather `bandTop`, `smeltAt`), `src/chains/{foodChain,fightTask,fallbackTasks,mobDefenseChain}.js`;
`tests/soak.py`, `tests/soak_metrics_check.py`; `AGENTS.md` (the two gather options). New
tests: `eating`, `iron-band` (`.test.js`); new cases in `shelter-seal`, `night`, `hard-kit`.

Changed expectations:
- `autopilot` M5 test: spare pickaxe first, 6-ore batches in the band, smelt at 3, pickaxe
  at 3 ingots. The stone gather with no stone pickaxe is 3, then 18.
- `night`: the archer-shield test ticks through the ring first. Tod 500 no longer ends the
  perch.
- `shelter-seal`: "morning" in the helpers is tod 1500, not 100.

### Needs live verification

- **Food:** `bar MIN..MAX: ate` on runs that got hungry with food held. Any `EAT FAILED` now
  carries the result-based reason (`the food bar did not rise (2 tries)` or `Promise timed
  out. (2 tries)`). If it still fails, check whether ViaBackwards delivers the food/health
  update at all.
- **Shelter:** `Shelter: sealed` on hard nights with no `Could not seal`. If it still fails,
  read the new `Shelter: open cells ...` line.
- **Pillar:** `Night: overhang ring 8/8`, and no `knocked off the pillar` followed by a spider
  death.
- **Dawn:** `Shelter: dawn ... staying sealed`, then `Shelter: morning ... opening up` at tod
  1000+. No death between the wrap and tod 1000.
- **Hard kit:** `dusk - cobble for the stone kit first`, then `dusk - finishing the stone
  kit first`. hard1 and hard3 should hold a stone pickaxe, and ideally a furnace, at
  sunset.
- **Iron:** `Gather: kiln ...` lines during iron gathers, the staircase stopping at y=64
  first, and no position below y=16. Expect more ingots than raw iron at the bell, the iron
  pickaxe held, and `Tool left the inventory: stone_pickaxe ... broke` followed by a re-craft.
  The kiln's furnace pick-up after each gather is new live behaviour: check the furnace is
  back in the inventory, or the `Left the furnace at ...` line.

## Cloud session round 8 (Claude, 2026-10-15, code only - `docs/CLOUD_TASK_8.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test-timeout=60000`: **414 passed, 0 failed** (392 at the start
of the round, plus 22 new). `tests/soak_metrics_check.py` passes. One commit per task on
`main` (`b25a867`, `2502082`, `c554ab6`, `78aeb66`, `3119fee`). All five tasks were done. The
diagnoses come from the code, the round-7 TEST_REPORTS text and mineflayer 4.39's sources.

1. **The bot never ate** (`b25a867`, cases in `eating`, `meals`).
   - Why: there were two causes.
     - FoodChain is the only eater (the 250 ms reflex auto-eat is retired). It ate only at
       a bar of 10 or less (AltoClef). At 11-14 it ate only on a perfect fit or below 14
       health, so the bar sat at 14-16 all run.
     - When a meal did start, nothing bounded it. mineflayer's `clickWindow` on an open
       crafting window waits for `updateSlot:0` with no timeout. An equip during a craft
       could hang `eatMeal`, and FoodChain's `_eating` then stayed true for the session:
       every later meal was a silent no-op (`due 1, failed 0`, no reason).
   - Fixes:
     - `eatAtHunger: 14`: with food held, the bot eats at a bar of 14 or less.
     - A 12 s watchdog per meal. `eatMeal` bounds its equip at 4 s and waits up to 2 s for
       an open window to close.
     - Meals defer, with the reason recorded once per episode, while a window is open,
       Mob Defense is active (a fresh cache only, `isActive()`), a fight job runs, the eat
       job eats, or the bot is in bed. A critical meal (`needsToEatCritical`) still goes
       through a fight.
     - Worker gate: the Food chain's eat side effect now runs under every survival hold.
       The one exception is a shelter still placing its walls. Before, a *queued* shelter or
       sleep job switched eating off for the whole job ahead of it.
   - Counters and logs: `meals.attempts`, `deferred` and `lastDeferred` are new. Logs:
     `Food: ate <item> (bar N)` and `Food: meal failed - <reason>`.
   - Soak verdicts: `ate N`, `not hungry enough (food min N)`, `no food held`,
     `attempted and failed: <reason> (...)`, or `EAT FAILED: never attempted (last deferred:
     <reason>) (...)`. `FOOD_EAT_AT` is 14. The summary adds `food_attempts` and
     `food_deferred`.
2. **Creeper death while crafting** (`2502082`, new `tests/craft-interrupt.test.js`).
   - Mob Defense already preempted a running craft: the runner's `worker.stop` paused it, and
     the table walk's `navigate` throws on the epoch.
   - Three holes remained:
     - `craftConfirmed` awaited `windowOpen` and every click and sync with no `check()` and
       no timeout. They now go through `interruptible`: it polls `check()` every 100 ms and
       gives up after 5 s. The finally still closes the window.
     - The crafting window stayed open while the survival tree acted, so its equips (pillar
       blocks, sword) clicked the table's slots. The runner now closes any open window when a
       non-user tree holds control. Log: `Runner: closed the open crafting window for Mob
       Defense`.
     - The gate silenced Mob Defense entirely while an eat, sleep or shelter job ran (or one
       was queued with nothing running). A creeper within 6, or fusing within 10
       (`creeperThreat`), now overrides that hold. Only a sealed shelter or a bot already in
       bed keeps it. Log: `Reflex: creeper at D overrides the X hold`.
3. **Iron armour, torches, bed** (`c554ab6`, new `tests/iron-rung.test.js`, M5 test rewritten).
   - The old order put torches last and the bed behind a bow and 32 arrows, so neither was
     reached. After the iron core (pickaxe, sword, shield), `ironRung` now runs:
     1. A worn weapon's replacement, if one is needed.
     2. Coal for 16 torches. With coal in reach (`coalNear`, a block scan within 32) it is a
        plain gather that prefers exposed seams, with no staircase. Otherwise it uses the
        band staircase.
     3. Sticks, then 16 torches.
     4. 13 ingots for the iron helmet and chestplate: spare stone pickaxe, band dig in
        batches of 6, smelt from 3. Legs and boots are crafted while their ingots are held.
     5. An `equip` job whenever a held piece beats its slot. It goes out once per new set of
        pieces (`lastEquip`), so it cannot loop.
     6. A bed when wool is cheap (`bedJob`, shared with the dusk bed prep). These jobs run
        as `bed-rung`: a failure sets the bed aside for 10 min and never charges the iron
        step.
   - `counts()` now includes worn armour (slots 5-8) and the off hand (45) as
     `_equipped_<name>`. Before, an equipped chestplate or an off-hand shield read as missing
     and was crafted again.
   - Night: a bed held or near still means sleep. A sleep that failed tonight
     (`sleepFailedTonight`) falls back to the shelter instead of retrying the refused sleep.
   - The iron step's `done` now needs 16 torches, not 8 (the IRON test fixture changed with
     it).
4. **Toward diamonds** (`78aeb66`, cases in `iron-rung`).
   - After the bed, `diamondPickJob` sends `{gather diamond_ore x(3-held), targetY -58,
     bandTop -54, strip}`. It needs the iron pickaxe and 8+ torches. Sticks come first,
     then the diamond pickaxe at 3 diamonds.
   - The existing staircase does the safety work: lava/water checks, no straight-down digs,
     bedrock refused, a torch every 6 steps. It takes one leg to -54, then -58. No ore below
     -58 is a target. The strip mine at -58 places a torch every 8. `conserveTool` never
     picks stone for diamond ore.
   - It runs as `diamond-rung`: a failed trip waits 20 min and the rest of the iron step goes
     on. The later `diamonds` step uses the same gather. AGENTS.md's ladder summary follows
     the new order.
5. **Soak reporting** (`3119fee`).
   - `state()` gains `equipment` (worn armour and the off hand). `inventory_counts` sums
     stacks: the old dict kept only the last stack of an item.
   - Samples add `armour`, `armour_worn`, `torches`, `bed`, `diamonds` and `diamond_pick`.
   - Runs report `armour_peak`, `armour_worn_peak`/`_at`, `torch_peak`, `bed_at`,
     `diamond_peak` and `diamond_pick_at`. The summary adds the same lists and
     `armour_runs` (2+ pieces worn).

### Files

`src/chains/{foodChain,mobDefenseChain,settings}.js`, `src/eating.js`, `src/crafting.js`,
`src/tasks/runner.js`, `src/worker.js`, `src/autopilot.js`; `tests/soak.py`,
`tests/soak_metrics_check.py`; `AGENTS.md` (ladder line). New tests: `craft-interrupt`,
`iron-rung` (`.test.js`); new cases in `eating`, `meals`, `autopilot`.

Changed expectations:
- `meals`: at 15 nothing is due, at 14 a meal is due (was 13 and 12).
- `soak_metrics_check`: the verdict wordings above.
- `autopilot` M5: torches and core armour come before the coal-16 and rest digs. The diamond
  trip comes after the bed. The legs and boots ride along when affordable. `IRON` holds 16
  torches. The diamonds-step gather carries `bandTop -54` and no `searchIfMissing`.

### Needs live verification

- **Food:** `Food: ate cooked_... (bar 14)` lines and `bar 14..20: ate N` on the normal runs.
  If it still reads `EAT FAILED: never attempted`, the `last deferred` reason names the
  blocker. A `meal stuck 12 s` reason means the equip or consume still never settled. Then
  check what the hand was doing (a window open, or a `Runner: closed the open ... window`
  line just before).
- **Creeper vs craft:** on a creeper approach during a craft, expect `Runner: closed the
  open crafting window for Mob Defense` and `Reflex: preempted by Mob Defense`. No
  `blown up by Creeper` with a craft running. `Crafting click on slot N timed out` lines
  would mean the 5 s cap is too tight on Via. It never was in the unit fakes.
- **Rung:** coal gathers without `targetY` when a seam is near. Expect `craft torch x16`,
  `craft iron_helmet`, `craft iron_chestplate`, then an `equip` job and `armour_worn 2` in
  the samples. A `bed-rung` hunt or shear appears when sheep are near. A failed sheep hunt
  must not show `iron failed N times`.
- **Night with a bed:** `Autopilot [night] {"type":"sleep"}`. After a refused sleep, a
  `shelter` the same night.
- **Diamonds:** only on long runs (20-min soaks rarely get past the armour).
  - `Digging a staircase down to y=-54`, then `-58`, then `Digging a strip mine`, with
    torches placed.
  - `Tunnel stopped: lava ...` ends the trip safely (`diamond-rung` waits 20 min).
  - The staircase from the surface to -54 runs ~120 blocks sideways. A climb back that long
    may hit `Navigation timed out`.

### Known gaps (not changed)

- The `home` step's `done` is always false, so the full `diamonds` step after it is never
  reached. Only the rung's diamond pickaxe is. Reordering is a ladder-design call.
- Iron `done` still needs a bow and 32 arrows (spider and chicken hunts), so the `bed` and
  `home` steps stay unreachable on most runs. The rung's bed covers the bed.

## Cloud session round 9 (Claude, 2026-10-15, code only - `docs/CLOUD_TASK_9.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test-timeout=60000`: **429 passed, 0 failed** (414 at the start
of the round, plus 15 new). `tests/soak_metrics_check.py` passes. One commit per task on
`main` (`8759f34`, `d340ea4`, `1c52bfc`, `31bcf67`). All four tasks were done. There were no
dashboard logs in the sandbox, so the diagnoses come from the code, mineflayer 4.39's sources
and the round-8 TEST_REPORTS text.

1. **Eating at a full bar** (`8759f34`, cases in `meals`, `soak_metrics_check`).
   - The bot did not eat at a full bar. `Food: ate cooked_porkchop (bar 20)` printed the bar
     *after* the meal: a porkchop eaten at 14 reads 20.
   - Why the soak read `never attempted (due 2)` and **eaten 0 on every run since the counter
     existed**: mineflayer injects its plugins (`bot.consume`, `bot.equip`) on `inject_allowed`,
     a `setTimeout(0)` after `createBot` returns (`lib/loader.js:134`). `trackMeals` and
     `guardEquip` ran right after `createBot`. `bot.consume` was undefined, so the meal counter
     was never wired and **`guardEquip` was never installed live**. The unit fakes had both
     methods up front, so the tests passed.
   - The verdict then said `never attempted` whenever the sampled bar stayed above 14, even
     with `attempts > 0`. The 30 s samples miss a dip to 14 that a meal fixes at once.
   - Fixes:
     - `afterInject` (`src/eating.js`): `trackMeals` and `guardEquip` wrap after injection.
     - FoodChain keeps its own count of good meals, `meals.ok`. The log reads
       `Food: ate X (bar A -> B)`.
     - AltoClef's fill-up (`_requestFillup`) is gone. It kept eating to 20 after any meal, so
       a second porkchop went at 15-19.
     - Above 14 the bot eats only on low health (health < 14, the eat-to-full rule) or fire
       or wither, and never the last edible item. Critical health (< 6) still eats it.
   - Soak: `meals_delta` adds `ok`. The verdict uses `max(eaten, ok)`. With attempts and no
     recorded meal it reads `attempted N, no meal recorded (...)`, never `never attempted`.
2. **The food step cannot hold the ladder** (`d340ea4`, new `tests/food-step.test.js`).
   - The step is done at `FOOD_ENOUGH` (4) edible held. 4 held plus eaten since `start()`
     (`_eaten` in `counts()`, from `meals.eaten`/`ok`) also counts. Either way it reopens if
     the bar is 14 or less with nothing held. Raw meat with a furnace held is still cooked
     first.
   - `FOOD_LEGS` (6) graze legs without progress (a new high of held + eaten), or 3 food
     failures, set the step aside for `FOOD_OFF_MS` (8 min). Food failures no longer
     enter the `blocked:` explore loop. Log: `Autopilot: food step set aside for 8 min (...)`.
     After that, food comes back only when hungry with nothing held.
3. **hard2: no logs, and a pillar every 3 s** (`1c52bfc`, cases in `gather-blacklist`,
   `shelter-seal`).
   - Wood. Most likely cause, unconfirmed without the log: the three hard runs share one
     anchor in one world session, so hard2 starts among hard1's leftovers. Those are canopy
     logs out of reach and stubs it already refused. They are "in range", so `searchIfMissing`
     never fired. The gather failed in place with `Only the block under the bot...` or
     `Cannot gather safely`, and the ladder looped wood, blocked, a 48-block explore and the
     operator return.
     - Now these cases take a search leg (3 per job, as before): only refused columns in
       range, only logs above reach after two climbs, or the 8-column / 24-block refusal
       limit. Logs: `Gather: only refused logs within 32 (...); searching further afield` and
       `Gather: N columns / M blocks refused here; searching further afield`.
   - Pillar. A failed climb used to retry after a flat 3 s. Climbs that fail in a row now back
     off (`pillarBackoff`: 3, 6, 12, 24, 48, 60 s). Being knocked off a perch still
     re-climbs in 3 s.
     - The failure line now says what the climb saw, for example `timed out at 0/3; rose 0.00,
       0 clicks, holding dirt, on grass_block`. The code does not show why every climb got
       0/3; the next live run will name it.
   - Smaller pod. Short of blocks for the 3x3x3 box, the shelter seals a 1x1 pod instead of
     going to the pillar: `shelterShell(origin, true)`. It is 14 cells: the 4 feet faces, the
     full head ring, the roof and one roof anchor. The roof cell has no face to place against
     without the anchor. The feet diagonals stay open. Under a solid head ring no 2-high mob
     stands there, and a spider is too wide.
     - Log: `Shelter: N blocks held, M for the box; sealing a 1x1 pod (P)`. Short even for
       that: `Shelter: a 1x1 pod would need P here`, then the usual pillar fallback, with the
       message unchanged.
4. **Soak length** (`31bcf67`). `NORMAL_SECONDS=2400` (frozen day), `HARD_SECONDS=1250`.
   After `SUMMARY`, the soak prints `RUNGS`: one row per run with columns run, wood, stone
   pick, furnace, iron pick, torches, armour worn, bed, diamonds, diamond pick, food and
   deaths. Times are seconds from the run start, and `-` means never. A full soak is now
   about 3 h 20 min.

### Files

`src/eating.js`, `src/worker.js` (trackMeals, gather search legs, shelter pod),
`src/chains/foodChain.js`, `src/chains/mobDefenseChain.js` (pillarBackoff),
`src/chains/fallbackTasks.js` (pillar failure line), `src/night.js` (pod shell),
`src/autopilot.js` (foodDone, food deferral, `_eaten`); `tests/soak.py`,
`tests/soak_metrics_check.py`; `AGENTS.md` (shelter line). New tests: `food-step.test.js`;
new cases in `meals`, `gather-blacklist`, `shelter-seal`.

Changed expectations:
- `soak_metrics_check`: `meals_delta` carries `ok`, and `NORMAL_SECONDS` is 2400.
- Nothing else. The existing food-step cases hold 0 or 8 edible, which give the same step
  under the new rule.

### Needs live verification

- **Meals counted:** expect `Food: ate cooked_... (bar 14 -> 20)` lines and `eaten` > 0 in
  the soak. The verdict should read `ate N`. If `eaten` stays 0 while `ok` > 0, the consume
  wrap still misses: check `bot.consume.__tracked` live.
- **guardEquip is live for the first time.** A hand equip during a meal now waits up to
  4.5 s (`EAT_GUARD_MS`). Watch for slow pillar or sword equips right after a `Food: ate`
  line, and for creeper fights that start while the bot is eating.
- **No meal above 14 at full health:** no `Food: ate` line whose `bar A` is above 14 unless
  health was below 14.
- **Food step:** the ladder should reach `[iron]` with 4 food held or eaten. If it does
  not, expect `Autopilot: food step set aside` after 6 legs. No more `food failed 3 times;
  exploring before retry`.
- **Iron rung (the point of 2400 s):** iron pickaxe at 15-20 min, then `craft torch x16`,
  iron helmet and chestplate, `armour worn 2`, maybe a bed. All of it is in the `RUNGS`
  table.
- **hard2 wood:** `searching further afield` lines instead of a run without logs. If it still
  gets 0 logs, the gather log names the reason.
- **Pod:** on a short night, `sealing a 1x1 pod` and then `Shelter: sealed at ...
  (N blocks placed)`, with no damage taken inside. If zombies hit it through the feet
  diagonals, the pod needs the full feet ring (4 more blocks).
- **Pillar:** the new failure line says why a climb fails (rise, clicks, item, support).
  Retries should now be spaced 3, 6, 12 ... s apart.

## Cloud session round 10 (Claude, 2026-10-15, code only - `docs/CLOUD_TASK_10.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test --test-timeout=60000`: **500 passed, 0 failed** (429 at the
start of the round, plus 71 new). `tests/soak_metrics_check.py` passes. One commit per task on
`main`, 16 in all. Everything in the brief was done: the fix-first bugs A-D, efficiency 1-3,
and habits 4-12. The diagnoses come from the code and the round-9 TEST_REPORTS text. There were
no dashboard logs in the sandbox.

### Fix first

- **A. The diamond staircase dropped the bot** (`ea112fd`, new `tests/descent-safety.test.js`).
  - Cause: the ore staircase and the strip mine never looked under the next step. Only the
    natural stone dig-down checked its floor. A cave or ravine opening under a step dropped the
    bot (normal2 died at y=13; normal3 fell 18.4 -> 3.5 hp).
  - Second cause: `descendToReach`'s drop guard read `!x?.boundingBox==='block'`, which is always
    false, so deep drops were never refused.
  - Fix: `digDown.stepFooting` looks two cells under every step:
    - solid floor: ok;
    - a hole up to 2 deep: filled with a held block;
    - a deep opening, lava under the floor, or sand/gravel over a hollow: the tunnel turns
      (straight on, then the two sides, never back, 6 turns per job);
    - no safe way on: the tunnel stops where the bot stands.
  - `Worker.tunnelStep` also stops the tunnel if the bot still ends up below its step. An ore
    descent stopped this way hands back to the gather (`descendLeg`). Lava still fails the trip.
  - Logs: `Tunnel: cave opening under ...; turning north`, `Tunnel: filled a hole under ...`,
    `Gather: descent stopped at y=N (...); searching from here`.
- **B. No bed in any run** (`da5885e`, new `tests/bed-wool.test.js`).
  - Cause: the rung asked for a bed only when a sheep was already within 32 at that moment, then
    moved on to diamonds. The dusk bed prep (tod 9000-12000) never runs on the frozen-day normal
    runs.
  - Fix, `woolJob`: by day, once the wood kit is held, a sheep within 24 is hunted or sheared at
    any step, as `bed-rung`. It waits for quick jobs (craft, equip, smelt, eat).
  - `bedJob` with 3 wool and no wood: a short log gather pays the planks.
  - No sheep: the rung takes 3 graze search legs, then sets the bed aside for 10 min.
  - A failed bed job (including its planks or logs) never charges the iron step.
- **C. Meals above bar 14** (`0a16704`, `meals` test changed).
  - Above 14 a meal now goes only to:
    - health under 10 (the low-health stop) with the bar under 18 (regeneration needs 18);
    - or health under 6 at any bar.
  - The round-9 `19 -> 20` fill-up and the `16 -> 20` at 12.4 hp are now no meal.
- **D. Hard-run wood** (`3d41c9a`, cases in `gather-blacklist`).
  - A gather that may still search leaves a grove after 5 refused columns or 10 refused blocks.
    It was 8/24: hard1 spent ~7 min refusing 24 canopy blocks.
  - Each search leg heads for the nearest log seen within 96 beyond the worked radius, instead of
    a fixed east/north/west/south. Log: `Gather: search leg N <dir> toward logs at x,y,z`.
  - Furnace and stone on the hard runs ride on the earlier wood. Nothing else changed for them.

### Efficiency (`tests/furnace-parallel.test.js`)

1. **Don't watch the furnace** (`16130c6`).
   - `smelt leave:true` loads the furnace, records `worker.furnaceRun` (readyAt = count x 10 s)
     and ends. `smelt take:true` later waits only for what is left, takes the output and picks a
     furnace it placed back up.
   - A ladder smelt of 2+ items is left to work. Meanwhile `furnaceWork` picks side jobs within
     16 of the furnace: coal, iron, torches, logs when low, drops. At most 4 per batch.
   - It goes back for the take when the batch is ready, from dusk (tod 10800), with a hostile
     within 16, or when it is more than 8 from the furnace.
2. **Batch, don't ping-pong** (`289ba51`).
   - The food step keeps hunting while animals of that kind are within 24 and fewer than 6
     edible items are held, then cooks the whole stack in one run.
   - The take keeps the furnace standing (`keepFurnace`) while raw meat or animals remain. The
     next batch reuses it and its leftover fuel.
   - `ownFurnaces` makes sure the last take still picks the furnace up.
3. **Opportunistic pickups** (`36be925`).
   - Tunnels: ore in the side walls of the feet and head cells is mined as the tunnel passes. Never
     the floor or ceiling, never next to a fluid, never with a hostile within 8. 16 per job.
   - Between jobs: exposed diamond, iron, coal (or a log when wood is low) within 6 is a short
     radius-6 gather as a `pickup` step. Once a minute at most, never at night or near a hostile.

### Habits

4. **Use the night** (`e45ca20`, new `tests/night-mine.test.js`).
   - In the sealed box, once a night (tod 12600-21500), with a stone+ pickaxe, 4+ blocks and 16+
     health, `nightMine` runs for up to 4 min. Config `nightMine:false` turns it off.
   - The box's interior is the bot's own column, so it first sinks a checked 2-deep sump through
     the floor. The staircase from the sump's bottom then cuts only the support row: the walls,
     ring and roof are never opened (asserted in the test).
   - The dig is 6 stairs plus a 12-block strip, with wall pickups. It turns back on the time
     budget, at tod 21500, under 14 health, or when the tunnel breaks into a cave it did not dig.
   - Home is the tunnel, then the pathfinder's own 1x1 tower back into the cell (it refills the
     floor). Mob Defense is live while the bot is out of the box.
5. **Bed and spawn point** (`e1259f3`).
   - The first bed the bot places and sleeps in becomes home (the spawn point). A bed placed away
     from home is picked up in the morning.
   - At night a home bed within 64 is walked back to: `{type:'sleep',position:home}`.
6. **Home base and inventory** (`889c66a`, new `tests/inventory.test.js`).
   - Home is the bed, or the first table left standing. The home chest's position is now
     remembered.
   - What the bot keeps (`surplus()`): 32 dirt, a stack of cobble, 16 seeds, 2 saplings. Gravel,
     andesite/diorite/granite/tuff, rotten flesh and flowers count as junk.
   - Over 75% full with home within 48: deposit into the home chest, or place or craft a chest
     beside home. Passing within 8 of the chest also deposits (16+ extra).
   - Full and far from home: drop junk. Dropped junk is ignored by the sweeps for 10 min.
   - New fields: `deposit keep:N` and a `drop` job. Hotbar order is not managed, since equip pulls
     an item from any slot.
7. **Light and mark mines** (`de3a62e`, new `tests/light.test.js`).
   - Torches are crafted as soon as 2+ coal and a stick are held (one coal stays for the furnace).
   - Tunnels get a torch every 7 steps on the right-hand wall (the floor when that wall is open).
   - Two torches go beside the home bed.
   - Two failed coal digs switch to charcoal from logs for 10 min.
8. **Diamonds the safe way** (`d6fd796`, new `tests/branch-mine.test.js`).
   - The trip now goes to y -53, not -58, and `strip:true` is a branch mine: a 24-block main
     tunnel with 6-block branches left and right every 3. Branches never turn; they end at
     anything unsafe.
   - Torches every 7, and it stops when the count is in.
   - `plugLava`: lava touching the bot's cells is replaced with a held block.
   - The obtain/howto diamond target stays -58.
9. **Water bucket** (`800c465`, new `tests/water-bucket.test.js`).
   - After the torches the rung crafts a bucket (3 ingots, carried by the armour dig) and fills it
     at a still source within 24.
   - A `water_bucket` counts as the iron step's bucket. The MLG fall chain and the fire douse
     already used it.
10. **Health** (`c5ad8c9`, new `tests/health.test.js`).
    - Hurt (under 14) with the bar under 18: a top-up only with food that fits under 20.
    - Deep digs (target depth, branch mine) wait for 16 health: an eat first if the bar is under
      18, then up to 90 s of waiting.
11. **Food security** (`c09a37c`, new `tests/farm.test.js`).
    - Crop gathers count the produce and take only ripe crops. A grass gather counts seeds.
      `use wheat_seeds` on farmland plants the crop.
    - Near a home with water within 8, `farmJob` does seeds from grass, a wooden hoe, then 4 plots
      tilled, planted and harvested.
    - The food step crafts hay into wheat, gathers hay bales within 32, and breeds a pair when
      their food is held (5 min per kind).
12. **Mobs to leave alone** (`9d0179d`, new `tests/mob-etiquette.test.js`).
    - `leaveAlone`: a calm enderman (not screaming, metadata 17) and a daylight spider (sky light
      12+) are dropped from `getHostiles` unless within 2. Mob Defense and the shelter guard no
      longer provoke them.
    - Already in place: a creeper is never meleed, and a witch is backed away from.

### Decide order (autopilot, a day tick with nothing running)

1. The furnace run.
2. A blocked step's explore.
3. Inventory.
4. Light (torches, the lit base).
5. The farm.
6. Wool.
7. Pickups.
8. Heal-first.
9. The step's own job.

Steps 4-7 wait for the step's quick jobs (craft, equip, smelt, eat). Each side activity has its
own step name (`furnace`, `inventory`, `light`, `farm`, `bed-rung`, `pickup`, `heal`), so its
failures never block a ladder step. Each has its own set-aside timer.

### Changed expectations

- `meals`: health 12 at bar 16 is no meal now (bug C).
- `autopilot` M5 and `iron-rung`: the bucket comes right after the torches. The diamond gather is
  `targetY -53, bandTop -53`.
- `tunnel-safety` stub: gained `tunnelStep`.

### Needs live verification

- **A:** expect `Tunnel: ... turning` / `filled a hole` lines on the diamond and iron descents,
  and no `fell from a high place`.
- **B:** `[bed-rung] {"type":"hunt","entity":"sheep"...}` early in the runs, `craft white_bed`,
  `Home set to the bed ... (spawn point)` on hard nights, and `bed_at` in RUNGS.
- **1-2:** `Smelt: furnace at ... loaded with N ...; back for ...`, then side jobs as
  `[furnace]`, then `Smelt: took N ...`. If the take finds the furnace emptied early, the 15 s
  grace is too short.
- **4:** `Night mine: down from the shelter ...` / `back in the shelter (...)`. The pathfinder's
  1x1 tower back into the cell is the untested part: a `could not climb back into` line means
  the bot is still 2 below the floor. The box still stands above it, and the morning exit then
  has to path out.
- **6:** `[inventory] {"type":"deposit",...,"keep":32}` once the inventory fills near home.
- **8:** `Digging a branch mine`, `Tunnel: mined diamond_ore in the wall`, `Tunnel: plugged
  lava`. The climb back from -53 is long, so `Navigation timed out` on it is possible.
- **9:** `[iron] {"type":"use","item":"bucket",...}`. Water must be within 24 of where the rung
  runs.
- **12:** no `Reflex: ... enderman` lines with a calm enderman near.

### Left / known gaps

- Not done:
  - turning blocking lava into obsidian with the water bucket (tunnels plug it with a block
    instead);
  - steering the bot's gaze off an enderman's head;
  - hotbar sorting;
  - looting village chests for bread.
- The home step's `done` is still always false. Iron `done` still needs a bow and 32 arrows, so
  the later `bed`/`home` steps stay unreachable (the rung's bed and the habits cover them).
- The hard runs' furnace (D) was not changed directly. If the earlier wood does not lift it, the
  dusk kit timing is the next lever.
- Farming needs water within 8 of home. The bot never carries water to make a farm.

## Cloud session round 11 (Claude, 2026-10-16, code only - `docs/NEXT_TASKS.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test --test-timeout=60000`: **532 passed, 0 failed** (500 at the
start of the round, plus 32 new). One commit per bug on `main`, 7 in all. Bugs 1-7 of
`docs/NEXT_TASKS.md` were fixed in priority order. Bug 8 (no hunts measured) was left alone, see
the end. The diagnoses come from the code and the round-10 TEST_REPORTS text. There were no
dashboard logs in the sandbox, so several root causes are best guesses, marked as such below.

### 1. Night mine left the bot under its shelter (`20a7da5`, `night-mine`, new `shelter-hold`)

- Cause:
  - `nightMine` logged `back in the shelter` whether or not the bot got back.
  - hard1's `bot at 163.50,18.34` in the re-seal line is **x,z**, not x,y. The bot stood at the
    strip's end, 16 blocks north of the box.
  - Separately, the strip mine (and the branch mine) picked a hashed heading. From some stair
    feet it turned back under the stairs: the strip's head cell is the stair's floor, which
    leaves each stair a 2-high climb on the way home.
- Fix, `nightMineReturn`: it now checks that the feet are in the cell and never assumes it. It
  tries, in order:
  1. `climbTunnel`;
  2. the pathfinder tower;
  3. `walkTunnelBack`: the recorded tunnel cell by cell by hand, jumping each stair;
  4. `pillarUp`: a jump-placed pillar up the sump. It never jumps into a ceiling, and it clears
     a stale pathfinder goal first.
- If none of these works, `nightMine` returns `'away'` and logs `Night mine: not back in the
  shelter (...); bot at ..., the box is at ...`.
- `shelter()`: when the night mine is away, or the bot has been out of the cell for 3 s
  (`SHELTER_AWAY_MS`) for any reason, it logs `Shelter: not in the box at ... ; sealing where it
  stands` and seals a new box or pod there. It no longer guards an empty box. The old box stays
  standing, as with the existing "moved" path.
- `tunnelHeading`: a level tunnel that starts at a staircase's foot keeps the stairs' heading.

### 2. Diamond descent too cautious to arrive (`e81f1a5`, `descent-safety`)

- Bridging: `stepFooting(blockAt,next,dir)` now bridges a deep opening that is at most
  `BRIDGE_WIDTH` (2) cells wide along the heading. Solid ground must come back at the floor level
  or one below. One held block goes against a side of the floor cell. There are `BRIDGES` (8)
  per job. Log: `Tunnel: bridged a gap under ...`. Wider caves still turn.
- Sidestep: `descendLeg` on `no safe way on` digs `SIDESTEP_LEN` (3) checked level cells to a
  side, then straight on, never back. It then starts a new staircase that way, up to
  `SIDESTEPS` (3) times per leg. Log: `Tunnel: no safe way down; moved 3 north to start a new
  staircase at ...`.
- `STAIR_TURNS` went from 6 to 12. Ore descent legs went from 3 to `DESCENT_LEGS` (6).
- The old "openings on every side stop the staircase where it stands" test is unchanged. The
  staircase itself still stops, and the sidestep lives in the leg.

### 3. Furnace take never happened (`a484a5d`, `furnace-parallel`)

- Root cause, a guess: the take's single `walk(furnace,2)` failed twice, which dropped the run,
  and the next smelt placed a new furnace.
- `smelt` (not take) with a run open now walks back and collects that batch first, with
  `keepFurnace` on. It then smelts in that same furnace, and the inline smelt picks a kept
  furnace of its own back up. Log: `Smelt: collecting the iron_ingot at ... before a new batch`.
- `takeSmelt` goes back through `walkToFurnace`: the plain walk, then the explore movements to
  within 3. After `FURNACE_TAKE_TRIES` (3) failed walks the run is given up (`gave up on the
  batch at ... after 3 failed walks`).
- Autopilot: two failed takes no longer clear `furnaceRun`. The ladder goes on, and the next
  smelt collects the batch first.

### 4. Water bucket fills fail (`d6c943b`, `water-bucket`)

- Main suspect: the fill sent `activateItem` and then stood still. The 26.3 server applies
  use-item changes at the next client tick boundary, which is why the hoe and seed uses already
  call `flushTick`. The bucket path did not.
- `fillBucket` now does the following:
  - Flowing water is redirected to a source within 2, at level 0 with air above. Log:
    `Bucket: ... is flowing water; filling at the source ...`.
  - It aims at the source's surface (y+0.9).
  - `rayToFluid` checks that the eye ray meets no solid block first and that the eye is within
    `BUCKET_REACH` (4.4). Otherwise it walks closer: range 3, then 2, then 1.
  - After the use it calls `flushTick` and hops while it waits.
  - It makes `BUCKET_TRIES` (3) tries, then fails with the reason, e.g. `(3 tries; no change
    after the use)` or `oak_fence at ... in the way`.

### 5. Bed: no sheep found (`c36dc64`, `bed-wool`)

- The rung's search now walks toward the nearest sheep it can see within `SHEEP_FAR` (96) but
  beyond the hunt's 24-block reach. It explores in that sheep's direction for the distance minus
  12.
- Blind graze legs are now `BED_SEARCH_DIST` (64, 96, 96) instead of 32.
- Any wool source counts: 4 string craft a `white_wool` (`bedJob`).
- The 3-leg limit and the 10-min backoff are unchanged.

### 6. Deposit never happens (`90bd7a6`, `inventory`)

- Cause, two gaps:
  - Home was only a bed or a table left standing, and the normal runs pick their tables up, so
    there was no home and no chest.
  - A bag full of non-junk items had no surplus at all.
- `surplus(counts,full)`: when the bag is full, everything the ladder does not use is surplus.
  The ladder uses tools, armour, food, fuel, logs and planks, the iron and diamond kit's
  materials and the bed's. Surplus is deposited and never dropped, unless it is on the junk list.
- `inventoryJob`, when full with no home chest: a chest goes beside home, or where the bot
  stands (`chestSpotHere`) when home is out of range or unset. It is crafted from 8 planks
  first (12 without a table).
- When the home chest is far: junk is dropped first, and a new chest goes here only when nothing
  is droppable.
- The inventory step's placed chest becomes `homeChestAt`, and also `home` when none is set.
  Log: `Autopilot: home chest placed at ...`.
- `chestSpotNear` skips water and lava cells.

### 7. Hard runs (`4d86ed5`, `gather-blacklist`, `shelter-hold`)

- **hard2's canopy logs.** After the two climbs, `pillarToLog` stands under the lowest log that
  is out of reach and pillars up until the log is 3 above the feet:
  - `TRUNK_PILLAR` (4) blocks at most;
  - dirt is dug first when no blocks are held;
  - leaves over the head are dug.
  - This happens twice per job. Log: `Gather: pillaring 2 up to the canopy log at ...`.
- **hard3's night.**
  - A seal that ran out of time is now held instead of falling back to the night pillar
    (`holdableShell`) when:
    - at most `HOLD_GAPS` (2) cells are open;
    - the floor and the roof over the bot are solid;
    - no side opening is two blocks high.
  - The guard keeps re-sealing and hits mobs at the gap. Log: `Shelter: 1 open cell(s) left at
    ... under a closed roof; holding the box and re-sealing`.
  - Root cause of `rose 0.00, 0 clicks`, a guess: a leftover pathfinder goal makes the
    pathfinder clear the controls every physics tick. `NightPillarTask` (and `pillarUp`) now
    clear the goal before jumping, and release `sneak`.
  - The failure line now also says `cleared a pathfinder goal` or `ceiling over the head`, so
    the next live run tells which it was.

### Changed expectations

- No existing assertion was changed.
- The round-11 shelter cases live in a new file, `tests/shelter-hold.test.js`, with the
  `shelter-seal` helpers copied in. `shelter-seal.test.js` alone was at ~64 s with them, over
  the 60 s per-file timeout.
- The furnace test that checks movements restore sets `epoch:0` on the fake worker.

### Needs live verification

- **1:**
  - No `Night mine: back in the shelter` while the re-seal reports the bot elsewhere.
  - On a failed climb, expect `walking the tunnel back by hand` / `pillaring up the sump`, or
    `not back in the shelter` followed by `Shelter: ... sealing where it stands` and a new
    `Shelter: sealed at`.
- **2:**
  - `Tunnel: bridged a gap`, `Tunnel: no safe way down; moved 3 ...`, and a diamond trip that
    reaches y -53 (`Digging a branch mine`).
  - Watch for a bridge block that does not land: the post-dig footing check still stops the
    step.
- **3:**
  - `Smelt: collecting the ... before a new batch`, then `took N ... (left standing)`.
  - No new furnace placed while a batch is out.
- **4:** `water_bucket` held after `[iron] use bucket`. If it still fails, the error now names
  why (ray blocked, out of reach, or no change after the use).
- **5:** `[bed-rung] explore` legs toward a seen sheep, then `hunt sheep` / `craft white_bed`.
- **6:** `[inventory] place chest`, `home chest placed at`, then `[inventory] deposit ...`.
- **7:**
  - hard canopy: `pillaring N up to the canopy log`.
  - hard night: either `holding the box and re-sealing`, or a pillar line that now names the
    cause.

### Left / known gaps

- **8, no hunts:** the food step was set aside every run (`failed 3 times`, `6 explore legs
  without food`). Nothing in the round-10 text says which job failed, so nothing was changed.
  The next live run should keep the `[food]` job failure messages. A seen-but-far herd could
  get the same "head toward it" treatment as the sheep (bug 5) if that turns out to be the gap.
- The abandoned box (when the shelter re-seals elsewhere) is not taken down at dawn.
- A canopy pillar and a pillared-up sump are left standing (player-made dirt or cobble columns).
- A chest placed far from home replaces the remembered home chest. Only one chest is remembered.

## Round 12 (2026-10-16, local fixes from the round-11 live soak)
Unit tests: **534 passed, 0 failed**. Not yet live-verified.

1. **Drowned in a flooded tunnel** (normal2, (473,56,210)): the swim-up held jump under a stone roof, and the ladder submitted a new coal gather a second after the drowning escape started. Now `SwimUpTask` digs a solid roof over the head cell (never bedrock or beside lava), and the autopilot submits nothing while a World Survival or MLG chain owns the bot. Look for `waiting: Misc World Survival Chain` in the state.
2. **Diamond trips stopped on water at y=60**: a one-deep water floor on solid ground is now filled like a hole (`stepFooting` returns `water:true`), and a `Tunnel stopped: water ...` leg can sidestep instead of failing the job. Look for `Tunnel: filled a hole` near water and `moved N` sidesteps.
3. **Bucket fills out of reach** (15 blocks up a cliff, retried 3 jobs in a row): water sources within 4 blocks of the bot's height come first, and a source the bucket failed at is skipped for 10 minutes.
4. **No bed after killing sheep**: with 2 iron ingots and a sheep in reach, shears are crafted before any kill (a shear gives 1-3 wool and the sheep stays). Look for `craft shears`, then `shear`.
5. **Starved at a bar of 5** (normal1, `Health or food is low` for 25 min): a nearly empty bar (<= 6) with no food held brings the food step back even while it is set aside, and food trips (`hunt`, `collect`, food-step `explore` with `forFood`) run on a low bar instead of being refused.

## Round 13 (2026-10-16)

Round 12's soak was stopped in normal1: at y=-34 in the diamond strip tunnel the bot dropped 256 cobblestone, 45 dirt and 32 cobbled deepslate in a loop for 10 minutes (300x `Dropped 256 cobblestone`). The tossed stacks hit the tunnel wall, landed on the bot, and were picked up again when their 2 s pickup delay ended; the drop job only checked the count 0.3 s after the toss.

- `drop` (worker): faces the longest open run (`dropDirection`, feet and head clear, up to 8 cells), refuses with `No room to toss` under `DROP_MIN_OPEN`=4 cells, steps 3 blocks back from the toss, waits `DROP_SETTLE_MS`=2.6 s, and fails with `came back into the inventory` if the count rose. A failed inventory job sets the step aside for 5 min (existing).
- Autopilot: the same item dropped twice within 3 min sets the inventory step aside for 5 min (`... dropped twice in 3 min; inventory step set aside`).
- Log lines to look for: `Dropped N item (toward x,z, open k)`, `No room to toss`, `came back into the inventory`, `dropped twice in 3 min`.

Combat test 3 (skeleton) timed out in the harness's wait; the bot's fight job ended in 4 s with no target. It passed in earlier rounds; rerun it before treating it as a bot bug.

## Round 14 (2026-10-16)

Round 13 soak: 0 deaths, the drop loop gone (4 tosses landed, 9 refused, 4 came back), iron pick 3/3 normal, no hard run past stone. New problems and their fixes:

- **Diamond trips stopped on water** (normal1 y=48, normal3 y=20, `Tunnel stopped: water at ...`). Water beside a cell the step digs was only seen at dig time. `planTunnelStep` now checks it (`fluidBeside`) and turns (`water beside ...`), and `descendLeg` sidesteps on a water stop too. Also: round 12's water-floor fill never ran, because `digTunnelStep` threw on the water floor before the fill; a planned water fill now passes.
- **Full-bag craft loop** (`No room for crafting result` 167x, a torch craft every 8 s for 16 min). A craft that fails that way stops all crafts for `NO_ROOM_MS`=5 min and makes the inventory step due at once (`the bag is full; no crafting for 5 min`).
- **Tosses refused in a cramped tunnel** (`open run 0/1`). The drop job walks to the nearest stand within 12 that has 4 open cells in a row (`openStandNear`) before giving up.
- **Shear retried a shorn sheep** (2 shears, then 45 s on a shorn one, no bed). The shear job skips shorn sheep (wool byte bit 0x10, or ones it already sheared) and prefers the wool colour the bot holds most of (a bed needs 3 of one colour). `sheepNear` no longer counts shorn sheep.
- **Bucket retried the same unreachable pool**: a failed source rules out every source within 6 of it for 10 min.

Still open: no hard (dark-forest) run reaches iron; hard2 took 602 s to a wooden pick.

Log lines to look for: `water beside`, `moved N ... to start a new staircase`, `filled a hole`, `the bag is full`, `Dropped ... (toward`, `No unshorn sheep`, `white_bed`, `water_bucket`.

## Round 15 (2026-10-17)

Round 14 soak: **first diamond pickaxe** (normal1: 3 diamonds at y=-8..-10 on the way down, nine `filled a hole`, pick crafted at 16:29Z); normal2's staircase sidestepped and bridged but stopped at a cave opening at y=68; the craft loop stayed gone; 3 deaths, all hard2; no bed; no hard run past stone.

- **Low health, no food** (normal2: health 9, bar 17, nothing to eat, 13 min of `Health or food is low`). Health only regenerates at a bar of 18+, so `foodDone` now returns false with no food, health under `minHealth` and a bar under 18 (`ctx.lowHealth`), and `recovering()` stops waiting in that state.
- **Drowning latch** (hard2 drowned twice at (119,53,39): `swimming up` 31 times, `resumed the shelter job` 46 times). Seagrass, kelp, bubble columns and waterlogged blocks at the head or feet count as water, and the latch only lets go when the head is in air (not stone pressed against while swimming) or the air is back to 18.
- **Tunnel climb walked off the tunnel** (hard2: retries took it from (127,123,29) to (115,123,33), then a 68-block drop to (105,57,37) into the flooded cave). The climb sets the pathfinder's `searchRadius` to `CLIMB_DETOUR`=6, and after a failed step a bot more than `CLIMB_LOST`=5 from the next step stops with `Left the tunnel at ...`.
- **Full bag wait** (normal1 `waiting: bag full (stone craft)` for 511 s). A free slot ends the craft pause at once; a bag still full gets a forced junk drop once a minute (`FORCED_DROP_MS`) whatever the inventory step's backoff.
- **Bucket** (three pools `out of reach (21-22)` in a row): two failed fills in 5 min set water fills aside for 15 min (`the bucket failed twice`).

Not fixed, needs a look in the world: hard3 at the hard anchor (141,131,30) after the harness's unstuck teleport - every dark-oak log `Cannot reach` within a second, explore `No path to the goal!` / `stopped early` with the bot not moving, `pillaring 4 up to the canopy log` 7 times in 64 s, and 46 `moved wrongly` teleports at (128,127,36) before that.

Log lines to look for: `Left the tunnel`, `the bucket failed twice`, `waiting: bag full`, `Dropped`, `Food:` with health under 10, `swimming up` followed by `resumed`.

## Round 16 (2026-10-17)

Round 15 soak: 5 deaths (normal1 burned at y=-20; hard3 four times to zombies, three of them a respawn at night with an empty bag), no diamonds (the trip stood at y=-10 on a full bag), normal2 stuck for 23 min at bar 5 on the wood step, hard2 fled a witch for 1000 s. The drowning latch held (one swim-up, out). No `Left the tunnel`.

- **Full bag, chest craft blocked** (normal1 idle 301 s on `waiting: bag full`): while crafts are paused, `inventoryJob` never offers a chest craft (`ctx.noCraft`), so the junk drop goes out.
- **Optional kit pieces** (`craft stone_shovel` / `Missing ingredients or a nearby crafting table` 66 times; the third failure's unblock explore went 64 blocks through caves at y=-20 into lava): a stone shovel or axe craft that failed 3 times is skipped for `KIT_SKIP_MS`=10 min (`... craft failed 3 times; skipped`), with no explore.
- **Food emergency jumps the ladder** (normal2: bar 5, no food, ladder on the wood step, `Health or food is low` on every plank craft): `plan()` goes to the food step first when nothing edible is held and the bar is <= 6, or health is low under a bar of 18 (`foodEmergency`). Crafting is now a survival job (allowed at any health).
- **Superseded resume** (hard3: Mob Defense paused a pig fight, the night shelter was queued, then `resumed the fight job`, then killed): a paused job with a newer queued job behind it is cancelled (`the paused ... job was superseded`).
- **Hunt timeouts count** (3x `Fight timed out; pig is still standing`, each followed by a collect that reset the failures): a completed collect no longer resets the step's failure count.
- **Witch flee bounded** (hard2: `fleeing witch` 330 lines over 1000 s): only a witch within 10 with a line of sight is fled, and after 45 s of fleeing, witches beyond 6 are ignored for 60 s (`fled a witch for 45 s`).

Still open: hard runs (no iron yet; dark-oak `Cannot reach` near the anchor), a night respawn with an empty bag (zombie kills at the spawn), bed, bucket.

## Round 17 (2026-10-17)

Round 16 soak: **0 deaths**, the **first bed** (normal1: 3 sheep, `craft white_bed`), a diamond pickaxe again (normal2, 3 diamonds at y=-18), iron pick 3/3 normal, no food emergency, no witch loop. Hard runs: stone pick 3/3, but no furnace; each sealed at nightfall and sat idle until dawn (hard1 had no night mine at all).

- **Full bag in a staircase** (normal3: `No room to toss cobblestone (open run 0)` once a minute for 10 min at y=88, no open stand within 12): the drop digs a level pocket `DROP_POCKET`=5 cells (each a checked tunnel step), walks back out and tosses into it (`Drop: dug a 5-cell pocket ...`).
- **Night mine deeper and longer**: `NIGHT_MINE_DEPTH` 6 -> 10, `NIGHT_MINE_MS` 4 -> 6 min, `NIGHT_MINE_STRIP` 12 -> 16. The night is the hard runs' only long stretch of digging time.

Still open: why hard1 never night-mined (sealed, quiet until dawn); bed placement and sleeping (`white_bed` held, no `Home set`, no `Sleeping`); normal1 after a failed tunnel climb at y=-47 looped `gather coal_ore targetY 32` 29 times; bucket fills still out of reach.

## Round 18 (2026-10-18)

Round 17 soak: **0 deaths** again; **the first hard-run iron pickaxes** (hard1 at 482 s, hard2 at 602 s); every hard run night-mined (hard2 27 steps, cobble 16 -> 78); no diamonds; no bed. Two weak spots:

- **Starving underground** (normal2: bar 0 and 1 hp for 300 s; 18 food explores through caves at y=-9..47 - no animals down there; normal3: 30 food explores `stopped early` at y=77, bar 5). The food step now climbs back up first when the bot stands more than `ASCEND_BELOW`=16 under its surface anchor (`lastSurfaceY`): a new `ascend` job (`{type:'ascend', y, forFood}`) climbs the stranded tunnel if one is recorded, then paths up with `GoalY` (normal movements dig and pillar), and fails if it gained under 3 blocks. It is a survival job (runs at any bar/health). Log: `Ascend: y=A -> B (surface S)`.
- **Pocket toss came back** (3 of 3 `Drop: dug a 5-cell pocket`, each followed by `came back into the inventory`): after the toss the bot stepped "back" into the staircase wall and stayed beside the items. It now paths anywhere 4+ from where the items land (`GoalInvert(GoalNear(land, 4))`).
- **Diagnostic**: `Cannot reach or harvest this block` now says why the walk failed (`walk: <error>; bot at ..., N away`), for the dark-oak logs the hard runs keep refusing in about a second each.

Still open: diamonds (trips stopped at y=29, -48, -17 this round), bed, bucket (out of reach / clay in the way).

## Round 19 (2026-10-18)

Round 18 soak: 2 deaths, both after a full bag stalled the ladder; no diamonds; hard3 never started (harness: `dawn/clear weather not confirmed`, `timeOfDay=None`). normal1 drowned at (390,55,179): every log gather refused `Inventory nearly full; deposit items first` (the inventory step was set aside after `tuff dropped twice`), the wood step's unblock explore dropped it into a lake, and the drowning latch let go at air 2 while its head bobbed at the surface. normal3 burned at (381,-54,107): every iron gather refused the same way, `iron failed 3 times; exploring before retry` walked 64 blocks through caves into lava, and the lava escape's preemption resumed that explore six times.

- **Drowning latch**: lets go only at air 18+ or with head and feet both out of the water (round 15's "head in air" release fired while bobbing).
- **`Inventory nearly full`** (gather refuses with < 2 empty slots) is handled like `No room for crafting result`: the inventory step is due at once and a bag that stays full gets the forced drop once a minute.
- **Hazard resume**: an explore/goto/gather that a World Survival escape (lava, fire, water) preempted is cancelled, not resumed (`led into a hazard; cancelled`).
- **No cave explores deep down**: a step that fails 3 times more than 16 under the surface anchor with no sky light cools down 20 s and retries instead of exploring (`failed 3 times deep underground; no cave explore`).
- **Pocket**: also dug when an open stand was found but not reached (normal2: `open run 1` once a minute for 9 min, no pocket).
- **Diagnostic**: every `Cannot reach or harvest` now carries `walk ok;` or the walk error, the bot's cell and the eye-to-block distance (336 of 356 round-18 lines had no walk error at all: the walk "succeeded" but the log was still out of reach).

Ascend did not fire in round 18 (the bar never fell low underground). Still open: the dark-oak reach problem, diamonds, bed placement/sleep, bucket.

## Round 20 (2026-10-18)

Round 19 soak: 0 deaths, but **5 of 6 runs never made a wooden pick**. normal1 was fine (iron pick at 391 s) until its food step's `ascend` asked for a `GoalY(122)` path from y=-19: `Took to long to decide path to goal!`, and from then on every walk in every later run failed `Navigation made no progress ... (last path: none)` - 198 times - for 2.5 hours.

Cause (`logs/dashboard-uncaught.log`, `Cannot read properties of null (reading 'digTime')` at `bestHarvestTool`): mineflayer-pathfinder's `monitorMovement` sets its private `digging = true` and only then calls `bestHarvestTool(block)`; a path into an unloaded chunk gives `block = null`, the tool lookup throws, and `digging` is never cleared - the pathfinder then returns early on every physics tick and never plans again. It is latent (seen 2026-10-16 too); the 140-block GoalY made it certain.

- `toolWear.js`: the `bestHarvestTool` wrapper returns null for a null block and never throws (the dig then fails and the pathfinder resets the flag itself).
- `worker.navigate` finally: `unstickDigging(bot)` - after `setGoal(null)` (which arms the pathfinder's `diggingAborted` listener), a `digging` flag with no bot dig in progress is cleared by emitting `diggingAborted`.

Round 19's other changes held: `Inventory nearly full` 4x each followed by a drop; 7x `deep underground; no cave explore` and no cave walk; 2 hazard cancels; no drowning. Pockets still came back 4 of 4 (next round). Ascend never reached the surface (that run's pathfinder wedge).

## Round 21 (2026-10-18)

Round 20 soak: the pathfinder wedge is gone - **all 6 runs made a wooden pick** (round 19: 1 of 6), zero `last path: none`, no uncaught errors; hard2/hard3 reached the furnace. 2 deaths: normal1 `obliterated by a sonically-charged shriek` (a warden) at y=-33 after 13 s of diamond-ore attempts in place, and normal3 drowned at (239,60,83) with **no** `swimming up` line.

- **Empty path is a failure.** mineflayer-pathfinder's `goto()` RESOLVES when a path update comes back with zero steps (`noPathListener`: `if (results.path.length === 0) cleanup()`), i.e. "no path at all" looks like arrival. That is every `walk ok` on a target 6-18 blocks away (102 of 104 dark-oak refusals on the hard runs, the 13 diamond-ore attempts before the warden). `navigate` now throws `No path to the goal! (empty path at ...)` when goto resolves but the goal is not reached.
- **Deep dark**: a sculk sensor/shrieker/catalyst within `DEEP_DARK_NEAR`=12 stops a gather (`Deep dark: ... leaving (warden)`) and a tunnel step (`Tunnel stopped: deep dark (...)`).
- **Warden**: within `WARDEN_FLEE`=24 it is "universally dangerous" - Mob Defense runs.
- **Drowning backstop**: a head under water for `HEAD_WET_MS`=8 s counts as low air whatever `oxygenLevel` says (the normal3 drown never saw the air reading drop).
- **Diagnostic**: `Inventory nearly full; deposit items first (name:slots ...)` lists what fills the bag (normal2 stood 754 s and normal3 571 s on a full bag that drops did not clear).

## Round 22 (2026-10-19)

Round 21 soak: **0 deaths**, zero `walk ok` (round 20: 142 of 148 attempts), no wedge, no uncaught errors, iron pick 3/3 normal. But hard2 and hard3 never made a wooden pick: `No path to the goal! (empty path at ..., last path: noPath, 0 steps, 1 nodes)` 61 and 123 times, the bot on open ground by the anchor at dawn; hard1 dug itself into a pit under the canopy (y 126 -> 124). normal3 fled 4 silverfish and was silent for 17 min.

- **Mob avoidance priced out every step.** `stepCost` adds 6 per block per hostile within 8 (plus 40 on a skeleton's shot line); with a dawn crowd one step cost more than the search's cost cap (`maxCost = h + searchRadius`), so the A* never left its first node. The cost is capped at `STEP_COST_CAP`=40 per step, and an empty path with the avoidance hook on is retried once without it (`no path with mob avoidance at ...; trying without it`).
- **Boxed in**: an empty path whose search visited 1-2 nodes runs `stairOut` - up to `STAIR_OUT`=4 checked upward tunnel steps (dy +1) toward the goal (then the other sides) - and paths again (`Boxed in at ...: dug N steps up ...`).
- **Silverfish / endermites** are not fled or fought unless within 3 (`MINOR_MOBS`, `MINOR_NEAR`).

Still open: the full-bag slot lists show many single slots (snowball, clay_ball, a second stone pickaxe and shovel, wool) - those need dropping too; pockets still came back 3 of 3; bed; bucket.

## Round 23 (2026-10-19)

Round 22 soak: **the best yet** - 0 deaths, **all 6 runs made a wooden pick, a stone pick and a furnace** (hard furnaces at 301/331/241 s; round 21 hard2/hard3 never made a wooden pick), iron pick 3/3 normal, hard1 crafted the first hard-run bed and its night mine came back with 8 ore items. The empty-path stall on the hard runs is gone (0 empty paths on hard; `trying without it` retries mostly moved on). Silverfish: no stall.

- **Bed placement** (hard1: 7 places refused `the block is still air`, then `No clear spot to place a white_bed`, no sleep): a bed is two cells - the foot that is clicked and the head one further along the placer's facing. `placeBed` picks a foot (1-3 out, feet level then one down/up) whose head cell (one further from the bot along the same axis) is open too, both on solid ground, faces that axis and places on the foot's floor (`bedSpots`). The generic planner is the fallback.
- **Deep dark leave** (normal1: `Deep dark: sculk_catalyst ...; leaving (warden)` 26 times in 5 min on the same cell): a deep-dark refusal now submits an `ascend` to the surface anchor next tick and sets diamond trips aside for `DIAMOND_OFF_MS` (`deep dark - climbing out`).

Still open: diamonds (deepest trip y=-44, the strip at -53 not reached), bucket fills (`No path` / out of reach every time), normal3 ended at food bar 2 with `waiting: bag full (food craft)`.

## Round 24 (2026-10-19)

Round 23 soak: all 6 runs again made a wooden pick, stone pick and furnace; iron pick 3/3 normal; **the first water bucket** (normal2); the deep-dark refusal fired once and climbed (stopped at y=-18). 1 death: hard2, killed by a zombie while a creeper at 5.6-6.0 flipped the shelter override on and off every ~0.3 s and each shelter resume `moved ... building a new box here` (8 boxes in 8 s). normal3 sat 9.3 min in `swimming up` at y=-45 with the air reading moving between 10 and 400. No bed this round (hard1 killed 2 sheep: 2 wool).

- **Creeper override hysteresis**: once a creeper (<= 6, or fusing <= 10) overrides a survival hold, Mob Defense keeps it until the nearest creeper is past `CREEPER_RELEASE`=9 (`creeperDistance`).
- **Air reading**: a value above 20 is the raw air supply in ticks (0-300) and is scaled to bubbles (/15). The 8 s head-under backstop (round 21) now fires only when the air value has also not changed for 8 s - a live reading is trusted.

## Round 25 (2026-10-19)

Round 24 soak: **the pathfinder wedge came back** - from 05:05:50Z (normal3) every walk failed `Navigation made no progress ... (last path: none)`, and all three hard runs (same bot process) never made a wooden pick. No uncaught error this time. Deaths: normal2 drowned at (348,78,-89) (bucket filled standing in the pool, then a drop and a craft in place; first line `air 1`; then 12 server position corrections pinned it), hard2 suffocated in a wall at (149,138,27) with the pathfinder wedged.

- **Wedge, cause 1**: mineflayer-pathfinder's `monitorMovement` returns early every tick while its private `returningPos` (set after a bridging placement when `LOSWhenPlacingBlocks` is on) has not been reached, and `resetPath` never clears it - a bot moved off that spot (a server correction, a harness teleport/unstuck) never plans again. `bot.pathfinder.LOSWhenPlacingBlocks=false` at spawn.
- **Wedge, cause 2**: a pathfinder dig whose block update never came keeps both its `digging` flag and mineflayer's `targetDigBlock`; round 20's unstick skipped that. `unstickDigging` now calls `bot.stopDigging()` (clears the target, fires `diggingAborted`) after every walk while the pathfinder still reports mining, then fires the abort itself if needed.
- **Drowning**: swim up at air <= `DROWN_AIR`=8 (was 6; the integration test waits for < 10 first). After a bucket fill the bot walks to the nearest dry stand within 6 (`leaveWater`: `Water: stepped out to ...`).

## Round 26 (2026-10-19)

Round 25 soak: **0 deaths, `last path: none` 0** (round 24: 170), no drowning, no placement failures with `LOSWhenPlacingBlocks` off, iron pick 3/3 normal (421/602/481 s), full iron armour on all three normal runs, two `black_bed` crafts (normal runs have no night, so no sleep), hard2/hard3 furnace at 301/271 s, `Water: stepped out` after a fill.

- **Stale memory across runs** (hard1 never made a wooden pick: first job `Could not get back to the furnace at 308,85,76` - normal3's furnace, hundreds of blocks away - then dark-oak attempts at (210,124,87)): `forgetFar` runs every decide and drops a loaded furnace batch, a left table or a stranded tunnel more than `FORGET_FAR`=96 from the bot (`forgot the furnace batch ... (too far)`).

Still open: bed placement/sleep (only hard runs have nights; no hard bed this round), diamonds (trips stop at deep-dark sensors, -12/-6/-4), pockets still come back about 4 s after the toss, night mine 0 ore on the hard runs this round.

## Round 27 (2026-10-19)

Round 26 soak: **0 deaths, 0 `last path: none` (second clean round), all 6 runs through the furnace** (hard 271/301/271 s), iron pick 3/3 normal (451/482/512 s), no run started on a leftover furnace, hard2's night mine brought back 2 raw iron.

- **Stone pickaxe craft loop** (normal2 held 14 stone pickaxes, normal3 7; 39 iron-step pickaxe crafts): `replacementJob` replaced a worn iron pickaxe with a stone one when no iron was spare, but only counted iron pickaxes as the replacement, so it crafted another every tick. A worn tool now counts as replaced when a sound one of the same kind is held at the tier it would craft or better (a worn iron sword with ingots on hand is still replaced in iron).

- **Planning time**: `bot.pathfinder.thinkTimeout` 5 s -> 10 s (every night-mine climb home failed `Took to long to decide path to goal!`, 3 of 3; the A* still thinks 40 ms per tick).

Still open: bed (no sheep found this round; no hard-run bed), diamonds (water under the staircase at y=59, deep dark at y=12), normal3's clay balls coming back once a minute, placing a furnace while the food chain holds meat.

## Round 28 (2026-10-19)

Round 27 soak: all 6 runs through the furnace again (hard 241/331/331 s), iron pick 3/3 normal (452/452/572 s), stone pickaxes never above 2 (round 26: 14), `last path: none` 0 (third round running), hard3's night mine got back into the box (pillared up the sump). 1 death: hard1 `slain by Zombie` at (221,100,25), ~577 s into the run (tod ~11500) during a food-step pig fight and drop collect in a dark-forest crowd.

- **No food trips at dusk**: between `DUSK_PREP` (10000) and `SUNSET` a food-step hunt/fight/collect/explore is replaced by the next step (the plan is re-run with food blocked; `dusk: no hunting`) unless it is a food emergency (`duskHuntOff`). Food waits for the morning; the dusk kit, cobble and shelter run instead.

Still open: bed (no sheep found on most runs; hard runs never craft one), diamonds (water beside the staircase at y=-7, a broken pickaxe at y=12), hard-run iron pick, a smelt walking back to the previous run's furnace 30 blocks away.

## Round 29 (2026-10-20)

Round 28 soak: 5 valid runs (all through the furnace; iron pick 3/3 normal at 482/632/422 s; hard1's night mine came back with 16 ore items), but **hard3 never started** (3 attempts `INVALID - dawn/clear not confirmed (observe: timeOfDay=None weather=None)`), and the 1 death was hard2 `shot by Skeleton` at tod ~9950 during a pig fight in a crowd. `dusk: no hunting` never fired (no food trip reached the window).

- **Keep-alive kick** (why hard3 never started: the bot was gone): hard2 was disconnected at 02:47:59 IST - the server log says `Disconnecting BuilderBot for sending keepalive response ... out-of-order!` - and the harness could not observe the next run. `compat.js` paced keep-alive replies to one per 500 ms and DROPPED the rest; two requests close together (after a stall) lost a reply and the next carried the wrong id. Same class of bug as the round-3 teleport-confirm dedupe. Now only an exact repeat of the same id is dropped; every request gets its reply, in order.
- **Crowd rule for food trips**: a food-step hunt/fight/collect/explore also waits while `CROWD_NEAR`=3+ hostiles are within 16 (dark-forest canopy spawns by day), unless it is a food emergency (`crowd: no hunting`, logged once per state change).

## Round 30 (2026-10-20)

Round 29 soak: **all 6 runs valid** (no kick: the keep-alive fix held), **iron pickaxes on two hard runs** (hard1 422 s, hard2 572 s - the second time ever), iron pick 3/3 normal (512 s each), `crowd: no hunting` fired 5 times on hard1. 2 deaths, both `fell from a high place`:
- hard1 127 -> 90 during a sheep fight: the fight controller walks with raw control states and never checks for a cliff.
- hard3 118 -> 86 straight down at (119, ?, 30) right after `craft furnace ... collectTable`: `pickUp` walked to within 1 of the crafting table (onto it), dug it out from under its own feet over a cave, then walked into the hole.

- **Ledge guard** (`ledgeGuard`, every physics tick): while the bot walks on the ground under raw controls (not a pathfinder walk) and the cell `LEDGE_LOOK`=0.9 ahead along its motion opens onto a drop of `LEDGE_DROP`=5+, all movement keys are released (`Ledge guard: stopped at ...`, logged at most every 5 s).
- **Safe pickUp**: when the bot stands on the block it is about to dig, it steps to a stand beside it first (`standBeside`); if it cannot and there is a 3+ drop under it (`dropBelow`), the block is left (`Standing on the ... over a N+ drop; leaving it`). After the dig it only walks into the cell when there is ground under it.

## Round 31 (2026-10-20)

Round 30 soak: **all 6 runs valid**, no kick, iron pick on 5 of 6 (normal 451/572/421 s, hard1 1234 s, hard3 1174 s; hard2 none), furnace on all six. One `Ledge guard: stopped` line (hard1, a creeper flee; the collect then completed). One `Standing on the furnace over a 4+ drop; leaving it`. 1 death:
- normal2 `fell from a high place` 105 -> 71 at (342, 71, 29) during `{"type":"ascend","y":137,"forFood":true}`: 80 s of silent pathfinder climbing from a cave at y~58 up a mountainside toward the wood-step stand (y=137), then a 34-block fall. Round 29's hard3 fall also had a food ascend running.

- **Food ascend only underground** (`underSky`): the food rung climbs back toward its anchor only with no sky overhead (head sky light under 12). A bot under open sky is on the surface whatever its height, and grazes from there (the graze floor already lets it stay level).
- **A food ascend ends at open sky** (`GoalSky`): the climb ends at the anchor height or at the first stand with sky light 12+ over its head, whichever is first. An ascend that is already under open sky is done (no `Could not climb` failure). Escape ascends (deep dark, dark) still use `GoalY`.
- **No sprinting beside a cliff**: while the pathfinder walks and sprints, and the cell ahead opens onto a 5+ drop (`dropAhead`, shared with the ledge guard), the sprint key is released each tick (the pathfinder's own listener runs first, so the next physics step walks). No log line.
- **Fall log** (`fallWatch`): every fall of 4+ blocks is logged once: `Fall: dropping from (x, y, z) (job ..., pathing ..., sprint ...)`, from the top of the arc.

## Round 32 (2026-10-20)

Round 31 soak: **all 6 runs valid**, no kick, no fall death, furnace on all six, iron pick on 4 (normal 482/572/361 s, hard1 572 s). One food ascend (normal3, y=94 -> 120, completed, no fall). Eight `Fall:` lines, none fatal; the worst was an explore that dove from y=114 into water (~71) and was down 8 hp by a later sample. **7 deaths, all hard1, all in one night** at its respawn point (x 92-121, z -38..26, y 128-136): a shelter that could not seal (17 open cells), a night pillar knocked down, then six respawns into the same crowd with an empty bag (`Short of shelter blocks: 0 held`), pillar-ups failing at 0/3, walks to dig dirt - shot, blown up, slain.

- **Burrow** (`burrowPlan`, `burrow`, `holdBurrow`): at night (`darkNow`), when the bot holds fewer blocks than even a 1x1 pod needs, or when the box could not be sealed, the shelter job first digs the three cells under the bot's feet and caps the top one from below with a dug block (feet at -3, head at -2, the cap at -1 placed against a side wall). Only where every cell is quick to dig (soil/sand/gravel by hand; stone too with a pickaxe), every wall and the floor are solid, and there is no fluid beside; otherwise `Burrow: not here (...)` and the old flow (dig dirt / box / night pillar). One try per shelter job. The burrow counts as a sealed shelter (Mob Defense off, Food may eat), the cap is replaced if it goes, and at a safe morning the bot digs the cap and pillars out. Lines: `Burrow: dug in at ...`, `Burrow: re-capped`, `Burrow: morning ...; climbing out`, `Burrow: out of the hole ...`.
- **No unlimited water dives**: `infiniteLiquidDropdownDistance=false` on the working movements, so a planned drop into water is capped at `maxDropDown` (3) like one onto land.

Round 32 soak (cut short at 17:29 by a host crash, 37 min into normal1, no report): **the first diamonds** (`Diamonds!` at 17:19, three `deepslate_diamond_ore` mined in the strip-tunnel walls at y=-23, then `diamond_pickaxe` crafted), no deaths. Then a loop: `Autopilot [iron] {"type":"craft","item":"diamond_shovel"}` 42 times in 8 min, each `Missing ingredients or a nearby crafting table`, between `iron failed 3 times deep underground; no cave explore, retrying in 20 s`.

- **Replacement stick counts** match the recipes (`REPLACE_STICKS`: pickaxe 2, shovel 2 - the shovel said 1, so 1 diamond + 1 stick looked payable).
- **A replacement craft that failed 3 times is skipped for 10 min** (`kitSkip`, like the optional stone kit), so the deep-underground retry cannot resubmit it.

## Round 33 (2026-10-21)

Round 32 rerun soak (`4d6baf8`): **0 deaths in all six runs** (round 31 had 7 on hard1), iron pick on 4 (normal 662/361/542 s, hard2 602 s), **a diamond pickaxe on normal2** (5 diamonds, crafted at 1445 s, then one diamond shovel - the shovel loop is gone), one black bed crafted (normal1, never placed). Two `Burrow: not here (open wall beside ...)` refusals (hard2, hard3); both then held a night pillar at hp 20 to morning. Two falls, neither hurt. 1 no-progress, 3 took-too-long. New loop: normal1 submitted `craft iron_leggings` 102 times in its last 14 min (`Missing ingredients: need a crafting table, or 4 planks to make one`, at y=45); the 3-failure skip only covers optional kit and replacements, so the iron step kept returning it.

- **Back to the left table** (`ensureTable`): with no table within 6 and none held, the worker walks back (30 s) to the table it left (`leftTable`, within 32 - the radius the autopilot counts as `worldTable`). If it cannot get within reach it logs `Craft: could not get back to the crafting table at ...; forgetting it` and clears the record, so the ladder stops counting it.
- **Planks before a table craft** (`tableFirst`, applied to every ladder step's job): a craft that needs a 3x3 grid, with no table held, none in the world and under 4 planks, first fetches the planks (logs when short); the worker then makes the table itself.

## Round 34 (2026-10-21)

Round 33 soak (`fb78dde`): 1 death, furnace on all six, iron pick on 4 (normal 361/572/602 s, hard2 512 s), **a diamond pickaxe on normal3** (3 diamonds, at 2408 s), the leggings craft submitted once and completed, every hard night a sealed box at hp 20, hard1's night mine came back to the shelter height with 6 ore items. Two loops/deaths found live:
- normal1 **drowned** at (325, 23, -109) after 90 s in a flooded cave beside its table and furnace: the drowning latch released on each tick the head bobbed dry (300 ms later the smelt, craft or drop resumed in the water), while the server kept snapping the bot back to the same cell (teleport #35 -> #327).
- an underground **`hunt spider` loop** (bow string): `No spider within 24 blocks to hunt` every 8-20 s between `iron failed 3 times deep underground; ... retrying in 20 s`.

- **Drowning latch holds until dry** (`DRY_HOLD_MS`=1.5 s): released at air 18+, or after the head and feet have been out of the water for 1.5 s straight; a wet tick restarts the clock.
- **Out of the water before the job** (`lastDrownAt`, `DROWN_RECENT_MS`=10 s, `leaveWaterFirst`): a job the cadence resumes within 10 s of a drowning escape first runs `leaveWater` (a dry stand within 6). Line: `Reflex: resumed the X job (stepping out of the water first)`, then `Water: stepped out to ...` / `Water: no dry stand within 6 of ...`.
- **Bow and arrows are optional gear** (`gearFor`, `kitSkip`): a spider hunt or bow craft that failed 3 times sets the bow aside for 10 min; a chicken hunt, gravel gather or arrow craft sets the arrows aside. The iron step then goes on to the rest of its kit and counts as done without them. Line: `Autopilot: bow supplies failed 3 times (hunt spider); bow skipped for 10 min`.

## Round 35 (2026-10-21)

Round 34 soak (`5ac411b`): 1 death, furnace on all six, iron pick on the three normal runs (482/602/662 s) and **no hard run**, no diamonds. The drowning loop did not return (one swim-up, air 8, the explore cancelled as a hazard). The bow skip held (`bow supplies failed 3 times (hunt spider); bow skipped for 10 min`, then a gravel gather). Found:
- a **`craft shield` loop** (24 submits, `Missing ingredients or a nearby crafting table`) after the bot topped its planks up with 2 dark oak: 6 planks of two woods, and the plank substitution only used one wood that covered the whole recipe;
- the same loop shape as `iron_leggings` (round 32) and `hunt spider` (round 33): a job that cannot succeed underground, retried in place every 20 s;
- hard3 **`doomed to fall by Skeleton`**: the ledge guard stopped the bot at (139, 106, 75) during a creeper flee, and an arrow knocked it off 0.8 s later (fell to y=80).

- **Mixed-wood plank recipes** (`usableRecipe`/`withSubstitutions`): with no single wood covering a plank ingredient, the cells are filled from every held wood, one id per cell (4 spruce + 2 dark oak make a shield).
- **Climb out after the second deep-underground failure round** (`DEEP_ASCEND_AFTER`=2, `deepFails`): the second time a step fails 3 times deep underground (without a success between), the autopilot submits an escape `ascend` to the surface anchor instead of another 20 s retry. Line: `Autopilot: X failed 3 times deep underground again; climbing to the surface`.
- **Ledge back-off** (`LEDGE_BACK_MS`=400, `LEDGE_AWAY`): after a ledge-guard stop the bot holds the key opposite the one that walked it to the edge for 0.4 s, unless another key steers meanwhile.

## Round 36 (2026-10-21)

Round 35 soak (`dbf9095`): **0 deaths**, furnace on all six, iron pick on the three normal runs (663/542/602 s), **no hard iron** (ore peaks 0/0/1), 1 diamond (normal1, no pick). The shield loop is gone (3 shields, all completed); no ledge stop, no deep-underground climb-out needed; every hard night a sealed box at hp 20. Found:
- hard1 **`smelt chicken` x20** (`Not enough fuel to smelt 1 items`) for 2.5 min - most of its iron window before the shelter;
- the hard runs reach the iron step only around dusk (hard2 at ~570 s), and hard2 then **skipped three iron ores 6-10 blocks away** in the hillside at y=145-150, each `No path to the goal!`.

- **Fuel before a smelt** (`tableFirst`): a smelt job (not a `take`) with no coal or charcoal, under 2 planks and no log, first gathers 4 logs.
- **Tunnel to a near ore** (`tunnelToward`, `ORE_TUNNEL`=10): when the gather's walk to an `_ore` fails and the ore is within 10 blocks of the eye but out of reach, the bot tunnels level (or a staircase step down when the ore is 2+ below) toward it with checked tunnel steps until it can dig it (at most 10 steps). Lines: `Gather: tunnelled N to the iron_ore at ...`, or `Gather: tunnel to the iron_ore at ... stopped (...)`.

## Round 37 (2026-10-22)

Round 36 soak (`1c3196d`): 2 deaths, furnace on all six, iron pick on the three normal runs (542/331/391 s - the fastest normal iron yet), no hard iron pick, no diamonds. The tunnel-to-ore worked (hard3 `tunnelled 3` and `tunnelled 7` to iron ore, raw iron peak 7), and there was no fuel failure. Found live:
- a **spare `stone_pickaxe` loop** (`No clear spot to place a crafting_table`): the kit skip was logged and the iron step's spare pick (`spareStonePick`) was submitted again the next tick;
- normal3 **drowned** at (302, 59, 133): an iron gather walked under a lake to its ore three times, each cancelled as a hazard and re-submitted 0.1 s later;
- hard2 **shot by a skeleton at dusk** (tod ~11200) in a crowd of ~20, an iron gather and a smelt still going out - the shelter only went out at sunset;
- hard3 held **7 raw iron with no furnace** (its furnace left behind): `no kiln (no furnace held)`, then sunset and the box until the run ended.

- **The spare stone pick honours the skip** (`spareStonePick` checks `kitSkip.stone_pickaxe`).
- **Fluid beside the ore is checked before the walk** (it was checked after it), so a gather never swims to an underwater ore; **water costs 4 per cell** to the pathfinder (`LIQUID_COST`, was 1), so routes stay on land.
- **A dusk crowd shelters early** (`nightJobFor(tod,bed,crowd)`, `DUSK_CROWD`=3): from DUSK_PREP (tod 10000) 3+ hostiles within 16 make the night's shelter due now (the same once-a-night job). The worker builds a shelter from DUSK_PREP, and `stillNight` holds a refuge from DUSK_PREP, so a box sealed at dusk is kept.
- **The kiln crafts its furnace**: an ore gather at `smeltAt` with no furnace held but 8+ cobble crafts one (`Gather: crafted a furnace for the kiln`) and smelts while mining.

## Round 38 (2026-10-22)

Round 37 soak (`43a71bd`): 1 death, **the first hard iron pick in three rounds** (hard3 at 512 s, ingots from the furnace step), iron pick on all normal runs (512/572/361 s), no diamonds. The fluid-beside-ore skip held (four skips of one ore), the stone-pick loop is gone, hard2 and hard3 sealed boxes held to dawn (hard1 could not seal: 1 open cell, burrow refused, held at hp 20). No dusk crowd reached 3, so the early shelter did not fire; no kiln furnace craft was needed. Found:
- normal1 **drowned** at (59, 51, 37) after a `[home] deposit` walk toward **(1, -60, 0)** - the flat test world's home, kept in `data/autopilot.json` - four falls down into a flooded pocket, then 56 s with no `drowning` line before the death (the client saw no water at head or feet), every explore `No path to the goal!`;
- an `iron_ore` gather resubmitted 11 times in 13 s, each preempted by the drowning reflex at the same water.

- **A home over `HOME_FAR`=200 blocks away is forgotten** (`forgetFar`): `Autopilot: forgot the home at x,y,z (over 200 blocks away)`; home, homeChest and homeChestAt are cleared and saved.
- **Silent damage is drowning** (`_silentHurt`, `SILENT_HURT_MS`=4 s): two health drops within 4 s with the air under 20, no hostile within 6, no fire or lava and not starving latch the drowning escape even when the client sees no water. Line: `WorldSurvival: losing health with no attacker (air N, head X, feet Y); treating it as drowning`.
- **Any job right after a drowning escape steps out first** (not only resumed ones).
- **Hazard spots** (`markHazard`/`nearHazard`, `HAZARD_NEAR`=8, `HAZARD_MS`=5 min): where a job was cancelled as `led into a hazard`, gathers skip target columns within 8 blocks.

## Round 39 (2026-10-23)

Round 38 rerun soak (`400cfd0`): **0 deaths, no drowning death, no falls**, iron pick on the three normal runs (392/451/422 s), no hard iron pick (hard1 held 4 ingots when its shelter went out), no diamonds. The kiln crafted its own furnace twice; the step-out-of-water held twice; no home walk; every hard box held to dawn. Found:
- `Autopilot: deep dark - climbing out` **53 times** on normal2/normal3: a `surface` log gather submitted from y=-38 had set `lastSurfaceY` to -38, so every escape `ascend` targeted y=-38 and failed at once (`Could not climb toward the surface from y=-38`), then the next gather hit the deep dark again;
- hard1 had **4 iron ingots at sunset** and no iron pick: the shelter went out first.

- **`lastSurfaceY` only under open sky**: a surface gather records its stand-Y only when the bot has sky light 12+ overhead (`underSky`).
- **Escape climbs aim at `escapeY`** = the surface anchor, but never below `ESCAPE_FLOOR`=62.
- **The deep-dark line is logged once per 20-min window** (the escape still runs each time).
- **The sunset grace crafts the iron pick** (`duskKitJob`): with the wood kit done, no iron pick and 3+ ingots, the grace crafts it (sticks, or planks for them, first) before the shelter.

## Round 40 (2026-10-23)

Round 39 soak (`d0f93c1`): 1 death, **hard iron pick on two runs** (hard2 603 s, hard3 512 s - the sunset grace crafted the pick before the shelter on both), iron pick on all normal runs (421/542/331 s), **a diamond pickaxe on normal3** (2107 s). The deep-dark escape loop is gone (0 lines, no escape aimed below 62); the kiln crafted its furnace twice; no stone-pick loop. Found:
- hard1 **slain by a zombie 3 min in, by day**, fleeing ~20 mobs under the dark-forest canopy with planks in the bag: the crowd pillar (`nightRefuge`) only ran after dark;
- a food `ascend` from y=53 resubmitted ~16 times, each `No path to the goal! (empty path ...)`: an enclosed cell, and the food set-aside does not hold when the bot is hungry with no food.

- **Ascend pillars when no path leads up** (`ASCEND_PILLAR`=24): if the walk up gains nothing, the bot pillars straight up toward the target (at most 24 per try), digging a ceiling only when it is not bedrock/obsidian/a container and has no fluid or falling block over it. Line: `Ascend: no path up from y=N; pillaring`. `pillarUp` takes a `maxDigs` option (default `TRUNK_PILLAR`).
- **A big crowd by day pillars too** (`DAY_CROWD`=6): `nightRefuge` returns a pillar by day for 6+ hostiles within 16 (marked `day`). A day pillar (`NightPillarTask` `day`) is not ended by daylight: it comes down after 15 s of quiet on the perch, like a night pillar that is not holding.
