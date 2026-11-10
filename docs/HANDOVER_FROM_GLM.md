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

## Round 41 (2026-10-23)

Round 40 soak (`f73a655`): **0 deaths**, iron pick on **5 of 6** runs (normal 421/361/361 s, hard1 542 s, hard2 602 s - both hard picks from the sunset grace), no diamonds, no drowning, no food-ascend loop. The day-crowd pillar never had to fire. Five escape pillars (`no path up ...; pillaring`): one reached the surface, two climbed the full 24, two gained 0 and 1 with no reason logged. Found:
- normal3 **`smelt raw_iron` resubmitted 18 times**, each `No path to the goal!` to a furnace within 16 it could not reach;
- hard3 never reached the iron step: **two 90 s chicken fights timed out** (`chicken is still standing`) and it held 4 raw iron, 0 ingots at night.

- **An unreachable furnace is swapped** (`smelt`): when the walk to the found furnace fails (no path / timed out / no progress), the smelt places its own furnace here (crafting one from cobble if none is held). Line: `Smelt: no way to the furnace at ...; using one here`.
- **A timed-out hunt rests that species** (`huntOff`, `HUNT_OFF_MS`=3 min): `Fight timed out; <animal> is still standing` makes `animalsNearby` skip that animal for 3 min. Line: `Autopilot: chicken hunt timed out; leaving chickens alone for 3 min`.
- **`pillarUp` says why it stopped**: `Pillar: stopped at y=N (no blocks held | no solid block under the feet: X)`.

## Round 42 (2026-10-24)

Round 41 soak (`38f0561`): **2 deaths, both hard1** (by day fleeing ~20 mobs at 7.5 min; at night shot off a perched pillar), iron pick on the three normal runs (391/572/513 s), **no hard iron pick**, no diamonds. The hunt rest fired (chicken, sheep) and moved on; no smelt loop; no `Pillar: stopped` or `pillaring` line. Found:
- hard1 by day: no pillar line at all - under a dark-oak canopy the leaves leave 2 cells of headroom (`pillarRoom` < 3), so `nightRefuge` refused silently;
- hard1 at night: `Burrow: not here (dark_oak_log ...)`, 47 s of dirt digging to a new spot, `a 1x1 pod would need 13` with 12 held, the night pillar, the ring - then `shot by Skeleton` 78 s later (and `losing health with no attacker` fired after a knock-off under arrows).

- **Day pillars may be 2 high** (`nightRefuge`): by day the pillar needs 2 blocks and 2 cells of headroom (`height` = room, at most 3); at night still 3.
- **A declined pillar says why**: with 6+ hostiles within 16 and no pillar, `Night: no pillar for N hostiles (blocks B, room R, onGround G, fluid F)` (once per 10 s).
- **The perch is walled** (`NightPillarTask._walls`): after the overhang ring, the 4 side cells at the feet and then at the head go up on the deck, so an archer has no line but from above. Line: `Night: walled the perch N/8 (archers have no line but from above)`.
- **Silent damage needs no hostile within 24 and no fall in the last 2 s** (`SILENT_HOSTILE`, `SILENT_FALL_MS`) before it counts as drowning.
- **A burrow per spot** (`burrowAgain`, `BURROW_MOVED`=3): the shelter tries a burrow again where it now stands once it has moved 3+ blocks from the last try, including right before a pod-short night pillar.

## Round 43 (2026-10-24)

Round 42 soak (`0fa4984`): **0 deaths**, no loop, no kick, iron pick on the three normal runs (482/813/572 s), **no hard iron pick**, no diamonds. No pillar was needed (no night pillar, no day crowd during a run); every hard night sealed a box (a burrow only runs when short of blocks or the box will not seal, so none logged). Found: hard1 and hard2 spent ~3-3.5 min of the afternoon on chicken and sheep fights that timed out (90 s each) **with the food bar full**, then the iron gather was cut off by the shelter (hard2 11 s in); hard3 was still on the stone kit at dusk.

- **Iron before food in the afternoon** (`foodDone`, `IRON_FIRST_BAR`=18, `IRON_FIRST_TOD`=5000): with no iron pick yet, from tod 5000 to sunset, a food bar of 18+ and health not low, the food step counts as done and the ladder goes on to iron. Hunger, low health and a nearly empty bar still bring it back. The normal runs' frozen morning (tod under 5000) is unchanged. `ctx.tod` is now passed to the plan.

## Round 44 (2026-10-24)

Round 43 soak (`325acd9`): 2 deaths, **hard iron pick on two runs at 391 s and 421 s** (the earliest yet - the iron-before-food rule fired), iron pick on normal1 and normal3 (572/602 s), 1 diamond. Found:
- normal1 **slain by a warden** at (148, -45, 47): the deep-dark escape reached y=-19, then the furnace batch at 148,-44,45 (beside the sculk) walked it back down; Mob Defense fled (no line) and lost;
- hard3 **fell 22** (150 -> 128) during a creeper flee, `pathing true` - no ledge line, cause not in the log;
- normal2 **stranded the whole run** at (369, 137, 35): 153 iron gathers and 75 explores, each `empty path ... 3 nodes` - a 3+ drop into a cave on every side (the descent refused too), no iron pick.

- **The deep dark is marked** (`markDeepDark`, `DEEP_DARK_AVOID`=32, `DEEP_DARK_MS`=30 min): a job ending `Deep dark` records the spot; a furnace batch within 32 is given up (`Deep dark: giving up the furnace batch at ...`), and gathers skip target columns within 32 of it (`nearHazard`).
- **Fleeing a universally dangerous mob logs it**: `Reflex: fleeing warden (universally dangerous)`.
- **Stranded stands may drop 6** (`STRANDED_DROP`=6, `STRANDED_HEALTH`=12): after the mob-avoidance retry and the stair-out, a search that never left 0-3 nodes paths once more with `maxDropDown` 6 when health is 12+ (3 damage at most), then restores it. Line: `Navigation: stranded at ... (drops on every side); allowing drops of up to 6`.

## Round 45 (2026-10-24)

Round 44 soak (`91de340`): **iron pick on all six runs** (normal 421/481/452 s, hard 361/451/421 s - the first time every run reached it), 1 death (hard2 shot by a skeleton 50 s after the last log line, gathering wood by day under the canopy; no Mob Defense line in those 50 s - open), no diamonds. Found: the stranded 6-drop retry fired 87 times and never left a stand by itself (the ascend pillar did, twice); at (359, 101, 129) a food explore's `surfaceFloor` was the bot's own y, so the 6-drop search still saw 1 node, 56 times to the end of normal2.

- **The stranded retry lowers the surface floor too** (`surfaceFloor` - 6 for that try; the explore's floor exclusion now reads the live floor), then restores it.
- **Still stranded: pillar up 3 and path again** (`STRAND_PILLAR`=3): if the 6-drop try also finds no path, the bot pillars up 3 (digging a ceiling only with no fluid or falling block over it) and paths once more from the top. Line: `Navigation: still stranded at ...; pillaring up 3`.

## Round 46 (2026-10-24)

Round 45 soak (`78b1ad8`): **0 deaths**, iron pick on the three normal runs (602/632/602 s) and hard1 (422 s); hard2 and hard3 none, no diamonds. The stranded retry plus the 3-block pillar left most stands (48 stranded, 23 pillar lines); the one that never left was (444, -47, 267) at the end of normal2, and three pillars stopped on `no blocks held`. Found: **hard2's iron gather never ran** - from about t=320 a creeper under the canopy was fled every second (`fleeing creeper (never melee a creeper)`, the gather preempted and resubmitted) until the shelter, ore 0.

- **A lone creeper that keeps following is fought** (`CREEPER_PERSIST`=20 s): the same creeper (by id, ticks no more than 5 s apart) within 10 for 20 s, with the fight policy allowed (armed, health), 2+ pillar blocks held and no other hostile within 6, gets a `FightTask` instead of another flee - the combat controller's creeper tactic (pillar up, strike or shoot from the top; 0 damage in every combat run). A swelling creeper still sprints away first. Line: `Reflex: a creeper has followed for N s; fighting it from a pillar`.
- **Job walks sprint** (`normalMovements.allowSprinting=true`): every job walk uses the normal movements, which had sprinting off since the first import, so the bot walked everywhere at walking speed (explore and some gather walks already sprinted). The round-31 ledge guard still lets go of the sprint key beside any 5+ drop, and sprinting stops by itself at a food bar of 6 or less.

## Round 47 (2026-10-24)

Round 46 soak (`8a1d4bb`): **0 deaths**, iron pick on 5 of 6 (normal 512/452/391 s, hard1 391 s, hard2 512 s; hard3 none), no diamonds. The followed-creeper handoff fired once (hard3): the combat controller spaced in melee (no pillar), stopped after 4.5 s with 0 hits and 0 damage. The live watch caught `smelt porkchop` count 2 x16, `Not enough fuel to smelt 2 items`. Sprinting could not be confirmed from the 30 s samples: the pathfinder only presses sprint when its simulation clears a straight sprint line (`canStraightLine(path, true)`), and the ledge guard releases it beside drops.

- **Fuel must cover the count** (`fuelBurns`): a smelt (not a `take`) whose held fuel smelts fewer items than its count (coal/charcoal 8, planks/logs 1.5) gathers 4 logs first.
- **The sprint share is logged** (`gaitTick`, every 5 min): `Movement: sprinting N% of S s of pathfinder walking (food F)`.

## Round 48 (2026-10-25)

Round 47 soak (`f1a2d89`): **0 deaths (hp 20 on every sample)**, iron pick on 5 of 6 (normal2 572 s, normal3 963 s, **all three hard runs** 392/422/573 s), no diamonds. **Sprinting works**: 28 `Movement: sprinting` lines, about 50-60% of pathfinder walking time per run (the pathfinder sprints only where its straight-line sprint check passes; the ledge guard releases it by drops). The fuel loop did not return. Of 288 `Tool left the inventory` lines only 10 were breaks; the bursts are inventory moves with uses left. Found: **normal1 stood stranded at (313, 112, 51) for the run** - the 6-drop retry still saw 1 node, and the pillar stopped on `no blocks held`: job walks use the normal movements, which never dig, so a bot walled in by blocks had no way out.

- **The stranded retry may dig** (`canDig` on for that one try, restored after): a walled-in stand can tunnel out, and the dug blocks feed the pillar. Line: `Navigation: stranded at ... (drops on every side); allowing drops of up to 6 and digging`.

## Round 49 (2026-10-25)

Round 48 confirmation soak (`f2fbdab`, same code): **iron pick on all six again** (normal 392/542/512 s, hard 482/452/422 s), 1 death, no diamonds or bed this time. Found:
- normal1 **slain by a warden** at (364, 3, -111): a deep-dark escape ascend was paused by the warden flee, a junk drop submitted the same second superseded it, and the bot stood dropping cobble until it died 43 s later;
- normal2 stood **17.5 min at (272, 54, 20)**, hp and food 20, with 556 `Misc World Survival Chain engaging` and 517 server snaps: the stale-air backstop (round 21, for an air reading that never arrives) kept firing on a head in water with the air at a full 20.

- **A warden near: only climbing out** (`WARDEN_NEAR`=48, `wardenDistance`): the autopilot submits an escape ascend if none is running, queued or paused, and nothing else - a paused ascend is left to resume. Line: `Autopilot: a warden N away; climbing out, nothing else`.
- **The stale-air backstop stands down at full health** (`BREATHING_MS`=30 s): after 30 s with the head in water and health still 20 it no longer fires (drowning would have cost health by then); losing health brings it back.
- **Every World Survival band logs what it saw** (`_bandLog`, at most every 10 s): `WorldSurvival: in lava / on fire / head in a wall ... at (x, y, z) (head H, feet F)`.
- **A new soak world** (`tests/soak.py`, `SOAK_SEED`, default `8675309`): the soaks through round 49 all ran on seed 12345 (a dark forest). The default is now a new seed in whatever biomes it generates. For any seed but 12345 the scout starts from the bot's spawn: the hard anchor is the first stand (the spawn, then explore legs) where a 3-log gather completes, at any light; the normal anchor is an open-sky stand found by explore legs. `SOAK_SEED=12345` brings back the measured dark-forest anchors.

## Round 50 (2026-10-25)

The round-49 soak on the new seed was stopped in normal1: from 16:15 the iron gather failed every few seconds with `Inventory nearly full; deposit items first (stone_pickaxe:2 furnace:1 wooden_sword:1 ... wooden_axe:1 brown_wool:1 ...)` - a bag of single kit items, nothing droppable, crafting paused for the full bag so no chest either. The user also saw the bot dig dirt with an axe.

- **No tool better than a hand: hold something that does not wear** (`toolWear.js` `handItem`, `beatsHand`): with no shovel, the pathfinder's `bestHarvestTool` and mineflayer-tool's `equipForBlock` took the first item at the hand's speed (often the axe). Now, when no tool beats the bare hand for the block, an item without durability is held (dirt, cobble, food...); with none, the hand. A shovel on dirt (or any faster tool) is still used.
- **Obsolete tools are junk** (`obsoleteTool`): a wooden or golden tool is surplus and droppable once a stone-or-better tool of the same kind is held, so a full bag of kit always has something to drop.
- **The wood step accepts any tier** (`anyTier`): done with a pickaxe, sword and axe of any tier (and a table); it crafts a wooden one only when no tool of that kind is held - dropping the wooden tools no longer sends the ladder back to craft them.

## Round 51 (2026-10-25)

The round-50 soak (seed 8675309): iron picks on 4 of 6, 2 deaths - normal3 fell 36 blocks on a sheep-search explore that started at y=22, hard2 was killed by a spider in a cave crowd at y=40 after its crowd pillar was knocked off at 1.4 blocks. Wooden tools stayed in the bags beside stone and iron ones (they are dropped only when the bag is full).

- **Storage: the bot puts what it earns away in chests at its base, by category** (`src/storage.js`, worker `store` job).
  - A ledger (`data/ledger.json`) counts what the bot earned from the world: items picked up (`playerCollect`), crafted, and smelted. Items a server command handed over (`/give`, the soak's steak) never enter it, so they are never stored. The ledger is clamped to the bag (a death or `/clear` empties it).
  - `storePlan` stores earned items above a working set the bot keeps on it (cobble 32, dirt 16, coal 8, sticks 8, planks 8, food 8, arrows 32). Tools, armour, the bed, shield, buckets, torches, tables, furnaces and chests are never stored - except a wooden or golden tool with a better tier of the same tool held, which goes in the `tools` chest.
  - Categories: wood, stone, metal, food, drops, tools, misc. One chest per category on a storage row beside the home (`storageSpots`: 2 to the side, every second block); a category with no chest, or only full ones, gets a new chest (crafted from 8 planks when none is held).
  - `data/storage.json` (`StorageIndex`) records each chest's category and contents as last read; `find(item)` and `totals()` answer where things are. Chests more than 32 from the base, or no longer a chest, are forgotten.
  - The autopilot submits `{type:'store'}` instead of a drop/deposit when the bag is full, the home is within `HOME_DEPOSIT_RANGE`, and the plan is not empty (`canStore`). Away from home the old drop/deposit path runs.
- **A sheep search from deep underground climbs out first** (`sheepSearchJob`): with no sky overhead and 16+ below the surface anchor, the bed's search explore becomes an ascend to `escapeY(lastSurfaceY)`.
- Not changed yet: the cave-crowd pillar failure (a burrow when a pillar fails underground with a pickaxe is the candidate), and the 11 unreachable deepslate-diamond tries 20 below the bot on normal2.

## Round 52 (2026-10-25)

The round-51 soak: iron picks on 3 of 6, 2 deaths. normal1 and normal2 lost about 28 minutes each to a store loop: the bag was full near home, no chest was held and the bag had 7 and 3 planks, so every `store` logged `no chest for <category>` for all six categories and was submitted again a second later (1600 and 1686 times). Both deaths (hard2 creeper, hard3 zombie) were in the same cave under the spawn, y 36-40, where round 50's hard2 also died: 20+ hostiles, crowd pillars knocked off.

- **The store no longer loops.**
  - With no chest held and under 8 planks, planks are crafted from a held log (or stem) first, then the chest.
  - A store that put nothing away sets `storeIdleUntil` (`STORE_RETRY_MS`, 5 min); `canStore` is false until then and the old drop/deposit path runs.
  - One `no chest for` line per store, with the exact reason (`no chest held, N planks, no logs for more`, `could not craft ...`, `no free spot on the storage row`); the other categories without a chest are skipped.
- **The ledger follows the bag**: `earn` clamps it to the held counts before adding, so deaths and the soak's per-run clears empty it (round 51's file had cobblestone 1439).
- **Mob caves** (`mobCave`, worker `markMobCave`): a crowd of `MOB_CAVE_CROWD` (6)+ hostiles within 16, no sky, and the bot 8+ below `escapeY(lastSurfaceY)` marks a mob cave for `MOB_CAVE_MS` (20 min). `nearHazard` covers `MOB_CAVE_AVOID` (24) around it, so the ore search skips its ores, and the autopilot climbs out (`escape` ascend) once per new cave.

## Round 53 (2026-10-26)

The round-52 soak: iron picks on 4 of 6 (normal 633/633/602, hard1 391), the store loop is gone (3 store submits, longest streak 1, the old drop path ran within 2 s of each), but no storage chest was ever placed (`no chest held, 1-2 planks, no logs for more`). No `a mob cave` line all soak: both deaths were again in the cave under the spawn (y 39-40, 97-122 hostiles in the flee lists). normal2 re-submitted a shield craft 48 times: its table placement failed on every try with `cell is pink_petals`.

- **Mob caves are checked where the bot is** (worker `mobCaveHere`): from the gather loop (beside the deep-dark check) and the explore watcher, not only on autopilot ticks between jobs (round 52's check never ran while a gather walked the bot down into the cave). `MOB_CAVE_CROWD` (6)+ hostiles within `MOB_CAVE_NEAR` (24), no sky over the head, 8+ below `escapeY(lastSurfaceY)`: the cave is marked and the job fails with `Mob cave: ...`; the autopilot logs `Autopilot: a mob cave (...)` and climbs out (`escapeDark` ascend).
- **Morning in a cave shelter climbs out through the roof** (`caveMorning`): a sealed box with no sky over it and `CAVE_EXIT_CROWD` (3)+ hostiles within `CAVE_EXIT_NEAR` (24) is left with an ascend from inside, and the cave is marked; only when the climb gains under 3 blocks does it open up as before. (Round-52 hard2 opened up at tod 455 with the nearest hostile 16.3 away and died 26 s later.)
- **Flowers and fixtures are not placement cells** (`place-support.js` `PLACE_BLOCKER`): saplings, mushrooms, flowers, pink petals, wildflowers, leaf litter, berry bushes, cane, torches, signs, buttons, rails, carpets... are refused by the server, so `placeableInto` skips them; only grass, ferns, dead bushes, vines, snow layers, seagrass and fire are replaced. Petals and the common flowers joined `SOFT_BREAK`, so a placement with no free cell clears one by hand.
- **The first storage chest's logs are chopped** when the bag has 3+ free slots and the held logs and planks cannot make 8 planks (`Store: no chest and N planks; chopping K logs for one`).

## Round 54 (2026-10-26)

The round-53 soak: **0 deaths**, iron picks on 4 of 6 (normal 602/692/783, hard3 602). One mob cave was logged (hard1, `6 hostiles within 24 at (1, 52, 96)`), and the bot did not die there - but its climb out was cancelled 39 s in for the night shelter, which sealed at y=57 in the cave column, and the night mine walked back down it. The one store ran with 1 free slot, so the log chop never ran. All six runs ended with wooden tools beside better ones. One table placement failed on `lilac`.

- **An ascend finishes before the night shelter** (`busy` in the night branch includes `ascend`): the shelter is submitted on the next tick after the climb.
- **No night mine from a box in a marked hazard** (`nearHazard`, which covers mob caves and the deep dark).
- **A full bag makes room for the storage chest**: with under 3 free slots and no logs or planks for a chest, spare wooden and golden tools (`spareTool`: a better tier of the same tool held) are tossed first (`Store: tossed a spare ...`). The store skips plan items that are no longer held, and only counts what it actually moved.
- **Tall flowers** (lilac, rose bush, peony, pitcher plant) joined `PLACE_BLOCKER`.
- Not changed yet: hard1/hard2 held 2-3 ore and never smelted before night; normal3 was boxed in under a ceiling at (-75, 59, 36) for its last minutes (`Pillar: ceiling`, `no way to stair out`); normal2's diamond trip lost the iron pick at y=-52.

## Round 55 (2026-10-26)

The round-54 soak: iron picks on 4 of 6 (normal 632/1144/663, hard1 602), 4 deaths - three drownings (normal1 at (48, 60, 76), normal2 at (13, 47, -8): air 8 to 0 in 20 s of `swimming up`, normal3 at (125, 53, 80)) and hard2's zombie in the spawn cave. The round-54 escape ascend worked (hard1's mob-cave climb from y=48 finished on the surface and its shelter sealed 46 blocks away). hard2's dusk box at y=41 sat 2 blocks over the cave: its night mine opened onto it at y=39, the bot could not get back in, the re-seal had 1 open cell, the pillar failed. Storage: 5 stores, none put anything away - `could not craft a chest (Missing ingredients or a nearby crafting table)` with 8 planks and no table, and `no free spot on the storage row` / `occupied by pink_petals`.

- **Drowning goes straight up when it can** (`get-out-of-water-task.js` `waterAbove`, `headUnderWater`, `UP_FIRST_AIR` 12): with the air at 12 or less and the head under water, open water up to air means the land leg is dropped and the bot holds jump with no forward (`WorldSurvival: open water N up (air A); swimming straight up`); a solid roof right over the head (not lava-capped, not bedrock/obsidian/spawner) is dug (`roof over the water ...; digging it`). The column scan runs at most 4 times a second. With more air the land search runs as before.
- **No night mine from a deep box** (`deepBox`): no sky over the box and 8+ below the surface anchor (with no anchor yet it is allowed). Surface boxes night-mine as before.
- **The `Shelter: dawn` line** waits for a dark spell (`job.sawDark`); a dusk box no longer logs dawn at tod 10177.
- **The first storage chest**: with no table held or within 6 it needs 12 planks (the table first), and the chop/plank craft aims for that. A failed chest craft is the logged reason. Storage spots may sit one block up or down the slope, and grass, flowers or petals on a spot are broken by hand before the chest is placed.

## Round 56 (2026-10-27)

The round-55 soak: iron picks on 3 of 6 (normal 602/542/602; no hard run smelted an ingot), 1 death (normal1 drowned at (105, 59, 77)), 3 diamonds on normal3. **Storage worked for the first time**: normal3 placed a stone and a metal chest and put away cobble, dirt, granite, diorite, gravel, flint - and 8 coal, 3 iron ingots and 1 raw iron the ladder still needed. No `open water N up` line all soak. hard2's mob cave was followed 38 ms later by the night shelter sealing on the mark; the escape was never submitted. normal1 re-submitted `craft shield` 18 times in 4 min (`Missing ingredients or a nearby crafting table`, a table in reach).

- **Mixed planks craft** (worker `recipeVariants`): mineflayer's `recipesFor` only returns the variants the bag pays for as they are, and the shield (and table) have one variant per wood - so 3 oak + 4 birch planks got none and the round-35 mixed-plank fill never saw a recipe. With none, `recipesAll` goes to `usableRecipe`.
- **Drowning straight up, whatever the air reads** (`get-out-of-water-task.js`): `bot.oxygenLevel` is in ticks (0-300) on this server, so the round-55 `air <= 12` gate never opened (`air 8` read 120), and normal1 drowned with a stale 17.8. The head under water with open water up to air is enough now; the air (normalised like the chain's `airOf`) is only logged.
- **A pending mob-cave escape goes before the night shelter** (both night branches): `escapeDark` submits the ascend first.
- **Storage keeps the progression materials** (`storage.js` `KEEP`): iron ingots and raw iron 40, diamonds 24, gold 8, coal and charcoal 16 stay on the bot.
- Not changed yet: the hard runs mine 0-1 ore and never smelt before night; hard1's escape climbed straight back above the cave and its night box sealed 19 blocks from the mark at y=52.

## Round 57 (2026-10-27)

The round-56 soak: **iron picks on 6 of 6** for the first time (normal 784/542/542, hard 512/512/512), 1 death (normal1 drowned at (118, 13, 102)), shields crafted on every submit, hard1's mob-cave escape finished on the surface and its night box sealed 27.7 blocks from the mark. normal1's drowning: the bed-rung ascend pillared into water at y=14, the water chain dug the roof, then let go 7 s in on a stale `air 20` with the head still under; the resumed ascend pillared in the water and the bot drowned 5 s later. Every run ended with a wooden pick, axe and sword beside stone and iron ones. normal2's store could not craft planks (`No room for crafting result`); normal3 placed one stone chest, then `no chest for misc` / `no chest for wood` on three stores. hard2's sealed box at y=71 (surface 64) read as a `morning in a cave`.

- **The drowning latch holds while the head is under** (`worldSurvivalChain.js`): air 18+ releases it only with the head out of the water, or after `BREATHING_MS` under at full health (round 49's stale-20 stand that really was breathing).
- **Spare tools are dropped when the better one is crafted** (worker `tossSpareTools`, after every craft): a stone-or-better tool drops the wooden or golden one of the same kind, marked as dropped junk so it is not picked back up.
- **A free slot for the chest's planks** (worker `newStorageChest`): a full bag with no plank stack tosses a spare tool, else the biggest stack of granite/diorite/andesite/tuff/calcite/gravel.
- **Overflow storage** (worker `store`): a category with no chest, when no new chest can be made, goes into any storage chest with room; that chest keeps its own category.
- **Cave mornings only under the surface** (`caveMorning`): a box at or above the surface anchor minus 2 is not a cave (a sealed box reads sky 0 anywhere).
- Not changed yet: the stone shovel's 3-then-skip (`Missing ingredients`) on normal1 and normal3 with 6-8 planks and 4 sticks; no bed slept in; hard3 sealed on an expired mob-cave mark; no diamonds.

## Round 58 (2026-10-27)

The round-57 soak: iron picks on 5 of 6 (normal 874/904/753, hard 482/none/602; hard2 sealed its night box before smelting), 2 diamonds on normal2, 1 death (normal2 burned in lava at (93, 67, 139), 10.5 s after `in lava; escaping`, nothing logged in between). The drowning latch was not exercised. Wooden tools were dropped on every stone and iron craft, but every run still ended with a wooden tool beside a better one (a later wood step made another, or the bot walked over the dropped one). `stone_shovel` failed 3 times and was skipped, three times on normal2: the sword and the axe just before it took 3 of the 4 sticks. normal3's home chest hit `Cannot place at (73, 78, 154): occupied by pink_petals` six times. Storage made a stone chest and a misc chest on normal2; nothing under the keep amounts went in.

- **Lava escape that changes course** (`escape-from-lava-task.js`): the target is logged (`Lava: heading for x,y,z`), a target the bot gains no ground on in 1.5 s is skipped for the next one (`findSafeBlock` takes a skip set), and forward stays held even with no target (`no safe block within 16; scrambling forward`).
- **Sticks before the craft** (worker `craft`): a recipe short only of sticks, with 2+ planks held, gets 4 sticks crafted first, once per job (`Craft: <item> needs N sticks and M are held; crafting 4 first`).
- **Every spare tool goes** (worker `tossSpareTools`): a stone-or-better craft drops every wooden or golden tool that has a better one of its kind held, not only the kind just made.
- **Place breaks a plant in the cell first** (worker `place`): flowers, petals, saplings (`PLACE_BLOCKER`, not torches, signs, rails, buttons, plates, banners, carpets or redstone) are broken by hand.
- Not changed yet: the hard runs' night boxes seal back underground near the mob-cave marks after the escape reached the surface; a dropped tool can still be walked over and picked up; no bed slept in; no diamond pick.

## Round 59 (2026-10-27)

The round-58 soak was the first on a new seed, **6274947974391380586** (the Nitrous world's seed; spawn [712, 69, -431], hard anchor [777, 71, -344], normal anchor [863, 69, -236]). Normal runs: iron picks on all three (543/603/813), beds held on normal2 and normal3, four storage chests on normal2 (stone, misc, wood, drops). **Hard runs: no stone pick on any of them.** Every wood gather from the y=71 hard anchor ended `Navigation left the surface` (the ground rolls down to y=61-66), the search legs aimed again and again at an oak trunk at (721, 70-74, -378) that has no path (22 `wood failed 3 times`), and the harness returned the bot 12 times for being 8 below the anchor. hard2's box at y=101 logged `re-sealing 7 open cell(s)` 100 times in 11 min. hard3 spent its last minutes at health 2.8 with no food. No deaths, no lava; both sticks-first crafts completed; dropped wooden tools were still walked back over and picked up.

- **Rolling ground is still the surface** (worker `openSurface`, the navigate monitor): below the wood step's floor (start - 4), a bot under open sky (head sky light 12+) keeps going, down to `SURFACE_SLACK` (8) more. A ravine deeper than that still stops the walk.
- **An unreachable log takes its trunk with it** (worker `gatherFailed`): the column (y-8..y+8) goes into the shared blacklist for `GATHER_BLACKLIST_SECONDS` and the job's bad columns, so the next job's search leg does not aim at it.
- **A re-seal that closes nothing says why and backs off** (worker `guardShelter`): `Shelter: re-seal left N open (<error>; M blocks held); next try in 15 s`.
- **Harness** (`tests/soak.py`): the wood-step return fires 14 below the anchor, not 8.
- Soak seeds rotate from now on (a new world each round); round 59 runs on seed 20261027.
- Not changed yet: food on hard runs with no animals in reach; dropped tools picked back up; no bed slept in; no diamond pick.

## Round 60 (2026-10-27)

No soak between rounds 59 and 60 (the round-59 soak had not started). Two changes from the user:

- **One seed from now on**: the soak stays on seed **20261027**; the rotation ends with it.
- **Night skip** (user request): a sealed night no longer has to be waited out in real time.
  - Bot side (worker `shelterReport`, `noteShelter`): `observe` now carries `shelter` (`{kind:'box'|'burrow', safe, seconds, gaps}`) and `tod` (ticks). The safe clock runs while the bot stands in its box cell (or burrow hole) with no open gap (`guardShelter` records `shelterGaps`), no hostile inside the box (`shelterIntruder`) and the burrow cap on. Leaving the cell, a gap, or any unsealing (a night mine, the morning) restarts it: `shelterSealed` is an accessor whose `false` clears the clock.
  - Harness side (`tests/soak.py`, `NIGHT_SKIP_SECONDS`, env `SOAK_NIGHT_SKIP`, default 150, 0 disables): at a sample where the shelter reports safe for 150+ s and tod is 12000-23499, the operator runs `time add` up to tick 1000 of the next day (the day counter advances like a slept night, so the next night's once-per-day plans still fire). The bot then sees the morning and opens up through its normal exit (`leaveRefuge`: waits for hostiles to clear). Each skip is an intervention line and a `night_skips` entry; the summary has `night_skips` per run.
  - The bot never changes the time itself; only the soak's console fixture on the private test server does.
- Not changed yet: food on hard runs with no animals in reach; dropped tools picked back up; no bed slept in; no diamond pick.

## Round 61 (2026-10-27)

From the user, watching the round-60 soak: the bot was breaking blocks with dirt in hand. The pillar dug its ceiling with whatever was held, which was the pillar's own dirt. The burrow's climb-out cap, the water escape's roof and the flint gravel had the same gap. The live log also showed `no path up from y=12; pillaring` then `y=12 -> 12` 22 times in a row, with no Pillar line saying why.

- **Dig with the best tool** (worker `digWith`): `equipForBlock` before the dig. Used for the pillar ceiling, the burrow cap, the flint gravel (`collectMining.js`) and the roof over water (`get-out-of-water-task.js`).
- **A pillar that never rises says so** (worker `pillarUp`): `Pillar: no rise in 3 jump-places at y=N (held X, under Y, head Z, above W)`.
- Not changed yet: why that pillar at y=12 never rose (the next soak's Pillar line will say); `Tool left the inventory` lines for tools still in use (stone_pickaxe 131 uses, stone_axe 116) during navigation - possibly an equip-swap false alarm in `watchToolLoss`.
- **Provoked mobs** (`src/provoked.js`, round-60 soak: `BuilderBot was slain by Polar Bear` at (72, 76, 202), with no Mob Defense line first; minecraft-data files polar bears under passive mobs): any mob that hurts the bot (`entityHurt` with a source) counts as hostile for `PROVOKED_MS` (60 s), logged as `Threat: <mob> at P hit the bot; treating it as hostile for 60 s`. An adult polar bear within 12 of the bot, with a cub within 16 of it, counts on sight. Used by `getHostiles` (Mob Defense) and the shelter's `nearestHostile` / `hostilesWithin`.

## Round 62 (2026-10-28)

The round-60 soak on seed 20261027 (spawn [-42, 66, 129]; hard anchor [-49, 66, 106] under spruce; normal anchor [74, 77, 203] on snowy spruce ground): **iron picks on 6 of 6** (normal 452/723/935, hard 483/1176/1054). Diamonds 0, no bed. One death: a polar bear at the normal anchor (normal2), fixed in round 61. **The night skip worked on all three hard nights**: each box was safe 154-158 s, the skip fired at tod about 15200, and the boxes opened 0.07 s, 0.5 s and 20 s later (the 20 s one waited for a hostile at 20). There was no damage after any of them. There were no re-seal loops and no harness returns from below the anchor; one trunk was skipped and was never aimed at again.

- **No retreat from harmless prey** (worker `harmlessFight`, used in `combatTask`'s health guard). normal3 ended at health 1 and food 0, with `Health below 8; retreated from chicken` 47 times in 13 minutes: it kept running from the hunt that would feed it. A chicken, cow, pig, sheep, rabbit or mooshroom that has not hit the bot no longer triggers the retreat, as long as no hostile is within `PREY_SAFE` (10).
- **Spare blocks for the canopy pillar** (worker `pillarToLog`). There were seven `Pillar: stopped at y=N (no blocks held)` lines, because the dirt was dug to the exact rise. It now digs `PILLAR_SPARE` (2) more.
- **A search target that is never reached gets skipped** (worker `searchMiss`). normal3 had seven `wood failed 3 times`, and every search leg aimed at the logs at 4,77,212 and ended `Navigation left the surface`. That failure never produced a skip line, so the column was never blacklisted. Now a leg that ends more than 24 blocks short of its target counts as a miss, kept across jobs. After 2 misses the column (y±8) is blacklisted for 10 minutes: `Gather: the search target at X was missed 2 times ...; its column is skipped for 10 min`.
- Not changed yet:
  - Wooden tools still come back. hard3 dropped its wooden sword and axe, and the end bag 27 s later held both again.
  - normal1's iron pick broke in a deepslate tunnel. It fell back to wooden and stone picks, then looped on `Ascend: no path up from y=12` 13 times; round 61 makes the pillar say why.
  - About 100-330 `Navigation: no path with mob avoidance` lines per run (noise).
  - No bed was slept in, and no diamond pick.
- **Obstruction probe** (`tests/obstruct.py`, user request): 11 scenarios on the flat test world, each on its own patch at x = 2000 + 100·i, cleared again afterwards:
  - **Walls:** a cobblestone wall; a 61-wide plank wall; the same plank wall with an oak door.
  - **1x2 cells:** cobblestone with a pickaxe and bare-handed; oak planks; glass.
  - **Pit:** a 1x1 pit 3 deep.
  - **Chest spot:** a chest spot taken by cobblestone, and one taken by a poppy.
  - **Shelter hole:** a night shelter with a wall block knocked out after it reports safe.
  - **Output:** `data/obstruction-results.json` holds the job status, message, time, end position, the bot's own lines and any error repeated 3+ times.
  - **Smoke run:** cobble wall done in 4 s. Poppy spot: broke the poppy, chest placed. Plank box: out in 12 s. Shelter hole: re-sealed in 4 s, and the box opened 0 s after morning. On flat ground the night mine dug to bedrock and could not climb home, so the bot built a second box.

## Round 63 (2026-10-28)

The round-62 soak on seed 20261027. The world was regenerated: spawn [-23, 66, 122], hard anchor [-50, 65, 103], normal anchor [-133, 63, 258].

**Results**
- **Iron picks:** 5 of 6 (hard3 had none). Diamonds 0, no bed.
- **Death:** one, normal1 drowned under a frozen lake.
- **Round-62 fixes that held:**
  - No canopy pillar ran out of blocks.
  - The missed search target was skipped once and never aimed at again.
  - `wood failed 3 times` was 0 (round 60 had 7).
- **Night skip:** fired once (hard1 at tod 15202, after 157 s safe). The box opened in the same second with no damage after. hard2 and hard3 started a night mine within 30 s of sealing, so their safe clocks never reached 150 s.
- **Obstruction probe:** 9 of 11 passed. The two failures were the expected ones:
  - The bare-handed cobblestone cell failed once and cleanly, with the tool message.
  - The chest spot taken by cobblestone was refused with `occupied by cobblestone`.
  - The bot went round all three walls; door opening is off.
  - It got out of every cell it had a tool for in 10-12 s.
  - It dug 3 steps out of the pit.
  - It broke the poppy and placed the chest.
  - It re-sealed the knocked-out shelter block in 4 s.

**Fixes**
- **Ice over the head** (`EscapeSuffocationTask.diggable`):
  - **What happened:** normal1 swam into a one-high water gap under a frozen lake and logged `head in a wall (head ice, feet water)` for 22 s. Ice was not on the dig list, so the wall band (priority 100) kept shimmying sideways under more ice. The swim-up (97) never ran, and the bot drowned.
  - **Fix:** ice, packed ice, blue ice and frosted ice now dig bare-handed. Broken ice over water turns to water, which opens the way up.
- **Hunting at low health** (worker `harmlessFight` and `harmlessTarget`; the combat controller's `spareRetreat`):
  - **What happened:** normal2 logged 9 `retreated from pig` and 25 `retreated from the fight`, every one with hits 0. It reached food 0 and ended at health 0.6. Round 62's guard ran before the controller had locked a target, so the prey check saw no target. The controller's own health-8 gate also backed off from the pig whatever the guard said.
  - **Fix:** the job's entity now names the prey until a target is locked. Fight and hunt jobs pass `spareRetreat` so the controller fights harmless prey at any health, provided no hostile is within 10.
- **A stale container window** (worker `closeStaleWindow` at job start; `guardEquip` retries once):
  - **What happened:** hard2's night-mine walk home, its new box and the night pillar all failed at once with `invalid operation`. That is mineflayer's window-click assert, raised when an inventory slot is clicked while a container window is still open; the furnace take was cancelled just before.
  - **Fix:** each job now starts with no window left over. An equip refused this way closes the window and tries again. Both log `Window: closed a stale ... window left open`.
- **Spare tools picked straight back up** (worker `throwLine` and `THROW_RUN`):
  - **What happened:** three runs ended with a wooden tool beside a better one. In every case there was a `Craft: dropped` line and no collect line. The toss landed at the bot's feet in a tunnel, and the bot picked it up when the 2 s pickup delay ran out.
  - **Fix:** the toss now goes down the longest open line, at least 3 cells of open feet and head. With no such line, the spare is kept for a later craft: `Craft: keeping the spare ... for now`.

**Not changed yet**
- **Night-mine climb home:** fails with `Took to long to decide path` (hard2, and the flat-world probe). It still costs the night skip whenever the bot mines straight after sealing.
- **normal2:** 43 drowning swim-ups and 23 `climbed above the graze cap` lines.
- **hard3:** no iron pick.
- **Navigation noise:** about 70-340 `no path with mob avoidance` lines per run.

## Round 64 (2026-10-28)

The round-63 soak on seed 20261027 (spawn [-38, 67, 121], hard anchor [-49, 66, 103], normal anchor [-133, 63, 258]).

**Results**
- **Iron picks:** 6 of 6 (452/663/603 and 482/482/1055).
- **Diamonds:** the first one, on normal2. No diamond pick.
- **Bed:** a bed was crafted on normal1. No sleep.
- **Low health:** `retreated from pig/the fight` went from 34 to 0. No run ended under health 6, and the food min was 5.
- **Windows:** no `invalid operation`.
- **Night skip:** all three hard nights skipped (box safe 155-156 s), with no damage after any of them. There was no night mine this soak.
- **Obstruction probe:** the same 9 of 11 as round 62. The pit was 6.1 s and the glass cell 8.1 s.
- **Death:** one, hard3 drowned in a flooded cave at -155, 46, 99.

**Fixes**
- **An air pocket instead of a roof dig** (`airPocket`, `POCKET_MAX` 8, in `get-out-of-water-task.js`):
  - **What happened:** hard3 was boxed in at y=46-47 in water. `roof over the water ... digging it` took 14 s for one stone block, because digging floating in water is 5x slower under water and another 5x off the ground. It came up at air -1. The second time the air ran out and it drowned.
  - **Fix:** the escape now searches through the water (up and sideways, with room for the body) for open air within 8 cells and swims to it, logging `WorldSurvival: air at P, N cell(s) through the water ...; swimming to it instead of digging`. The roof is dug only when there is no such pocket.
- **No walking back into the flood** (`takeSmelt`, `floodedAround`, `FLOODED_MS` 3 min):
  - **What happened:** after the first escape, the furnace take walked straight back to the kiln at -156, 44, 97 in that water.
  - **Fix:** within 3 min of a drowning escape, a furnace with water against it (or beside its stand) is left, with the log `Smelt: the furnace at X stands in water the bot just escaped; leaving ...`.
- **Spare tools, the drop job's way** (`tossSpareTools`, `SPARE_RETRY_MS` 5 min):
  - **What happened:** round 63's throw line logged `keeping the spare` 46 times, mostly at a crafting table on the surface. The tosses that did go out came back within seconds while the bot crafted on at the same table, and normal1-3 ended with spares.
  - **Fix:** too cramped, the bot walks to `openStandNear` first. It tosses down the longest run (at least 3), steps 4+ from where the stack lands, waits 2.6 s and checks. A spare that came back is kept for 5 min (`Craft: the dropped X came back (picked up again); keeping it for 5 min`), as is one with no room within 12.
  - A snow layer no longer counts as a wall in `dropDirection`.
- **A pillar that never rises says why** (`pillarUp`):
  - **What happened:** normal2 sat 8 min at y=-37 with a full bag: 5 `Pillar: no rise in 3 jump-places (... head air, above air)`, and 36 `Dropped cobblestone came back` because it could not walk away.
  - **Fix:** the no-rise line now adds each jump's peak, any `placeBlock` error, onGround and in-water.

**Not changed yet**
- **normal2's y=-37 trap:** it needs next round's jump data.
- **Iron picks that broke** (normal1, normal3) were not replaced before the run ended.
- **Night-mine climb home:** still fails on the flat-world probe.
- **Navigation noise:** about 80-220 `no path with mob avoidance` lines per run.

## Round 65 (2026-10-28)

The round-64 soak on seed 20261027 (spawn [-41, 67, 120], hard anchor [-49, 70, 105], normal anchor [74, 77, 203]).

**Results**
- **Best soak so far:**
  - **No deaths**, and no harness returns from below the anchor.
  - **Iron picks:** 6 of 6.
  - **Diamonds:** peak 3 on normal1 and 2 on normal2.
  - **First diamond pickaxe:** normal1, at t=1717.
- **Night skip:** all three hard nights skipped. hard1's night mine climbed home by pillaring up the sump.
- **Dropped items that came back:** 2, down from 72.
- **Spare tools:** normal1-3 and hard3 ended clean. hard1 kept a wooden axe and hard2 all three wooden tools, both under `keeping the spare ... (no room to throw it within 12)`.
- **Obstruction probe:** the same 9 of 11.
- **Pillar data** (the new no-rise line):
  - Jumps often peak at only +0.42 (one physics tick) or 0.
  - Several `Server refused to place ...` errors. The server still had the bot lower than the client did, so the jump-place is a desync, not a ceiling.
  - normal1 still climbed out from y=-51 on its own.

**Fix**
- **A stone pick before everything when no pickaxe is held** (autopilot `pickFirst`, `PICKS`, `STONE_TOOL_ROCK`; `spareStonePick` gains `anyStone`):
  - **What happened:** normal2's iron pick broke at y=12 with no stone pick left. The food emergency (food 5, nothing to eat) then submitted `ascend for food`, which hit `Tunnel needs a suitable tool in the inventory for diorite` 52 times in 7 min under a ceiling at y=29. The bot held a log, a crafting table and 146 cobble the whole time.
  - **Fix:** `plan()` now checks first, before the food emergency. With no pickaxe of any tier, and the stone (cobblestone, cobbled deepslate or blackstone) plus the wood for sticks and a table, it runs planks, then sticks, then a stone pick. A blocked stone step is left to the usual unblock.

**Not changed yet**
- **normal1 starving:** food min 0 and end health 1 after 5 food set-asides (frozen day, no death).
- **Pillar desync:** see the pillar data above.
- **Night-mine climb home:** still fails on the flat probe.
- **Air pocket and flooded furnace:** neither was exercised (no roof-dig drowning this soak).

## Round 66 (2026-10-28)

The round-65 soak on seed 20261027 (spawn [-23, 66, 124], hard anchor [-72, 69, 150], normal anchor [-9, 71, 205]).

**Results**
- **No deaths in any run:**
  - Iron picks on 6 of 6.
  - normal1 found 6 diamonds and crafted a diamond pick again (t=2142).
  - normal3 held a bed (not slept in).
- **Round 65's pick-first rule worked** on every no-pick gap:
  - normal1: sticks and a stone pick 52 s after the break.
  - normal2: a stone pick 34 s after its iron pick broke, and `Tunnel needs a suitable tool` only once (round 64: 52 times, 7 min stuck).
  - normal3: planks, sticks and a stone pick in 113 s, then an iron pick.
  - None waited behind a food or ascend job.
- **Spare tools:** every end bag is clean (no wooden tool beside a better one).
- **Windows:** two stale windows were closed before a job (a crafting table and a furnace), and there was no `invalid operation`.
- **Night skip:** all three hard nights skipped.
- **Obstruction probe:** the same 9 of 11.
- **One death between runs:** hard1 ended starving at health 0.5. The next run's teleport onto the hard anchor put it in dirt, and it `suffocated in a wall`.

**Fixes**
- **The harness clears the anchor before a teleport** (`tests/soak.py` `clear_stand`, `tp_anchor`):
  - **What happened:** a block from an earlier run sat in the anchor's standing room. A second head-in-wall happened at the same anchor before hard3.
  - **Fix:** the anchor's feet and head cells are set to air before every teleport there (run start, the below-anchor return, the wood-blocked return). The run start heals the bot before the teleport, not after.
- **A straight food search** (autopilot `foodHeading`, `FOOD_HEADINGS`):
  - **What happened:** hard1 (8 set-asides, food 0, health 0.5) and hard2 (food 0) explored for food in 32-block legs, each in a fresh random direction. That random walk stayed within about 80 blocks, and no animal came in range.
  - **Fix:** with no graze biome in sight, the search keeps one heading leg after leg, and turns 90 degrees when the step is set aside. A graze biome direction still wins.

- **Running, not walking** (worker `sprintAssist`, `SPRINT_FOOD` 6; user request):
  - **What happened:** the user still saw the bot walk. Round 65's gait lines read 13-64% sprint on most legs with food 20. The pathfinder sprints only where its physics simulation finds a straight sprintable line over the next nodes, which forest and rolling ground rarely give.
  - **Fix:** on every physics tick after the pathfinder's, a path walk on the ground with food above 6, out of water and not sneaking, gets the sprint key. `ledgeGuard` still lets it go beside a 4+ drop. Watch the `Movement: sprinting N%` lines (expect 85%+ with food above 6).

**Not changed yet**
- **Night-mine climb home:** fails on the flat probe (`Pillar: stopped at y=-61 (no solid block under the feet: air)`, then the tunnel climb).
- **Air pocket and flooded furnace:** not exercised in two soaks.
- **Navigation noise:** about 150-240 `no path with mob avoidance` lines per run.

## Round 67 (2026-10-29)

The round-66 soak on seed 20261027 (spawn [-41, 65, 136], hard anchor [-48, 67, 106], normal anchor [189, 71, 275]).

**Results**
- **The first fully clean soak:**
  - **Deaths:** 0, with no death or suffocation line anywhere, between runs included.
  - **Repeated errors:** no job text repeated 10+ times.
  - **Tools:** no `Tunnel needs a suitable tool` and no `invalid operation`.
  - **Rungs:** iron picks on 6 of 6, and normal2 crafted a diamond pick and a bed.
- **Food search** (round 66 heading):
  - Normal runs found sheep or pigs in 1-3 legs.
  - hard1 found a pig 220 blocks out.
  - hard2 and hard3 kept west with no animal before the run ended.
  - Food mins were 10-19, and no run reached 0 (round 65: two runs at 0).
- **Harness:** every run start healed before its teleport, with no head-in-wall.
- **Night skip:** all three hard nights skipped. hard1 and hard2's night mines still failed the climb home and sealed a second box, which then reached the 150 s skip.
- **Obstruction probe:** the same 9 of 11.

**Fixes**
- **Running, without the packet flip** (worker `installSprintHold`, `sprintWanted`; `gaitTick`):
  - **What happened:** round 66's `sprintAssist` still read 35-60%. mineflayer writes an `entity_action` packet on every sprint change, and the pathfinder sets sprint false in its own tick wherever its simulation says walk, so the key flipped off and on every such tick. The gauge also counted standing ticks (digging or placing on a path, forward up) as walking.
  - **Fix:** a physicsTick listener put first marks the pathfinder's part of the tick, and a sprint-off asked for inside it is ignored while `sprintWanted` holds (on a path, forward down, on the ground, food above 6, out of water, not sneaking). Combat, the ledge guard and the water and escape tasks set sprint outside that window and still go through. The gauge now counts forward-down ticks only.
- **A stale chest window no longer hangs an equip** (`guardEquip` closes a container window before any equip, logging `Window: closed a stale ... window left open before an equip`):
  - **What happened:** normal1 had two silent 9-10 min stalls, the store's log chop and then a wood gather. Each ended on the job time limit and was followed by `closed a stale minecraft:generic_9x3 window`. The equip in between clicked against the open chest window and never settled.
- **Placing against a container sneaks** (worker `guardPlace`, `INTERACTIVE`):
  - **What happened:** a block placed against a chest, furnace, table, barrel, door and so on is a right-click on it, and without sneak that opens it. This is the likely source of the round-66 chest window (the store placed its second chest beside the first).
  - **Fix:** placements against one now hold sneak and let it go after.

**Not changed yet**
- **Night-mine climb home:** fails, though the second box now gets the skip.
- **Spare tools:** hard1 and hard2 ended with wooden tools after `keeping the spare ... (no room to throw it within 12)`.
- **normal1's broken iron pick:** the bot went 21 min without a pick, because the 18-min store stall sat in the gap.
- **Air pocket and flooded furnace:** still not exercised.
- **The soak on a copy of the group's Nitrous world** (user request; `tests/soak.py` `SOAK_WORLD`):
  - **The copy:** `test-server/nitrous-copy-20261029` is a read-only copy of the Nitrous server's `world` (same 26.3 version, 1.08 GB). It was taken without `session.lock` and `players/`, so BuilderBot joins as a new player and no one's inventory or position comes along. It is git-ignored with the rest of `test-server/`.
  - **How a soak uses it:** with `SOAK_WORLD=<that folder>`, each soak copies it fresh into `agent-soak-world` instead of generating from `SOAK_SEED`, so the pristine copy is never played on. Anchors are scouted from that world's own spawn. The harness refuses a folder under `crafty/` (a live server world).
  - **Its world settings:** keep_inventory off, mobs, monsters and mob griefing on, natural time; the soak still sets its own rules per anchor.
- **Built-block dig log** (worker `installDigWatch`, `builtLooking`, `BUILT_HINT`): logging only. Every block the bot breaks that looks built is logged with its position and job as `Dig: broke <block> at P (looks built; job X)`; this covers planks, slabs, stairs, glass, wool, bricks, fences, doors, storage, light, redstone and decoration. A log with no leaves within 3 is logged as `(no leaves within 3; job X)`.

## Round 68 (2026-10-29)

The round-67 soak ran on the copy of the group's Nitrous world (spawn [705, 63, -438]; hard anchor [711, 71, -425], normal anchor [712, 71, -427], both beside the spawn).

**Results**
- **Player builds:** not one `Dig: broke` line; nothing that looks built was broken. The bot found a group bed and chest at (891, 108, -478)/(888, 108, -471) and another bed at (728, 71, -525). It set home there but put nothing in, took nothing out, and could not path to the second bed to sleep.
- **Running works:** 98-100% sprint with food above 6, on every run (round 66: 35-60%).
- **Progress:** only normal1 progressed (iron pick at 572 s). The other five never got past wood, and 13 deaths followed: 4 starved, 5 drowned (the spawn sits by water with drowned at night), 3 mobs, 1 burned.
- **Root cause:** the nearest wood is a build of stripped logs south-east of the spawn. The any-log gather took `stripped_spruce_log` / `stripped_oak_log`, and the plank name kept the prefix, so it crafted `stripped_spruce_planks` and got `Unknown item`, again and again (`wood failed 3 times` 10-29 per run). With no sword:
  - Food fights hit 7f's `never fight unarmed` / `pickaxe only when cornered`, with 49 `avoid` lines against a single cow.
  - The bot starved. At night it died to mobs.

**Fixes**
- **Stripped logs are not trees** (worker gather any-log match). When one is held, `planksFor` names its species' planks.
- **Food fights use what is held, or the hand:**
  - A fight job on harmless prey passes `allowHand`.
  - The controller's passive-animal hand rule now also covers `pickaxe only when cornered`.
- **Drowning backstop** (worker `sinkGuard`, `SINK_MS` 8 s):
  - **What happened:** normal3 drowned in a natural lake 16 deep at 691, 48, -550 with no WorldSurvival line at all.
  - **Fix:** a head under water for 8 s holds jump whatever runs, and logs once `Water: head under for N s ... with no swim-up` with the air, isInWater, the job and the chain.
- **No sprint-on at food 6 or less** (`installSprintHold`):
  - **What happened:** normal3, starving, logged 154 PACKET_RATE lines from the key flipping.
- **The soak resets the bot's world memory** (`tests/soak.py`):
  - **What happened:** `data/storage.json` still held round 66's chests from another world.
  - **Fix:** storage, autopilot home and ledger start empty with every soak's world. The old files are kept as `.prev`.

**Not changed yet**
- **Water at spawn:** respawns at night beside the spawn water meet drowned.
- **Paths into builds:** the sleep job could not path to the group bed.
- **Night-mine climb home:** unchanged.

## Round 69 (2026-10-29)

The round-68 soak on the Nitrous world copy (bot `482531b`) never started a run. The scout confirmed the hard anchor at [705, 71, -424] beside the spawn [698, 63, -437]. It found no normal anchor in eight explore legs and raised `no open-sky spot with reachable logs found`. No deaths, no kick, no player touched.

**What the scout log shows**
- **Every leg ended in water:** five legs' gather or explore jobs ended in a swim-up and `Reflex: the ... job led into a hazard; cancelled, not resumed`.
- **The drowning latch fired late:** each dive's first drowning line was `WorldSurvival: drowning (air 1)` (the first at air 8). The latch needs water at the head or feet, and the client saw none while the air ran from 8 to 1. The round-68 sink guard (head in water for 8 s) saw no water either, so `Water: head under` never logged.
- **The copy keeps its own mobs:** `spawn_mobs false` stops new ones only. The scout's kill at the spawn took one skeleton, and a flee at 00:35 listed about 30 hostiles.
- **Round 67's normal anchor was not tried:** round 67 confirmed [712, 71, -427] on this same copy, but the scout only walked outward.

**Fixes**
- **Falling air is water** (WorldSurvival `_handleDrowning`, `AIR_FALL_MS` 3 s). Air only falls with the eyes under water, so a falling reading latches the swim-up even when the client sees no water. It logs once: `WorldSurvival: air falling (air A) with no water seen at the head (X) or feet (Y) at P; treating it as water`. That line names the blocks the client holds there, which is the next clue to why the water is not seen.
- **The sink guard counts falling air too** (worker `sinkGuard`). Its line adds `head block X - the water is not seen, the air is falling` when that is the trigger.
- **Scout tries earlier anchors first** (`tests/soak.py` `prior_anchors`): the anchors confirmed by an earlier soak on the same world (matched on the results' `world` field), newest first, before the outward legs. They are still verified (open sky 12+, a completed gather). On this copy that is [712, 71, -427].
- **Scout clears the copy's mobs on every leg** (`scout_clear`): hostiles within 96 are killed on each outward leg when `SOAK_WORLD` is set. The scout only; the runs are unchanged.

**Not changed yet**
- **Why the client sees no water there:** the new `air falling` line will name the head and feet blocks.
- **Water at spawn:** respawns at night beside the spawn water meet drowned.
- **Paths into builds:** the sleep job could not path to the group bed.
- **Night-mine climb home:** unchanged.

## Round 70 (2026-10-29)

The round-69 soak on the Nitrous world copy (bot `0adb70f`) ran all six runs clean.
- **Scout:** it retried round 67's normal anchor [712, 71, -427] first and confirmed it.
- **Iron:** iron picks on 3 of 6, all three normal runs (round 67: 1 of 6). Two deaths (round 67: 13).
- **Builds:** no `Dig: broke` line.
- **The three hard runs** never got wood: `No path to the goal!` over and over at night among the copy's mob crowds.

**The air reading was never the bot's**
- **What the log showed:** `air falling` 908 times, almost all on dry land:
  - Air 19.93 (a fraction).
  - Air 8 for 15 s in a dry tunnel at y=39.
  - Air -1 for seconds beside the spawn at full health, with no `losing health` line.
- **Cause:** mineflayer's `entity_metadata` handler (`entities.js`, `metas.air_supply`) copies the air of EVERY entity into `bot.oxygenLevel`. That includes fish, squid and drowned, and a dolphin's 4800 ticks, which came out as 320 and then 19.93 through `airOf`.
- **What it did:** round 69's falling-air rule turned those readings into 435 `preempted by Misc World Survival Chain` swim-ups on land.
- **It is older than round 69:** every air-based rule since the start read whichever mob last changed its air, which is likely the "stale" and "never comes" readings of rounds 21, 24, 49 and 56.

**Fixes**
- **The bot reads its own air** (worker `installOwnAir`):
  - `bot.oxygenLevel` is now a property fed only by the bot's own entity's `air_supply` (ticks / 15, 0-20). mineflayer's writes are ignored.
  - It reads 20 at every spawn. This replaces the old spawn-time `oxygenLevel=20`.
- **A fall is two levels within 3 s** (`airFall`, `AIR_FALL_DROP` 2, used by the WorldSurvival latch and by `sinkGuard`). The latch and guard need more than one step of noise. Under water the air drops a level every 0.75 s.
- **No-path jobs say where they were going:** after `Job: No path to the goal!` the worker logs `Job: no path for <type> <block> from P; last goal <Goal x,y,z within r> (N s ago)`, taken from the pathfinder's `goal_updated` event. This is for the hard runs' wood.
- **The roof dig names the roof block**, and a failed dig logs `WorldSurvival: the roof dig at P failed (<block>, held X): <error>`. This is for normal3's drowning under the roof at 837, 102, -446, in a build at y=100.

**Not changed yet**
- **Hard runs without wood:** the new no-path line comes first.
- **Paths into builds and its beds:** the bot met a group chest at 823, 101, -452 (a table place on it was refused) and was stranded twice on that y=100 build.
- **Night-mine climb home:** still not climbing home in the shelter-hole probe.

## Round 71 (2026-10-29)

The round-70 soak on the Nitrous world copy (bot `beed76a`) ran all six runs clean.
- **Iron:** iron picks on 4 of 6 (round 69: 3 of 6; round 67: 1 of 6), with a diamond pick on normal2 at 2349 s.
- **Deaths:** none (round 69: 2; round 67: 13).
- **Hard wood:** all three hard runs got wood (332 / 271 / 301 s). In round 69 none of them did.
- **Own air:** `air falling` logged 0 times (round 69: 908). Survival-chain preempts fell to 12 (round 69: 435).
- **Obstruction probe:** stopped by the tester after 3 scenarios, so there is no score this round.

**The bot could not path out of deep water**
- **What the log showed:** hard3 spent its last 3 minutes afloat at (742, 62, -614).
  - Every gather and explore failed with `No path to the goal!` within a second, 26 times. The goal was `GoalXZ`.
  - `Water: no dry stand within 6`.
  - Two drowning swim-ups.
- **Cause:** mineflayer-pathfinder measures a climb from the block under the feet. Under a swimmer that block is water, so the climb comes out a full block higher than it really is.
  - Even a bank level with the water surface fails the 1.2 "too high to jump" check.
  - The forward step needs a solid floor, and `getMoveUp` and `getMoveDown` refuse liquid.
  - A swimmer can only leave where the water is one deep. Out of reach of such an edge, the A* search runs out of nodes, returns `noPath`, and `goto` rejects at once.

**Fixes**
- **Swim-out moves** (worker `waterExits`, installed on the normal and explore movements):
  - The move starts from the top water cell (water below open air), or from the air cell just over the surface. It adds a climb onto a full block beside it whose top is at most 1 over the water.
  - The cells above the landing and above the swimmer must be clear and not liquid. Lava is never climbed out of.
  - Cost is `SWIM_OUT_COST` 2 plus the liquid cost.
  - The pathfinder already holds jump in water. The physics lifts a swimmer that pushes into a ledge.
  - A test runs the real A* from the middle of a pool. It returns `noPath` with the stock movements and `success` with the fix.
- **`leaveWater` scans 12 out** (`LEAVE_WATER_R`, was 6), with 20 s to step out (was 12).
- **The sink-guard line names the eye height.** It reads `head block air at eye y 63.0, in water - the air is falling`. The round-70 hard3 lines had said "the water is not seen" next to `isInWater true`. Now that the air is the bot's own, those lines mean the server put the eyes under water while the client's block at the eye was air.

**Not changed yet**
- **Night-mine climb home:** hard1 came up the tunnel to (818, 87, -528), one diagonal from its box. It then spent the 10 s think timeout on `Took to long to decide path`, and the fallback sealed a new box where it stood.
- **Hard runs are short:** hard1 and hard2 spent about 7 of their 21 minutes in the night box, and neither reached iron.
- **Paths into builds and beds:** no new data this round.
- **Obstruction probe:** `cobble_box_bare` and `chest_spot_blocked` still need a full run.

## Round 72 (2026-10-30)

The round-71 soak on the Nitrous world copy (bot `c88bd69`) ran all six runs clean.
- **Iron:** iron picks on 3 of 6, all three normals, at 512 / 783 / 843 s (round 70: 4 of 6). Diamond pick on normal3 at 2379 s.
- **Hard wood:** 241 / 362 / 874 s.
- **Deaths:** one, hard2, blown up by a creeper. No drowning.
- **Air:** `air falling` logged 0 times again.
- **Obstruction probe:** 9 of 11, the same two failures since round 66.

**Round 71's climb out was half wrong**
- **What the log showed:** normal2 spent 51 s on the floor of a cave pool at (779, 54, -515), near its furnace.
  - `No path` to every goal.
  - `Water: could not step out (The goal was changed ...)`.
  - Then `(Navigation timed out at (779, 55, -515) (onGround false ...)`.
- **The physics check:** I ran the bot's own physics (prismarine-physics) on a swimmer holding forward and jump against a bank.
  - It climbs onto a bank level with the water top.
  - It tops out at y+0.58 against a bank one block higher, so it can never land there.
  - Round 71 planned that higher climb, so a bot could push at it until the walk timed out.
- **Second gap:** the pathfinder never plans a move up inside water (`getMoveUp` refuses liquid). A bot under the surface had no path at all.

**Fixes**
- **`waterExits` now plans two moves:**
  - The climb onto a level bank only.
  - A swim-up, one water cell at a time, to the top water cell (`SWIM_UP_COST` 1 plus the liquid cost).
  - The tests run the real A* and the real physics. From a pool floor the stock search is `noPath` and the fixed one reaches land. A pool walled one block over the water still plans nothing, and the physics confirms it can't be climbed.
- **`leaveWater` tries once more on `The goal was changed`.** A failure now names the stand it was going to.
- **Creepers hold the shelter** (night.js `leaveRefuge(tod, nearest, creeper)`):
  - hard2 opened its box at tod 3000 with the nearest hostile 10.9 away; the late-morning rule let anything past 6 go.
  - The 22-block box took 19 s to take down, a creeper walked up, and it blew the bot up as it stepped out.
  - Now a creeper within 16 holds the box until `CREEPER_LATE` (tod 6000), then within 6.
- **Walls come down last:** `removeShelter` digs the outer cells first and leaves the cells beside the bot's feet, head, roof and floor for the end. Before those, `waitCreeperClear` waits inside the walls while a creeper is within 16, for at most `CREEPER_WAIT_MS` 60 s.
- **Boxed in with no pickaxe, the stair-out digs by hand:**
  - It digs blocks up to `BOXED_HAND_HARDNESS` 2 (cobblestone and stone, not deepslate or ores) and logs `Boxed in: no tool for X at P; digging it by hand (it drops nothing)`.
  - Every other tunnel still refuses a dig without the tool.
  - This is for the probe's `cobble_box_bare`.

**Not changed yet**
- **`chest_spot_blocked`:** the bot refuses to break a cobblestone block it didn't place to put a chest there, which is right. The probe should count that refusal as a pass.
- **Night-mine climb home:** still fails in `shelter_hole`, and the fallback reseals where the bot stands.
- **Hard runs:** short on time; hard2 and hard3 never reached a furnace.

## Round 73 (2026-10-30)

The round-72 soak on the Nitrous world copy (bot `3fc0f73`) ran all six runs clean.
- **Iron:** iron picks on 3 of 6, all three normals, at 572 / 723 / 1145 s. No diamond pick.
- **Hard wood:** 302 / 512 / 603 s.
- **Deaths:** three. hard2 and hard3 were slain by drowned in the lake beside the spawn; hard3 was shot by a skeleton 35 s after opening its morning box.
- **Water:** `Water: stepped out to` 4 times, `could not step out` 0 (round 71: 0 / 2).
- **Obstruction probe:** 9 of 11. `cobble_box_bare` now digs by hand but still times out; `chest_spot_blocked` is the expected refusal.

**The drowned deaths: a search budget, not the terrain**
- **What the log showed:** hard2 swam east across the lake from (749, 65, -419) to (795, 59, -433) over two minutes. Twenty gathers and explores in a row failed with `Job: No path to the goal!`, then a drowned killed it. hard3 did the same in the same lake.
- **The terrain check:** I read the lake from a copy of the world's region file and ran the real A* (with `waterExits`) on it. With no search limit, every direction from the four spots where the bots swam has a path.
- **The cause:** `searchRadius` 128 caps a search's cost at the straight line plus 128. A water block costs `LIQUID_COST` 4 more, and a block near a mob up to `STEP_COST_CAP` 40 more. With the bot's own settings the same replay fails 5 of 40 searches on the water cost alone; with drowned in the lake almost every one fails. Such a search ends `noPath` with a partial path, so `goto` rejects. The round-22 retry without mob avoidance only ran on an empty path, so it never got a chance.

**Fixes**
- **`navigate` catches the stock `No path to the goal!` rejection:**
  - With mob avoidance on, it paths once more without it (`navigateNoAvoid`, now shared with the empty-path case).
  - From the water (`inWater`: a water, seagrass or kelp cell at the feet or head) it paths once more with `WATER_SEARCH_RADIUS` 320, then puts the budget back. It logs `Navigation: no path from the water at P within the search budget; searching 320`. With 320, all 40 replay searches on the real lake succeed.
- **A job that fails for no path while the bot swims makes the next job step out first** (`leaveWater`, within `WET_NOPATH_MS` 30 s), the same as after a drowning.
- **Skeletons hold the morning box** (`DAY_HOSTILE`: creeper, skeleton, stray, bogged):
  - hard3 opened at tod 3000 with the nearest hostile 10.3 away and about 37 hostiles around, and was shot 2 s after the box came down.
  - A shaded skeleton within 16 now holds the box until tod 6000, then within 6, as a creeper does.
  - The inner walls wait for it too: `Shelter: a skeleton D away; keeping the walls up`.
- **The stair-out never cleared its own headroom:**
  - A step up lifts the head into the cell over it, which is the box's roof. That's why `cobble_box_bare` dug the four sides by hand and never rose. With a pickaxe, `cobble_box_pick` also logged `no way to stair out`; it only escaped through the pathfinder's own digging.
  - The stair-out now clears that cell first. It won't if sand, gravel or a fluid sits over it, or if it's bedrock.
- **The stair-out counted its steps wrong:** a first step onto an open side broke out with the count still 0 and was taken as no step. The next direction then dug on from the new stand. It now counts the steps taken.
- **The night-mine climb home** (the probe's `shelter_hole`, and hard1's `could not climb back` this soak):
  - The bot stood one block over the first tunnel cell and asked the pathfinder for that filled cell.
  - The navigate's stranded fallback then built a 3-block pillar and lifted it out of the tunnel beside the box.
  - `climbTunnel` now skips a cell the bot stands on. While it runs, the stranded stair-out, drop and pillar fallbacks stay off; it has its own dig-through-fill retry.

**Not changed yet**
- **Hard runs:** short on time; hard2 and hard3 never reached a furnace.
- **`chest_spot_blocked`:** the expected refusal, as before.

## Round 74 (2026-10-30)

**Round-73 soak results** (Nitrous world copy, `2769c3b`)
- **Iron:** 3 of 6 again (all normals), no diamond pick. The hard runs reached wood and a stone pick at best; no furnace on any of them.
- **Deaths:** 3.
  - normal1 drowned in a pit by the spawn.
  - hard1 was shot by a skeleton about 3 minutes after a cave morning.
  - hard2 was shot by a skeleton while unarmed.
- **No-path jobs:** 16 (round 72: 60), 1 of them in water.
- **The wider water search** ran 56 times. On normal2's long river swim, every one carried the bot on.
- **Obstruction probe:** 10 of 11. `cobble_box_bare` now digs out by hand in 34 s, and `chest_spot_blocked` is the expected refusal.

**Diagnosis: normal1's drowning** (from the soak world's region file after the soak)
- The stone gather dug a pit at x 708-712, z -421..-419 down to y 57, and water filled it to y 62. The craft job had placed its crafting table in the pit at (711, 60, -420).
- Every craft after that walked back down to the table, into the water: five times in 90 s.
- From the pit, every path failed in about 60 ms, the 320 search too. The bot was walled in, not over budget. The stair-out that did get it out once (06:45:49) only ran from an empty path.
- The last swim-up said `open water 2 up` at (710, 60, -420) and then held jump for 21 s at the same y until the bot drowned.

**Diagnosis: the night mine home**
- hard1 and hard3 (and the probe's `shelter_hole`) ended the climb one block beside the shelter cell, at its level.
- The pathfinder then failed (`Took to long to decide path to goal!`). The hand walk looked for a tunnel point within 2, found none and returned at once, so the new box went up one block over, in the old box's wall.

**Fixes**
- **A no-path from the water stairs out:** after the wider search fails, the bot stairs out once toward the goal and paths again. This doesn't run from a tunnel climb, which has its own fallback. It also covers `leaveWater`'s `could not step out`.
- **A crafting table with water against it** (`floodedAround`, as for the furnace) is passed over. If the bag holds a table or the planks for one, a new one is placed instead, logging `Craft: the crafting table at P stands in water; placing another`. With nothing to replace it, the old one is still used, so crafts don't fail in a loop.
- **Swimming straight up that doesn't rise** `NO_RISE_BLOCKS` 0.5 in `NO_RISE_MS` 3 s gives that column up, logging `WorldSurvival: no rise in 3 s swimming up at P (air N); swimming round it`. The air-pocket search then skips the way up from that column and swims to the next one.
- **Beside the shelter cell at its level after a failed climb:** the bot steps in by hand, logging `Night mine: one step from the shelter at P; stepping in`.
- **The soak's hard runs are 2400 s** (were 1250 s), the same as the normal runs, on the user's request. That is two natural nights; `SOAK_HARD_SECONDS` overrides it. A soak now takes about 4.3 h.

**Not changed yet**
- **The hard runs' skeleton deaths:** both bots were unarmed or just out of a cave. Read again with the longer runs.
- **`chest_spot_blocked`:** the expected refusal.

## Round 75 (2026-10-30)

**Round-74 soak results** (Nitrous world copy, `17daa4e`, the first soak with 2400 s hard runs)
- **Iron:** 3 of 6 again (all normals), no diamond pick. hard2 placed the first hard-run furnace of this series (1054 s); still no hard iron pick.
- **Deaths:** 5, none in water: hard1 a creeper, hard2 a spider and a zombie, hard3 a skeleton and a zombie. Three were within 3 minutes of a box opening or a cave-roof climb.
- **Water:** `searching 320` 3 times (round 73: 56). Job no-paths 2, none in water (round 73: 16). No swim-round and no flooded-table line fired.
- **Obstruction probe:** 9 of 11. `shelter_hole` did not seal (round 73: complete). `chest_spot_blocked` is the expected refusal.

**Diagnosis: the stalls in Mob Defense holds** (from `logs/dashboard.log` and the samples)
- **hard1:** at dawn, after sleeping, it logged `fleeing ... (still recovering)` at 6.3 health with the bar at 6 and no food held. The hold (`KeepDistanceTask`) paused the cow hunt and then stood at (708, 63, -526) for 10 minutes with no log line at all, until the night job replaced it. Regeneration needs a bar of 18, so it could never reach the hold's 14 health. The collect job queued behind it never ran.
- **hard2:** after the second night it logged `fleeing ... (vulnerable)` at 17 health with no armour. The run-away kept going while any hostile stayed within 30, and a mob cave below always had one. The bot stood at (813, 84, -551) for the last 3.5 minutes of the run.

**Diagnosis: the step into the box**
- hard3 and the probe's `shelter_hole` logged `stepping in` and then `pillaring up the sump` and `Pillar: stopped ... (no solid block under the feet: air)` in the same millisecond.
- The cell's floor is the night mine's open sump, so the step in dropped the bot down it, and the pillar checked the ground while the bot was still falling.
- In the probe, the replacement box went up round the falling bot and could not seal its floor (`1 open cells, first at 3000,-62,0`).
- hard3's first night mine ended at the box's corner, diagonal to the cell, so no step-in ran.

**Diagnosis: a false tool loss**
- hard3's `Tool left the inventory: stone_sword (125 uses left)` came in the same millisecond as `Combat: equip skeleton`, and the next sample still held the sword.
- An equip empties the old slot before the new one fills, so it is not a loss.

**Fixes**
- **The recovering hold needs a way to heal:** a bar of 18+ or safe food held (`canHeal`). Otherwise the hold doesn't start and the paused job runs.
- **A run-away or keep-distance hold that hasn't moved the bot** 3 blocks in 20 s, with nothing within 8 in sight, stands down for 60 s. It logs `Reflex: the <task> held 20 s without moving the bot (...); standing down for 60 s` and the paused job resumes. A hostile within 8 in sight ends the stand-down at once. Creeper flees and fights are not affected.
- **The night mine home lands first:** after the step in and before reading the sump, the bot waits up to 2 s to be on the ground (`LAND_WAIT_MS`), then pillars up from the sump's bottom.
- **From the box's corner** the bot steps in through a side cell that is open at feet and head, logging `Night mine: one step from the shelter at P (through C); stepping in`. If both sides are wall, it doesn't step in.
- **The tool-loss check waits 250 ms** (`TOOL_LOSS_SETTLE_MS`) before deciding the tool has gone.

**Not changed yet**
- **The deaths after a box opening or a cave-roof climb** (hard2 spider and zombie, hard3 skeleton): read again once the holds no longer stall.
- **`chest_spot_blocked`:** the expected refusal.

## Round 76 (2026-10-31)

**Round-75 soak results** (Nitrous world copy, `6a194cf`)
- **Iron:** 4 of 6 (round 74: 3), with the first hard-run iron pick of this series (hard2 at 603 s). No diamond pick. Every hard run placed a furnace (1054 / 422 / 452 s).
- **Deaths:** 6, none in water. normal2 a skeleton. hard1 a spider, a creeper and a skeleton. hard3 lava and a skeleton.
- **Flee holds:** 7 stand-downs, and no 3-minute recover or vulnerable stall (round 74: 10 min and 3.5 min). The one 3-minute stretch was a queued craft at full health.
- **Night mine home:** 2 of 3 got back into the box. The third pillared from 2 below the cell and stayed there.
- **Obstruction probe:** 9 of 11. `shelter_hole` is still not sealed. `chest_spot_blocked` is the expected refusal.

**Diagnosis: the pillar up the sump**
- **hard2's third mine:** `stepping in`, then `pillaring up the sump from y=94` and `Pillar: no rise in 3 jump-places at y=94 (... jumps +0.2 / 0.2 / 0.2, onGround true)`.
- **The probe:** `pillaring up the sump from y=-62`, then `Pillar: stopped at y=-61 (no solid block under the feet: air)`.
- **Cause:** the drop in leaves the bot off the column's centre. It is half in the tunnel mouth at the sump's bottom, whose roof stops each jump at 0.2, or on the rim over air.

**Diagnosis: normal1's last 15 minutes**
- **What happened:** the iron pick broke at y=38. `Ascend: y=38 -> 62 (surface 71)`: the single 24-block pillar segment ran out 9 below the surface.
- **The loop:** from 18:47 to the end of the run it alternated `no path for gather log` and `no path for explore` at (854, 62, -447). That is 120 of the soak's 140 job no-paths.
- **Why it never climbed:** 9 below is not "deep underground" (16), so every failure explored instead of climbing.

**Diagnosis: the lava death**
- hard3 opened its box at (823, 67, -537) and started a cow fight. 7 s later it logged `in lava; escaping at (835, 75, -540) (head lava, feet lava)`, then `tried to swim in lava`.
- The fight steers with the keys, not the pathfinder, so nothing checked the cells ahead for lava.

**Diagnosis: the false stone-sword losses**
- Three `Tool left the inventory: stone_sword (131 uses left)` lines, each about 100 ms after `Combat: strike <passive mob>`. The next sample still held the sword.
- The strike's wear arrives as an empty slot and then the sword one use down. Round 75's check needed the same durability.

**Fixes**
- **Fill the sump from beside the box.** Before stepping in from beside or from the corner, the bot fills the sump's two cells, bottom first, against any solid neighbour. It logs `...; filled the sump (N blocks); stepping in`, then steps onto a floor with no pillar.
- **Centre before the sump pillar.** A bot already down the sump walks to the column's centre (up to `CENTRE_MS`, 1 s) and lands before pillaring.
- **The ascend pillars on.** It runs up to `ASCEND_SEGMENTS` (3) segments of 24 while each one reaches its own target, logging `Ascend: pillared y=A -> B, N below the surface; pillaring on`. A segment that stops short of its target (a ceiling, no blocks) ends it.
- **A blocked step under rock climbs out.** It applies when the bot has no sky, is more than `SHALLOW_BELOW` (4) below the wood step's surface, and has not climbed this way in the last 2 minutes. It submits an ascend instead of the explore and logs `Autopilot: <step> blocked under rock at y=Y (surface S); climbing out instead of exploring`.
- **The lava guard.** A key-driven walk (no pathfinder, not already in lava) heading into lava stops and steps back, as the ledge guard does at a drop. Lava counts at the feet or head of the cell ahead, or up to 3 below an open floor. It logs `Lava guard: stopped at P (lava ahead at Q; job J)`.
- **Tool loss:** the same tool up to `WEAR_SLACK` (4) uses more worn counts as the same tool.

**Not changed yet**
- **The deaths after a box opening or a cave-roof climb:** hard1 spider, and hard3 skeleton 44 s after opening. hard1's spider came 17 s after a stand-down at health 10. Read again with the lava guard in.
- **hard3's last 4.5 minutes** standing at (717, 66, -590) on `night: no shelter; holding for morning` at food 6, after the river stretch.
- **The 26 tool-loss lines at run boundaries** are the harness's bag clear.
- **`chest_spot_blocked`:** the expected refusal.

## Round 77 (2026-10-31)

**Round-76 soak results** (Nitrous world copy, `b425ba8`)
- **Iron:** 4 of 6 again. The hard one is hard1 at 1416 s. normal1 made a diamond pick at 2349 s. hard2 never placed a furnace.
- **Deaths:** 435, and 429 of them are one loop at (811, 32, -549) on hard1, hard2 and hard3 (6 / 194 / 235 deaths). Outside it, two hard2 deaths before the loop: a creeper and lava.
- **Round 76's fixes held:** `searching 320` 2 (round 75: 12). Job no-paths 15 (round 75: 140). No 5-minute no-path sit. 0 deaths within 60 s of a stand-down. No mid-run false sword loss. `PACKET_RATE` 0.
- **Night mine:** 1 of 1 back in, through `filled the sump (2 blocks); stepping in`.
- **Obstruction probe:** 10 of 11. `shelter_hole` now completes with `resealed_after 4.0`. `chest_spot_blocked` is the expected refusal.

**Diagnosis: the death loop**
- **The bed:** hard1 was in a mob cave at y=32, 39 under the hard anchor, perched for the night with a bed held. At 02:05:34Z `Autopilot [night] {"type":"sleep"}` placed the bed at (811, 32, -550), and the server answered `Respawn point set`.
- **Then:** the sleep was preempted and resumed, the resumed job found the bed already standing, and nothing picked it up. At 02:14:12Z, after a death there, `Autopilot: home set to the bed at (811, 32, -550)`.
- **Why it spread:** the harness's bag clear between runs keeps the server's spawn point. hard2's lava death at 02:29:58Z respawned in the cave (`Fall: dropping from (806, 33, -548)` 4 s later). From then on every respawn was at that bed, empty-handed, in the middle of the cave's mobs. hard3 escaped at t=1147.

**Diagnosis: the lava death after the guard**
- hard2 at 02:29:56.181Z: `Lava guard: stopped at (837, 87, -539) (lava ahead at (838, 84, -539); job none)`. 0.33 s later it logged `in lava; escaping at (838, 85, -539)`, and the next fall line has sprint on.
- **Cause:** the guard clears the keys after the physics step. A flee that presses them again before the next step walks on. At sprint speed one cell of look-ahead also leaves little room to stop.

**Fixes**
- **No sleep underground.** A new `Autopilot.undergroundForBed(p)` is true when the spot is more than `ASCEND_BELOW` (16) under the surface, or more than `SHALLOW_BELOW` (4) under it with no sky.
  - `bedForNight` is false there, so the night job is the shelter.
  - The sleep job refuses with `Underground at y=Y (surface S): a bed here would put the respawn point in the cave`.
  - `rememberHome` does not take such a bed as home.
- **Break a respawn bed that kills.** After each death, 800 ms after the respawn, `respawnBedCheck` looks for a bed within 3.
  - It breaks the bed when the bot has died within 24 of it twice in the last 10 minutes, or once when the bed is underground.
  - It logs `Respawn: N deaths within 24 of the bed at P in 10 min[ (underground)]; breaking it so the next respawn is the world spawn`. If that bed was home, it also logs `Respawn: home cleared (it was that bed)`.
  - A failed dig logs `Respawn: could not break the bed at P (...)`.
- **The lava hold.** For `LAVA_HOLD_MS` (1.5 s) after a lava-guard stop, presses of sprint, jump, or a walking key heading toward that lava are dropped in the `setControlState` wrapper. The guard's own step back and walking away still go through. The hold is never applied while the bot's own cell is lava.
- **Farther look at speed.** At more than 0.15 blocks a tick, or off the ground, the lava guard also reads the cell 0.8 farther along. A wall in the near cell still hides it.

**Not changed yet**
- **The sleep path that let the bed stand:** a preempted sleep resumed onto a bed it had placed, so `afterSleep` saw no placed bed and left it. With no sleep underground this matters only on the surface. There a bed left away from home is a spare respawn point.
- **hard2's furnace:** never placed, because the run was in the loop from t≈420.
- **The tool-loss lines at run boundaries:** these are the harness's bag clear.
- **`chest_spot_blocked`:** the expected refusal.

## Round 78 (2026-10-31)

**Round-77 soak results** (Nitrous world copy, `beace60`)
- **Deaths:** 4 (round 76: 435). normal2 drowned. hard1 a creeper. hard2 a creeper, then a zombie a minute later, unarmed after the respawn. No spot had 3 deaths. No lava line and no `Respawn point set`; the bed-break check never needed to fire.
- **Iron:** 5 of 6 (rounds 75 and 76: 4). hard1 at 2138 s, hard3 at 1807 s. hard2 placed a furnace (1867 s) and mined ore, but made no iron pick. No diamond pick.
- **Hard furnace** on all three (1265 / 1867 / 783 s). Night skips 2 / 3 / 3.
- **Night mine:** 5 of 5 back in (4 filled the sump, 1 pillared from 2 below the box).
- **Obstruction probe:** 10 of 11. `chest_spot_blocked` is the expected refusal.
- **This scout's hard anchor** was open sky (canopy light 15), not the dark canopy of rounds 75 and 76. The hard runs are not directly comparable.

**Diagnosis: the normal2 drowning**
- At 06:14:38Z, a dig-down stopped on `cherry_slab at (843, 102, -440) is not natural terrain` (a build).
- At 06:15:03Z: `Water: head under for 8 s at (844, 100, -440) ... head block cherry_slab at eye y 102.3, in water`, then `drowning (air 8), swimming up`. There was no further water line, and it drowned at 06:15:24Z.
- **Cause:** the eye was in the water under the upper half of a waterlogged top slab. `headUnderWater` matched the head cell's name only, so the straight-up, pocket and roof branches never ran. The land search alone did not get out in 21 s.
- **Also:** every older waterlogged check read `block.properties`, which mineflayer does not set. It exposes `isWaterlogged` and `getProperties()`. So those checks never matched.

**Diagnosis: the hard2 creeper**
- 49 s after the box opened, the bot was unarmed. From 08:19:15Z to 08:19:24Z, `fleeing creeper (never melee a creeper)` and `resumed the craft job` alternated every 0.2-0.6 s. Then `creeper fuse (swell 1)`, and it was blown up at 08:19:26Z.
- **Cause:** the creeper flee ends at 10 blocks. The craft then resumes standing still, and the creeper walks back in.

**Fixes**
- **`waterlogged(block)`**, in `get-out-of-water-task.js`, reads `isWaterlogged`, then `properties`, then `getProperties()`. It is used by:
  - `headUnderWater`, the world-survival chain's `wet`, and the sink guard.
  - `waterAbove`: a waterlogged non-solid cell counts as water, and a waterlogged slab is a roof at dy 0.
  - `airPocket`: it swims sideways through waterlogged cells, and never rises out of a waterlogged solid block (slab, stair) or into one.
- **The creeper chase.** A creeper that has followed for `CREEPER_CHASE_S` (3 s) is fled out to `CREEPER_CHASED_KEEP` (20 blocks), past its 16-block follow range. The bot keeps fleeing while that creeper is within 20 and was seen in the last 5 s.
  - It logs `Reflex: a creeper has followed for N s; keeping 20 away`.
  - Its priority is 55-100, above the user task's 50.
  - The armed pillar fight at `CREEPER_PERSIST` (20 s) is unchanged.

**Not changed yet**
- **hard1's creeper:** knocked off a night pillar at health 8, with nothing to eat, then a chicken fight. hard2's zombie came right after the respawn, unarmed.
- **The normal2 river stretch:** 14 `searching 320` lines and 5 `no dry stand within 12`, from 06:19Z to 06:32Z.
- **hard2's ore and no ingots.**
- **The tool-loss lines at run boundaries:** these are the harness's bag clear.
- **`chest_spot_blocked`:** the expected refusal.

## Round 79 (2026-10-31)

**Round-78 soak results** (Nitrous world copy, `195187d`)
- **Deaths:** 2 (round 77: 4). normal3 drowned in the group's cherry-slab build at (837, 100, -446). hard2 was shot by a skeleton at 13:37:46Z. No creeper damage and no creeper death (round 77: 2 creeper deaths). The two deaths were 160 blocks apart.
- **Iron:** 4 of 6. hard1 had a kiln loaded with raw iron when the run ended. hard3 never got past wood. hard2 made the fastest hard iron pick since round 74 (1205 s), then lost it at the skeleton death.
- **Waterlogged fix:** working. The three `Water: head under` lines no longer name a slab head block, and two of them surfaced through open water.
- **Night mine:** 1 of 2 back in. hard1 re-sealed at the lower cell.
- **Obstruction probe:** 10 of 11. `chest_spot_blocked` is the expected refusal.

**Diagnosis: the normal3 drowning**
- At 12:06:04Z: `roof over the water at (837, 102, -446) (air 8, cherry_slab); digging it`. Then 23 s passed with no dig line and no fail line, and it drowned.
- **Cause:** a block dug by hand while floating under water takes 25 times as long (5x for the water, 5x for being off the ground). A slab takes about 75 s that way. Worse, mineflayer's `digTime` counts the water only when the eye block is named water. Under a waterlogged block it times the dig 5 times too short, sends the finish early, and then waits for a break the server never makes.

**Diagnosis: hard3's 25 minutes in one cell**
- **Box 4 under the surface:** three mornings in a row, `morning in a cave` at y=84 (surface 88) was followed by `the climb out stopped (Could not climb toward the surface from y=84)`. The ascend stops 4 blocks short of its target, so a box exactly 4 under never moved.
- **The creeper standoff:** after the walls opened, a creeper hovered 7.7-14.6 away and never came nearer. For 116 s the 20-block keep-away and the pillar fight swapped every few seconds. There was no headroom beside the box for a pillar, and the gather never ran.

**Fixes**
- **Roof dig against the air** (`get-out-of-water-task.js`). The dig is now timed first with `roofDigMs`, which puts back the 5x for a waterlogged eye block.
  - If that time is more than the air left (`airOf × AIR_UNIT_MS`, 750 ms) plus `DIG_AIR_MARGIN_MS` (4 s), the roof is not dug. The bot logs `the roof at P (...) would take N s to dig under water (air A); swimming for air up to 16 cells off`, and the pocket search then reaches `POCKET_FAR` (16) cells.
  - A dig still going after 1.5× its estimate plus 1.5 s is stopped with `stopDigging`. It logs `the roof dig at P did not finish in N s; giving it up`, and that roof is not tried again.
  - The dig line now carries the estimate, for example `(air 8, cherry_slab, 9.5 s)`.
- **Creeper stall** (`mobDefenseChain.js`). A chased creeper that has not come `CREEPER_CLOSE_STEP` (1 block) nearer in `CREEPER_STALL_S` (30 s) is left alone while it stays beyond `CREEPER_STALL_NEAR` (6).
  - It logs `Reflex: the creeper D away has not come nearer than C in N s; back to the job (fleeing it again inside 6)`.
  - It is also dropped from the rest of the ladder (the unarmed flee, the annoying-mob timers).
  - Inside 6 the chase starts over with a normal flee. A fusing creeper is answered either way.
- **Cave-morning climb** (`worker.js`). The climb out now aims at least `CAVE_EXIT_RISE` (5) above the box, using the sky goal (`spec.sky`), so a box 4 under the surface climbs too.

**Not changed yet**
- **hard2's skeleton death:** it happened right after the iron pick, during an ascend climb-out into a 14-mob crowd, and the respawn lost the pick.
- **hard1's night mine:** it could not climb back into the box (`Navigation timed out`) and re-sealed one cell lower.
- **normal3's respawn landing:** the line is missing from the dashboard log.
- **The shelter keeps its walls up for a creeper within 16.** hard3's three nights all used the same cave-box cell.
- **`chest_spot_blocked`:** the expected refusal.

## Round 80 (2026-11-01)

**Round-79 soak results** (Nitrous world copy, `efd7e7c`)
- **Deaths:** 6 (round 78: 2). hard1 2, hard2 3, hard3 1. All six were on hard runs; 3 skeleton, 2 zombie, 1 creeper fuse. None in water or lava, and no creeper death after a hover line.
- **Iron:** 3 of 6. normal2 made the first diamond on any round.
- **Stuck stretches:** two runs lost most of their time stuck in one spot. normal1 was in a flooded mine cell for 33 min. normal3 was on a pillar at y=217 for its last 7 min.
- **hard1** never got wood.
- **hard2** slept in a bed that was already in the world copy at (728, 71, -525), and three later respawns landed there.
- **Round-79 fixes:**
  - The creeper hover rule fired once, with no harm after it.
  - The slow-roof-dig timing and the cave-morning climb did not come up.
- **Obstruction probe:** 10 of 11. `chest_spot_blocked` is the expected refusal.

**Diagnosis**
- **normal1, the water loop:** the loop was at (703, 58, -373), with air 20 and health 20 the whole time.
  - The bot was breathing: the air reading is already the bot's own since round 70's `installOwnAir`.
  - Even so, the stale-air backstop latched every ~10 s once the head had read under water for 8 s. The swim to the pocket a cell up let go, and the resumed smelt job walked back in.
  - Each latch also cut off the job's 320-block search before the stair-out after it could run.
  - The paused smelt jobs piled up to 14. Each preempt paused them all, and each was resumed, because the resume loop only counted a newer *queued* job as superseding.
- **normal3, the pillar:**
  - The iron pick broke underground. The bot climbed out to y=93 on a mountain spike, then got stranded.
  - Each new job stranded again and pillared 3 more, 93 → 217, until it held no blocks.
- **hard1, the build logs:**
  - Every wood search from the spawn went for the oak logs at (723, 76-78, -518), which stand above a build's stone bricks.
  - It pillared into the build and dug out its `stone_brick_stairs` and `stone_bricks` by hand. It spent 9 minutes on wood searches and explores, and the night caught it with no wood.
- **hard3, the failed meal:** `meal failed - Cannot read properties of null (reading 'name')` came from the food chain eating the porkchops while the smelt job was loading them.

**Fixes**
- **Breathing spots** (`worldSurvivalChain.js`):
  - The stale-air backstop marks a spot as breathing when a second backstop episode happens there with the air and health still full. That is within `BREATH_SPOT_R` (2) of the last one, inside `BREATH_SPOT_MS` (180 s), at air 18 or more, with no health lost.
  - It then stays off there for 180 s while the air and health hold, and logs `the head read under water again at P with the air and health full (...); breathing here - no stale-air swim-up within 2 for 180 s`.
  - Low air, falling air and a silent health loss still latch.
- **Superseded jobs** (`worker.js` resume loop): a newer reflex-paused job now supersedes an older paused one, so only the newest resumes.
- **Meals:** the food chain defers a meal of the item a running smelt job is cooking, logged as `the smelt job is cooking X`. Other food is still eaten, and a critical meal goes ahead.
- **Stranded pillars** (`worker.js`, `strandPlan` / `strandDigDown`):
  - The strand pillar runs at most `STRAND_PILLAR_MAX` (2) times within 2 blocks of a column in 10 min.
  - After that, `still stranded at P after N pillars on this column; digging down instead`: the bot digs its own column 3 cells at a time and paths again after each step, up to 30 cells.
  - The dig never goes when the cell two below is a fluid or not solid.
- **Build logs** (`digDown.js` `builtLog`): a log beside a crafted block, or whose trunk stands on one, is neither a gather target nor a search target. A branch's air gap of up to 4 is passed over to what it stands above.

**Not changed yet**
- **The mineflayer oxygen patch** (PrismarineJS/mineflayer#4052) is already covered by round 70's own-air hook.
- **The pathfinder fixes** PrismarineJS/mineflayer-pathfinder#384 (water-containing blocks), #375 (no-path goto) and #393 (diagonal corners) are on master only, not released. They are candidates for a local patch.
- **Whether normal1's hole has a way out at all:** with the latch off, the stair-out now gets its turn, and the next soak shows whether it finds one.
- **The hard night deaths:** hard1 died to a skeleton while burrowing in a night crowd and to a zombie right after the respawn; hard2 died to a zombie 27 s after a box opened.
- **The pre-placed bed:** hard2 slept in a bed it found in the world, which set the spawn point there for later runs.
- **`chest_spot_blocked`:** the expected refusal.

## Round 81 (2026-11-01)

**What the round-80 soak showed** (`0130591`, report `2a8e3e9`)
- **The best round so far:**
  - Iron on 6 of 6 runs, for the first time; rounds 75-79 were 4/4/5/4/3.
  - 1 death, and a diamond on normal1.
  - hard1 and hard2 both finished death-free with an iron pick. hard1 slept a night in its own bed.
- **Round-80 fixes in play:**
  - The strand cap held: 5 pillar lines in the whole soak, and nothing above y=93.
  - The build logs were skipped, and every run got wood.
  - 5 superseded paused jobs were cancelled.
  - The breathing-spot rule never armed, because the soak had no water loop.
- **normal3, the chest-window thrash:** 597 `Window: closed a stale minecraft:generic_9x3 window left open before an equip` lines in 22 min on its chest row; hard3 had 109 more.
- **hard3, the death:**
  - A night box under a dark canopy opened on `skeleton 16.4 away; opening the walls`, with a crowd around the box that the morning never burned.
  - 6 s after the shelter completed: `Health or food is low`, then a flee.
  - `Ledge guard: stopped at (834, 87, -541)`, then the flee steered forward again, `Fall: dropping from (834, 86, -541)`, and `BuilderBot tried to swim in lava` 13 blocks below.
- **Log noise:** 1350 `no path with mob avoidance at P; trying without it` lines, about 2 a second while a gather retried one block.

**Fixes**
- **Sneak-place guard** (`worker.js` `guardPlace`):
  - The round-67 guard never installed. `connect()` ran it before mineflayer's plugins inject (a 0 ms timer), when `bot.placeBlock` did not exist yet, so it returned silently.
  - As a result, every placement against a chest opened it. That covers pillaring on the chest row and the pathfinder's scaffold blocks.
  - It now waits for inject with `afterInject`, the way `guardEquip` does.
- **Flee heading** (`night.js` `fleeHeading`, health passed from the run-away tasks and the reflex flee):
  - A drop is now read `FLEE_DROP_SCAN` (16) deep instead of 4.
  - The heading is ruled out, like a fluid, when any of these holds:
    - a fluid lies at the drop's foot;
    - the fall damage (drop less 3) would leave under 2 health;
    - the drop is `FLEE_DROP_DEADLY` (12) blocks or more.
  - Drops of 4 or more that are not lethal still cost 60, as before.
- **Crowd hold** (`waitCreeperClear`): after the creeper/skeleton hold, `SHELTER_CROWD` (6) or more hostiles within `REFUGE_CLEAR` (16) keep the walls up for at most `CROWD_WAIT_MS` (180 s), and never past the job's exit margin.
  - On holding it logs `Shelter: N hostiles within 16; keeping the walls up`.
  - On opening it logs `Shelter: N hostiles within 16[ after S s]; opening the walls`.
- **Log throttle:** `navigateNoAvoid` logs once per cell per `NO_AVOID_LOG_MS` (30 s), with the quiet repeats counted (`(N more here in S s)`).

**Not changed yet**
- **Picking the bed back up:** `Picked the bed back up ... (home is elsewhere)` 7 s after `Respawn point set` clears the respawn again.
- **Cave-morning climbs** stop at the cave roof: hard1 reached 68 against a surface of 90, hard2 89 against 91. The job completes there.
- **Night-mine climbs home** still time out on `Took to long to decide path to goal!`; the sump step-in covers it.
- **The unreleased pathfinder fixes** (#384, #375, #393) are still candidates.
- **`chest_spot_blocked`:** the expected refusal.

## Round 82 (2026-11-01)

**What the round-81 soak showed** (`f1bb669`, report `dbde182`)
- **The chest-window fix worked:** 0 `Window: closed` lines in the whole soak (round 80: 719). 19 `Store:` lines, and normal2 put 411 items away in four chests.
- **normal2 made the first diamond pickaxe of any soak** (2229 s), and a bed at 512 s.
- **Iron on 3 of 6** (all the normals), and **4 deaths**, none of them in the hard runs' first night box:
  - **hard2, lava**, 23 s after its box opened, during a cow fight. `in lava; escaping at (830, 73, -538) (head air, feet air)`, then `Lava guard: stopped at (830, 74, -538) ... job none` 0.2 s later. The escape logged two `no ground gained` headings, and the bot was dead 3.7 s in. It was the same cliff-foot pool as round 80's hard3.
  - **normal3, drowned** at (776, 48, -613):
    - A `use bucket` job went to a source in a flooded iron-band tunnel: `head under for 8 s ... (job use)`, then `produced no water bucket (3 tries)`.
    - After one swim-up, a coal gather took it back under. The roof was 14.1 s of stone, so the log said `swimming for air up to 16 cells off`.
    - 20 s with nothing logged, `Food: ate cooked_mutton` 6 s before the end, and drowned.
  - **hard1:** shot by a skeleton 52 s after its box opened, then a spider.
- **The no-avoidance line:** down to 421 from ~1350. A night-mine climb home still logged every stair cell, because each step is a new cell.
- **The crowd hold, flee drops and dig-down** never armed: no 6+ crowd at an opening, no ledge guard, and no strand past the cap.

**Fixes**
- **Lava guard vs the lava escape** (`worker.js` `lavaGuard`, `lavaHeld`):
  - The escape steers with the keys too.
  - With the lava under the feet rather than at them, the guard took the escape for a walk into lava. It stopped it and held its jump and sprint for `LAVA_HOLD_MS`.
  - Both now stand aside whenever `inLava` holds: lava at the feet, the head, or under the feet.
- **No meal with the head under water** (`foodChain.js` `deferReason`): `the head is under water` defers even a critical meal. A meal slows the swim for 1.6 s and heals nothing while drowning.
- **Bucket sources need a dry bank** (`autopilot.js` `waterBank`, used by `waterSource`): a solid, non-wet ground cell within `WATER_BANK` (2) of the source, at its level or one up, with air for the body and the head. A source in a flooded tunnel is not picked.
- **Air search log** (`get-out-of-water-task.js`): when the far air search (`POCKET_FAR`) comes up empty, it logs once `WorldSurvival: no air within 16 cells through the water (air A); heading for land at P` (or `no land within R either`).
- **Log throttle** (`navigateNoAvoid`):
  - It is now once per `NO_AVOID_NEAR` (4) blocks per 30 s, not once per cell.
  - The suffix reads `(N more within 4 in S s)`.
- **Water-containing blocks, upstream mineflayer-pathfinder #384** (`worker.js` `waterAware`, inside `guardDiagonals` in both movement builders):
  - Seagrass, tall seagrass, kelp, kelp plant, bubble columns and every waterlogged block now read as liquid to the planner.
  - Before this, the planner scaffolded through them, dove from them, and broke blocks beside them, letting the water in.
  - The waypoint half of the upstream fix lives inside the library's closure and is not taken.

**Tests:** `round82.test.js` (5) and `round82pf.test.js` (1). Fixtures updated:
- `water-bucket.test.js` and `round14.test.js` give their pools a dry bank;
- `round81.test.js` matches the new suffix.

**Not changed yet**
- **The other half of #393:** refusing diagonal moves that land one block up. `guardDiagonals` already refuses a diagonal past a blocked side. This comes next round, so each soak tests one pathfinder change.
- **Daytime skeletons after a box opens** (hard1): the morning line read nearest hostile 15.8.
- **Picking the bed back up, cave-morning climbs that stop at the cave roof, and night-mine climbs home that time out:** as in round 81.
- **`chest_spot_blocked`:** the expected refusal.

## Round 83 (2026-11-01)

**What the round-82 soak showed** (`fb7b80c`, report `de14afb`)
- **Iron on 6 of 6**, the second perfect iron round (round 80 was the first), with **2 deaths**, both hard2's. Wood, stone and furnace on all six. 0 meal failures.
- **The water counts fell** after the #384 change: `Water: head under` 1 (round 81: 6), `drowning` 1 (5), `searching 320` 0 (3), and no water death. The one episode was a clean swim-up on normal1.
- **The no-avoidance line:** 192 (round 81: 421).
- **The lava, bucket-bank, air-search and under-water meal fixes** were not exercised: no lava line, no bucket under water, no empty far air search. Two hard1 bucket refusals named the group's glass in the way, as designed.
- **hard3's cave morning climbed to its logged surface** (`Ascend: y=90 -> 98 (surface 98)`), the first of these rounds.
- **hard2's two deaths**, under the dark cherry canopy:
  - **Skeleton** at (854, 84, -588), 55 s after crafting an iron sword. At health 11 in a crowd of ~90 hostiles the fight gate refused (`health 11 below 14`), but the flee line read `(unarmed - COMBAT_SPEC 7f)`. A keep-distance hold stood down after 20 s with nothing within 8 in sight, and an arrow killed it 10 s later.
  - **Zombie** at its box (832, 87, -536), respawned without its kit. `morning (tod 1008, nearest hostile 24.2); opening up`, the wooden-sword craft preempted 0.2 s after the shelter completed, an unarmed flee, and dead 15 s later.
- **hard3 sat at hp 2.2 with food 17 for 7 minutes** at (827, 90, -453), 13 food items held. A creeper hovered 4.7-8.5 away for 488 s. The keep-away read as acrobatics and as a fight, so FoodChain stood aside the whole time. It ate four meals within 30 s once the hover was released.

**Fixes**
- **Meals through a creeper keep-away** (`mobDefenseChain.js` `mealKeepAway`, `foodChain.js` `keepAwayMeal`):
  - Under `criticalHealth` (10), a meal goes ahead while Mob Defense runs a `RunAwayFromCreepersTask` with no creeper fusing or nearer than `CREEPER_MEAL_NEAR` (5), and no other hostile within `MEAL_CLEAR` (8).
  - Both the acrobatics gate and the mid-fight deferral stand aside. The keep-away keeps steering while the bot eats.
  - Logged once per episode: `Food: eating through the creeper keep-away (health H, food F)`.
- **The flee line names the real gate** (`_escapeLadder`): an armed bot reads `(armed, but <reason> - COMBAT_SPEC 7f)`, for example `health 11 below 14` or `N melee mobs (max 2)`. An unarmed one still reads `(unarmed - COMBAT_SPEC 7f)`.
- **The unarmed morning crowd** (`waitCreeperClear`): with no sword or axe held, the crowd is counted out to `UNARMED_CLEAR` (32) instead of 16, logged `Shelter: N hostiles within 32 (no weapon held); keeping the walls up`. The cap is still `CROWD_WAIT_MS` and the job's exit margin.
- **Raised diagonals, upstream mineflayer-pathfinder #393** (`worker.js` `guardDiagonals`, now exported): no diagonal that lands one block up. The jump clips the corner of the step and the bot falls back short of the node. The straight jump-up and a flat step cover the same climb. This is the one pathfinder change in this soak.

**Tests:** `round83.test.js` (5). No fixture changed.

**Not changed yet**
- **Keep-distance stand-downs in reach of a skeleton** (hard2's first death): `nothing within 8 in sight` does not cover a bow at 15. One death is not enough to change the stand-down, which was added for frozen holds.
- **The 7-minute silence during a creeper hover:** nothing logs while the keep-away holds.
- **Picking the bed back up, night-mine climbs home that time out, and `chest_spot_blocked`:** as before.

## Round 84 (2026-11-02)

**What the round-83 soak showed** (`97b129d`, report `c2b5b5c`)
- **Iron on 6 of 6**, the third perfect iron round (80, 82, 83), with **4 deaths**, one each on normal3, hard1, hard2 and hard3. Every run ended holding its pick. Hard iron 1356/1385/1991 s (round 82: 1416/1539/2259).
- **#393 (no raised diagonals):** iron was faster on five runs. `Job: no path` 8 (round 82: 3), `no path with mob avoidance` 201 (192), `Pillar: no rise` 0, `stranded` 0. No sign that it made climbs worse.
- **The round-82 lava escape held on its first live use:** normal3 `in lava; escaping` with no `Lava guard:` after it, and it was out alive. It died 58 s later in a second pool, 17 blocks lower, with no escape line. That is one data point.
- **The round-83 changes:**
  - The armed flee label fired 8 times (`armed, but night in the open without armour`, `armed, but health 12 below 14`).
  - Both `unarmed` lines were correct.
  - The keep-away meal and the unarmed morning crowd were not exercised.
- **hard1 and hard2 died to zombies** in the hard crowds round (830, 90, -500..-540): 77 and ~90 hostiles named on one flee line. Crowds this size are on every round's flee lines since 2026-10-21, so not new. hard1 swung between a strike and a `(vulnerable)` flee every half second while the smelt and craft jobs resumed in between. It died 4 s into a stone-pickaxe craft.
- **hard3 was shot dead on its night mine**, the one death with a clear bug behind it:
  - Its dusk box at (856, 93, -544) had a torch in the head ring: `open cells 857,94,-544=torch`, then `re-seal left 1 open`.
  - The night mine went down 2 s later anyway.
  - On the way back, the sample at 18:06:45 read health 20, and at 18:06:54 it `was shot by Skeleton` at the box, with no Reflex line in between.
  - Cause: the shelter job's hold turns Mob Defense off for everything but a creeper. That covered the night mine, out of the box, as well. In the whole dashboard log, Mob Defense acted on a night mine only through the creeper override (`creeper at D overrides the shelter hold`), never for a zombie or a skeleton.

**Fixes**
- **Mob Defense on the night mine** (`worker.js`: `survivalHold` gains `mining`, plus `mineThreat` and `nightMineOverride`):
  - While the night mine is out of the box (`nightMining`, and the box no longer sealed), the hold lets Mob Defense through for a hostile within `NIGHT_MINE_GUARD` (8), or for a hit in the last `MINE_HURT_MS` (3 s; `onHealth` now marks `hurtAt`).
  - Logged `Reflex: <a zombie within 8 | a hit> on the night mine; Mob Defense answers`.
  - Its preemption pauses the shelter job. The resumed job seals a new box where the bot stands, the path a world-survival escape already takes.
  - In the sealed box, nothing changes.
- **No night mine from an open box:** a box with an open cell after the re-seal is held, logged once per night as `Night mine: not from a box with N open cell(s); holding the box`.
- **Torches in a shell cell** (`SHELTER_NOTCH` gains `.*torch`): dug out like a flower before the block goes in.

**Tests:** `round84.test.js` (4). No fixture changed.

**Not changed yet**
- **The hard crowd thrash** (hard1): strike, flee and job resumes alternating in a crowd of 77. It needs more than one death to shape.
- **normal3's second lava pool:** no escape line before the death. Needs the next soak's lava lines.
- **From round 83:** keep-distance stand-downs in reach of a skeleton, the silence during a creeper hover, picking the bed back up, night-mine climbs home that time out, and `chest_spot_blocked`.

## Round 85 (2026-11-02)

**What the round-84 soak showed** (`77339a2`, report `2f1deef`)
- **Iron on 4 of 6, 12 deaths: hard1 11, hard3 1.**
  - The normals were clean: 0 deaths, iron at 602/633/693, and beds on normal1 and normal3.
  - hard2 was the model hard run: 0 deaths, iron at 1356 s, a bed at 1055 s, and the round's one ore-bearing night mine (back in, sump filled, 6 ore items).
- **The round-84 night-mine fix worked on its first live use** (hard2). `Reflex: a skeleton within 8 on the night mine; Mob Defense answers` led to `Shelter: moved from 803,90,-500 to (803, 87, -499); building a new box here`, then `sealed` 6 s later. Health stayed at 20, with no damage in the 2 minutes after.
  - The open-box hold and the torch dig-out were not exercised: no seal left an open cell this round.
- **The round-83 no-weapon crowd hold fired for the first time** (hard3): `8 hostiles within 32 (no weapon held); keeping the walls up`, then `opening the walls` 180 s later, with no damage after it.
- **hard1's spawn-kill loop, the round's story.** Nine deaths in 110 s at the world spawn (01:17:06 → 01:18:56Z), with 12-90 hostiles named on the flee lines there:
  - Each night respawn logged `Autopilot: respawned at night; shelter at the spawn point first`.
  - The shelter job's hold then switched Mob Defense off, the same hold that round 84 opened for the night mine.
  - Meanwhile the empty-handed bot tried to burrow (`not here (open wall beside ...)`, `no block for the cap`, `did not sink`) or found `Short of shelter blocks: 0 held`.
  - A zombie (once a drowned) killed it 10-40 s after each respawn.
  - The only `Reflex: fleeing` lines in the loop came in the instant after a death, when the death pause had lifted the hold. Dawn ended the loop.
- **hard3:** a creeper 24 s after its box opened at dawn (`creeper at 6.0 overrides the shelter hold`, then the flee, then `blown up`). That was the first creeper kill since round 81, a single case. After that it worked the round-79 river cell, and the round-80 dig-down fallback fired 15 times.
- **Path counts against round 83:** `Job: no path` 9 vs 8, took-too-long 13 vs 26, no-avoidance 244 vs 201 (largest N 43), `Cannot reach` 13 vs 20. There were no lava lines at all, `Window: closed` was 0 for the third round running, and probe 10/11.

**Fix**
- **A shelter after a death is guarded** (`worker.js`: `survivalHold` gains `respawned`; `respawnGuard`, `RESPAWN_GUARD_MS` 180 s):
  - For 3 minutes after the last death, until the shelter seals (box or burrow), the night-mine threat test applies to the shelter hold too: a hostile within 8 or a hit in the last 3 s lets Mob Defense through.
  - This covers a shelter queued behind the death pause as well as a running one.
  - Logged `Reflex: <a zombie within 8 | a hit> after a night respawn; Mob Defense answers`.
  - Its preemption pauses the shelter. The resumed job builds where the flee left the bot (`Shelter: moved from ...`), away from the spawn crowd.
  - With no recent death, or once sealed, nothing changes.
- **The death is not a hit:** `onHealth` no longer marks `hurtAt` when the health falls to 0, so the guard does not read the death itself as a fresh hit.

**Tests:** `round85.test.js` (3): the hold flag and the override truth table; the death and the respawn heal are not hits; the real gate lets Mob Defense answer a zombie at 5 after a death, and does not without one or once sealed. In `round84.test.js`, the `survivalHold` deep-equal now carries `respawned:false`.

**Not changed yet**
- **hard3's creeper at the box opening.** One case, and the override and the flee both fired.
- **Cave-morning roof stops** (hard2 `y=87 -> 91 (surface 98)`). Left alone, as in rounds 79-84.
- **From round 84:** the hard-crowd thrash, a second lava pool (none this round), skeleton-reach stand-downs, the hover silence, picking the bed back up, night-mine climbs that time out, and `chest_spot_blocked`.

## Round 86 (2026-11-02)

**What the round-85 soak showed** (`7e26437`, report `5db178e`)
- **Iron on 6 of 6 with 2 deaths** (0/0/0/1/1/0). This is the fourth perfect-iron round (80, 82, 83, 85). Hard iron came at 1507/512/1989 s, and hard1 slept twice in its own beds.
- **The round-84 spawn-kill loop is gone.** No death was a night respawn, so the round-85 respawn guard never fired (0 `after a night respawn` lines) and was not exercised. No run died within 120 s of a respawn.
- **The round-84 night-mine line worked again** (hard2): `a zombie within 8 on the night mine; Mob Defense answers`, then `moved from 847,97,-516`, then `sealed` 7 s later, with no damage.
- **Both deaths were creeper fuses with the flee going nowhere:**
  - **hard1** was at a crafting table in a y=45 tunnel. `fleeing creeper` came at 09:00:01.5, `creeper fuse (swell 1) sprinting past 7` at 09:00:03.1, and it was blown up 1.4 s later, one block from the table at (850, 45, -538). The tunnel gave the flee nowhere to go.
  - **hard2** was on a mountain shelf 10 s after its box came down at dawn. `fleeing creeper` came at 09:18:32, then `followed for 3 s; keeping 20 away`, then the fuse at 09:18:36.1, and it was blown up 1.5 s later, 4 blocks from where the flee began. It held no sword, because its pick had just broken.
  - hard1 held 157 cobblestone. A fusing creeper stops walking, so a block between it and the bot cuts the blast.
- **Path counts:** `Job: no path` 44 vs 9, mostly the bag-full wood searches at the west river on normal2 and hard2 (25 `searching 320` each). No-avoidance 304 (largest N 46), took-too-long 23, `Cannot reach` 12. There were 0 lava lines, 0 `Window: closed`, and probe 10/11.

**Fix**
- **The fuse wall** (`fallbackTasks.js`: `RunAwayFromCreepersTask(distance,{fuse:true})`, `fuseWallCells`; `FUSE_WALL_NEAR` 4, `FUSE_STUCK_S` 0.4, `FUSE_STUCK_BLOCKS` 0.8, `FUSE_WALL_TRIES` 2):
  - When does it fire? The fuse flee (`mobDefenseChain.js`, the swelling band) now walls when a fusing creeper is within 4 and the flee has not moved the bot 0.8 blocks in 0.4 s.
  - Which cells? The feet and head cells beside the bot toward the creeper, on both axes when it stands diagonal, larger axis first.
  - How is each block placed? Against the floor under the cell, the ceiling over it, or the block beyond it, with a pillar block (cobble, deepslate, netherrack, dirt or planks). Placements are one per 0.25 s, and a cell gets 2 tries at most.
  - A cell the creeper stands in is not built into.
  - The bot holds behind the wall until the fuse ends. If no wall cell stands, it keeps fleeing.
  - Logged `Reflex: creeper fuse at D and the flee is not moving the bot; walling N cell(s) toward it`.
  - The keep-away flees (10 and 20) never wall.

**Tests:** `round86.test.js` (4): the wall cells and the diagonal; the round-85 hard1 tunnel walled in two placements with one log line and the bot holding; no wall while moving, with no blocks, without a fuse, with the creeper beyond 4, or from the keep-away flee; the block-beyond reference and a creeper standing in the cells.

**Not changed yet**
- **The round-85 respawn guard:** still to be exercised.
- **The bag-full wood searches at the west river** (normal2 and hard2: 25 `searching 320`, `No matching blocks` 22-24). The runs still reached iron. Look again if the count holds.
- **From round 85:** hard3's creeper at a box opening (round 84), cave-roof stops, the hard-crowd thrash, skeleton-reach stand-downs, the hover silence, picking the bed back up, night-mine climbs that time out, and `chest_spot_blocked`.

## Round 87 (2026-11-03)

**What the round-86 soak showed** (`8075696`, report `2ce4ec6`)
- **Iron on 5 of 6 with 1 death** (0/0/0/0/0/1). It was not promoted: hard3's connection wedged ten minutes after its death (a `window_click` PACKET_RATE storm, then a keepalive kick), and its last samples and final read timed out. Hard iron came at 2200/1990 s and hard3 had none. normal3 reached a diamond pickaxe at 1928 s.
- **No creeper death for the first time since round 83.** All three `creeper fuse (swell 1)` lines (hard3) had a walling line within 0.5 s. No `blown up by Creeper` appeared anywhere. The log cannot show whether a block went down: wall 1 held 107 cobble (one went between samples), and walls 2 and 3 came after the respawn with no cobble or planks on the samples.
- **The one death was a drown in hard3's iron staircase.** `Water: head under for 8 s at (788, 60, -610) with no swim-up; holding jump` came three times over 23 s with no rise. Then `drowning (air 8), swimming up`, `air at (788, 63, -610), 3 cell(s) through the water`, `open water 1 up (air 5); swimming straight up`, and 11 s later the drown at (789, 61, -610). The floored position flipped between x 788/789 and z -609/-610. So the body (0.6 wide) stood on a cell corner, held under the roof of a neighbouring column, and every flip restarted the 3 s no-rise clock, so `no rise` never fired.
- **The round-85 respawn guard was not exercised** (0 lines; 0 deaths within 120 s of a respawn).
- **The round-84 night-mine line fired twice** (hard2, hard3), both sealed with no damage. One `not from a box with 1 open cell(s)` was air, not a torch.
- **Path counts:** `Job: no path` 4 (vs 44), took-too-long 7, no-avoidance 216 (largest N 41), `Cannot reach` 14, `searching 320` 1. The round-85 bag-full river searches did not recur. 1 `Window: closed`, 0 lava lines. Probe 10/11, the same shape as round 85 (the shelter_hole `end_pos` one cell off the box).

**Fix**
- **Swim up from a corner** (`get-out-of-water-task.js`: `riseBlockedCentre`, `BODY_HALF` 0.3):
  - When the body overlaps a column with a solid block where the head rises next (the head-top cell and the one above), it returns the centre of an overlapped column that is open there, the floored one first. If nothing overlapped is blocked, or no overlapped column is open, it returns null (the pocket search handles that).
  - `GetOutOfWaterTask`'s straight-up branch looks at that centre and holds forward with jump until the body is in the open column. Logged once: `WorldSurvival: the body at P is under a roof beside the column; centring to (x, z) to swim up`.
  - The no-rise clock now restarts on a rise or a horizontal move of 1 block, not when the floored column changes.
  - The sink guard (`worker.js` `sinkGuard`, the 8 s backstop) does the same centring while no path is steering. The head-under line ends `; centring to (x, z) off a roof beside the column`, or a later line says it once.
- **A window-click runaway fails its click** (`compat.js`, `WINDOW_CLICK_RUNAWAY` 200 a second). This is hard3's wedge 10 min after the drown:
  - What happened: `Runner: closed the open crafting window for Mob Defense` at 17:16:51.8, then from 17:17:11Z about 2 million `window_click` a second for 28 min. 3.1 billion were dropped by the packet budget, the event loop stalled, and the server kicked the bot for keepalive.
  - Why the loop never ends: mineflayer's `putSelectedItemRange` loops while the window it was handed has a cursor item, but `clickWindow` clicks `bot.currentWindow || bot.inventory`. Once that window is closed, the loop clicks the inventory forever.
  - It is not new: an early round in the snapshots shows the same storm (1.06 million a second) right after a preemption stop.
  - The fix: the 201st click in 1 s throws from the write. `clickWindow` rejects and the loop ends. It logs `PACKET_RUNAWAY window_click N in 1 s (window W slot S); failing the click to end the loop`, at most every 10 s.
  - Real play peaks at 88 a second (all snapshots), and our crafting clicks are paced 240 ms apart.
- **The fuse wall says how it ended** (diagnostic only, `fallbackTasks.js` `_wallDone`): `Reflex: the fuse wall is done: N block(s) placed, S of C cell(s) standing (held ITEM COUNT)`, once per wall.

**Tests:** `round87.test.js` (6):
- the centre for a side overlap, a floored-into-the-roof overlap, a diagonal, an inside position, no roof, and all roofed;
- the task centring and then rising straight;
- a corner flip between two open columns now tripping the no-rise line, while a real rise does not;
- the sink guard centring with no path steering, letting go when centred or out of water, the late line, and leaving a path alone;
- the wall done line;
- a closed-window click loop ended at click 201, with other packets still going and paced clicks never tripping it.

**Not changed yet**
- **Why the crafting window was still open** when Mob Defense closed it (the table kept by `keepTable` after the wooden-pickaxe craft), and which mineflayer call was mid-loop. The guard ends the loop. The caller is not known yet; the job error `Window click runaway` will name it.
- **The round-85 respawn guard:** still to be exercised.
- **From round 86:** cave-roof stops (hard2 stopped 2 below the surface), the hard-crowd thrash, skeleton-reach stand-downs, picking the bed back up, night-mine climbs that time out, and `chest_spot_blocked`.

## Round 88 (2026-11-03)

**What the round-87 soak showed** (`ef17573`, report `ae1919d`)
- **Iron on 5 of 6 with 3 deaths** (0/0/0/1/2/0), the triple promoted, every run its full length, `errors` empty. normal1 wore the full iron kit at 906 s. hard2 missed iron: it lost both lives in its first 28 minutes and rebuilt to a furnace at 2411.
- **Neither round-87 fix was exercised.** 0 centring lines (the one head-under episode, hard3's, surfaced straight up), 0 `no rise`, 0 `PACKET_RUNAWAY`, 0 `last: window_click`, 0 kicks. The round-86 fuse wall did not fire either: no creeper reached fuse range. 0 creeper deaths.
- **The three deaths** (all in the hard crowd east of spawn, ~90 hostiles loaded on every flee line there):
  - **hard1** (zombie): the morning box at (845, 103, -470) opened at tod 1022 with the nearest hostile 21.5, took 40 s to come down, and the bot was dead 4 s after `Completed shelter`. Health was 20 on the sample 13 s before. It held a stone sword; the flee was `(vulnerable)` (armour 0, health under 18).
  - **hard2** (zombie): mid stone-gather at t 321, two one-hit fights 0.4 s apart, a `(vulnerable)` flee, dead 2 s later. It held wooden tools only.
  - **hard2** (skeleton): `morning in a cave (8 hostiles within 24, sky 0)`, the stair-out `dug 3 steps up east`, `Ascend: y=85 -> 88 (surface 90)`, `Completed shelter`, shot 9 s later. The climb out ended under the cave roof.
- **Cave climb-outs end under the roof often.** In the logs since 2026-10-26, 11 of 26 cave mornings ended 1-22 under the surface after a stair-out (`74 -> 78 (surface 88)`, `64 -> 68 (surface 90)`, `87 -> 91 (surface 98)` ...). Why: the round-40 pillar only runs when the climb rose 2 or less, and the stair-out rises 3-4, so `ascend` returned with no sky and the shelter job completed.
- The round-84 night-mine line fired twice (moved and re-sealed, no damage), the round-83 crowd hold once (180 s), probe 10/11.

**Fix**
- **A sky climb pillars on to the sky** (`worker.js` `ascend`): when an ascend that wants the sky (`sky` from the cave morning, or `forFood`) has risen but is still under the surface anchor with no sky over the head, it pillars up (`pillarUp` with the same `safe` ceiling rule, up to `ASCEND_PILLAR` 24 digs) until the head cell reads sky. Logged `Ascend: no sky at y=N after the climb (surface Y); pillaring to the sky`. It stays out of a climb that reached the sky, a bot at or over the anchor (a canopy), and an ascend that does not want the sky.
- `pillarUp` takes an `until` stop condition.
- **The death line says what happened** (diagnostic only, `deathContext`): after `Bot died at`, `Death: health 20 -> 15.5 -> ... -> 0 in the last 10 s; armour A; held ITEM; N hostile(s) within 8: zombie 0.8, ...`. The health trail is kept from `onHealth` for `DEATH_TRAIL_MS` 10 s.

**Tests:** `round88.test.js` (5): the round-87 hard2 climb pillaring to the sky; no pillar after a climb that reached the sky, at the anchor under a canopy, or on a plain ascend, and a food ascend pillaring; `pillarUp` stopping on `until`; the death line's trail, armour, held item and near hostiles; `onDeath` logging it and clearing the trail.

**Not changed yet**
- **The `(vulnerable)` flee with a sword held** (hard1): with no armour any hit under 18 makes the bot flee rather than fight, in a crowd it cannot outrun. The new death line should show whether the flee or the fight would have been better before this is touched.
- **The 40 s morning box takedown** (hard1): the walls come down cell by cell with zombies approaching; the round-72 creeper/skeleton wait does not count zombies.
- **From round 87:** why the crafting window was still open (the click guard has not fired yet), the round-85 respawn guard (still unexercised), the hard-crowd thrash, skeleton-reach stand-downs, picking the bed back up, night-mine climbs that time out, and `chest_spot_blocked`.

## Round 89 (2026-11-03)

**What the round-88 soak showed** (`63915fc`, report `828cd20`)
- **Iron on 6 of 6, 1 death** (0/0/0/1/0/0), the triple promoted, every run its full length, `errors` empty, 0 kicks, 0 uncaught. Path counts 9 / 0 / 206 / 14 / 2 (no path / took-too-long / no-avoidance / Cannot reach / searching 320), probe 10/11.
- **The round-87 click guard fired for the first time** (hard3, 15:47:13Z): Mob Defense closed the crafting window, then `PACKET_RUNAWAY window_click 200 in 1 s (window 0 slot 10); failing the click to end the loop`. The loop stopped, no kick, and the bot crafted and gathered on 30 s later. No `Window click runaway` job error followed: the loop was not inside a job's own click (the gather had been preempted), so the caller is still not named. Window 0 is the player inventory, so the loop moved from the closed table to the inventory.
- **The one death** (hard1, skeleton): `morning in a cave (4 hostiles within 24, sky 0)`, the stair-out `dug 2 steps up east` inside the navigation, `no path up from y=62; pillaring`, `Ascend: y=62 -> 88 (surface 92)`, `Completed shelter`, fleeing `(armed, but health 11 below 14 - COMBAT_SPEC 7f)`, shot 8 s later. The new death line: `health 11 -> 11.8 -> ... -> 14.2 -> 5.2 -> 6.2 -> 0; armour 0; held dirt; 0 hostile(s) within 8` (shot from beyond 8). The sample at y=73 mid-pillar was health 20, so it lost 9 on the 27 s climb with nothing in the log.
- **Why the round-88 sky pillar missed it:** the stair-out rose only 2, so the round-40 no-path pillar ran instead, and its segments stop at the surface - 4 (88 under 92). The round-88 branch was an `else` of that pillar, so it never looked at the sky there.
- **The round-88 sky pillar fired once** (hard3): `no sky at y=59 after the climb (surface 89); pillaring to the sky`, ending `y=55 -> 76`. No damage after; it fought two skeletons and went on. The pillar stops on the head-sky reading, so 76 was most likely open sky in a ravine under a surface anchor of 89, but nothing in the log said so. The other two cave mornings (hard2, `80 -> 84 (surface 89)` and `86 -> 90 (surface 91)`) did not take the branch, which means the head read sky there.
- 0 fuse walls, 0 creeper deaths, 0 night respawns, 0 centring lines.

**Fix**
- **The sky pillar also follows a no-path pillar** (`worker.js` `ascend`): the round-88 sky pillar is no longer an `else` of the round-40 pillar. A sky climb whose no-path pillar reached the surface - 4 with no sky over the head pillars on to the sky. A no-path pillar that stopped short of its own target (a ceiling it may not dig, or no blocks) is not tried again. Escape ascends are unchanged.
- **A sky climb says how it ended** (diagnostic only): before the `Ascend: y=` line, `Ascend: head sky S at y=N; health A -> B on the climb`.

**Tests:** `round89.test.js` (2): the round-88 hard1 climb (stair-out 2, no-path pillar to 88 under 92, then the sky pillar, with the head-sky and health line); a pillar short of its own target not retried, and an escape ascend keeping its old lines. `round88.test.js` updated for the new head-sky line. 783 pass, resources 9.

**Not changed yet**
- **The flee at health 11 in a cave-morning crowd** (hard1): the climb came out at health 11 into a crowd at tod ~1000 and the bot fled under skeleton fire. The new climb line will show how much health climbs cost.
- **The flee that does not move** (hard3, 15:47:43Z): `RunAwayFromHostilesTask held 20 s without moving the bot (health 20, food 20, nothing within 8 in sight); standing down for 60 s`, the run-up to the click runaway.
- **From round 88:** the `(vulnerable)` flee with a sword held, the 40 s morning box takedown, the click-loop caller, the round-85 respawn guard (unexercised), the hard-crowd thrash, skeleton-reach stand-downs, picking the bed back up, night-mine climbs that time out, and `chest_spot_blocked`.

## Round 90 (2026-11-04)

**What the round-89 soak showed** (`ae8e24c`, report `28955b9`)
- **Iron on 5 of 6, 3 deaths** (0/0/0/1/0/2), the triple promoted, every run its full length, `errors` empty, 0 kicks, 0 uncaught, 0 `PACKET_RUNAWAY`. Path counts 11 / 11 / 214 / 20 (no path / took-too-long / no-avoidance / Cannot reach), probe 10/11. hard2 set a respawn point and placed a bed; hard1 never got a furnace.
- **hard1, zombie, 11 s after a cave morning.** The night box at (806, 58, -534) sealed with silverfish inside (`Shelter: hitting silverfish inside the box`); health went 20 -> 7.3 -> 4 and stayed 4 for five minutes at food 17, saturation 0 and no food in the bag (no regeneration under 18). Then `morning in a cave (6 hostiles within 24, sky 0)`, a 4-step stair-out to y=62, `no sky at y=62 after the climb (surface 89); pillaring to the sky`, `head sky 0 at y=86; health 4 -> 4 on the climb`, `Completed shelter`, a `(vulnerable)` flee from 97 loaded hostiles, and `Death: health 4 -> 0; armour 0; held stone_sword; 1 hostile(s) within 8: zombie 1.3`.
- **Why the sky pillar stopped short:** its target was `from + ASCEND_PILLAR` (62 + 24 = 86), 3 under the surface of 89, so `pillarUp` stopped on the target with the roof still on.
- **hard3, creeper, 79 s after a morning box:** `creeper fuse (swell 1) sprinting past 7`, then `creeper fuse at 1.1 and the flee is not moving the bot; walling 2 cell(s)`, blown up 1.0 s later from health 20, no `the fuse wall is done` line. The other wall (2.6) survived.
- **hard3, zombie:** after that respawn with an empty bag, `(unarmed - COMBAT_SPEC 7f)` in an 83-hostile crowd at food 6.
- The second cave morning (hard1) took the no-path pillar to `head sky 14 at y=86 (surface 86)`. No climb lost health (largest loss 0). The night-mine Mob Defense line fired once (hard2), moving to a new box.

**Fix**
- **The sky pillar goes up to the sky over the surface** (`worker.js` `ascend`): its target is `max(from + ASCEND_PILLAR, surface + SKY_OVER)`, `SKY_OVER` 6, so a long climb stops on the head-sky reading, not 24 above where it started. The dig budget is still `ASCEND_PILLAR`.

**Tests:** `round90.test.js` (2): the round-89 hard1 climb (target 95, not 86, stopping at the sky at y=90); a short climb under a low surface keeping the 24 target. 785 pass, resources 9.

**Not changed yet**
- **Silverfish in a night box** (hard1): the box sealed in an infested patch and the bot lost 16 health inside it. And with no food, health 4 at food 17 does not regenerate.
- **The late fuse wall** (hard3): the swell was first seen 7 away while the flee sprinted past it; the wall at 1.1 came too late.
- **From round 89:** the flee at low health in a cave-morning crowd, the flee that does not move, the `(vulnerable)` flee with a sword held, the 40 s morning box takedown, the click-loop caller, the round-85 respawn guard (unexercised), skeleton-reach stand-downs, picking the bed back up, night-mine climbs that time out, and `chest_spot_blocked`.

## Round 91 (2026-11-04)

**What the round-90 soak showed** (`020da7f`, report `39d88b0`)
- **Iron on 6 of 6, 1 death** (0/0/0/0/1/0), the triple promoted, every run its full length, `errors` empty, 0 kicks, 0 uncaught, 0 `PACKET_RUNAWAY`. Path counts 4 / 3 / 226 / 10, probe 10/11. hard1 crafted a bed and wore 2 armour pieces; nobody slept.
- **The round-90 sky pillar did not run:** 0 `no sky at y=N ... pillaring to the sky` lines. Three head-sky lines: hard2 sky 15 at y=87 and y=85, and hard3 `head sky 0 at y=80` with the logged surface also 80, 3.8 s before the run stopped. No climb lost health. 0 silverfish boxes.
- **hard2, zombie, at dusk in bed prep.** By day at (827, 65, -612) a gather was stopped by `Health or food is low` with about 80 loaded hostiles, and health sat at 11.7 for two minutes. At dusk it finished the furnace, hunted sheep and queued `craft white_bed` at (847, 71, -625), with health 18.2 on the t=2018 sample. A creeper had followed it: `keeping 20 away`, then two fuses (2.7 and 1.9), each walled, neither blew. Then 44 s of `has not come nearer than 2.9`, a `(vulnerable)` flee, and `Death: health 3.7 -> 4.7 -> 5.7 -> 1.2 -> 0; armour 0; held stone_sword; 1 hostile(s) within 8: zombie 1.2`. The samples at t=2018 and t=2048 and the death are all at (847, 71, -625). The flees held the bot in one cell for its last minute while health went 18.2 -> 3.7, and the zombie at 1.2 was never hit back.
- **Six fuse walls, no done line:** each swell was first seen `sprinting past 7`, and the wall followed in under 0.5 s at 1.9-2.8. No creeper death. The chain swaps the fuse flee for a plain flee when the swell ends, so the stopped task never logged its wall.

**Fix**
- **A pinned flee is cornered** (`mobDefenseChain.js`). A run-away, creeper keep-away or keep-distance that has kept the bot within `FLEE_PINNED_BLOCKS` 1 for `FLEE_PINNED_S` 2 s, with a melee mob (not a creeper) within `PINNED_NEAR` 3 in sight, becomes the 7f last-resort fight (`KillEntitiesTask` lastResort, best weapon). It keeps on while one stays within `PINNED_KEEP` 5, and logs `Reflex: the TASK has kept the bot in one spot for N s with MOB D away (health H, held ITEM, heading hazard X [blocked]); cornered - fighting back`. It sits after the fuse flee and the night pillar, before the creeper keep-away and the vulnerable flee.
- **Diagnostic:** the run-away and keep-distance tasks keep the heading they chose (`task.heading`). A fuse flee stopped while walling logs `the fuse wall is done ... - the fuse flee was replaced`.

**Tests:** `round91.test.js` (4):
- the hard2 shape: a vulnerable flee pinned 2 s with a zombie at 1.2, then a fight that keeps on at 4 and ends past 5;
- no cornered fight for a flee that moves, a zombie behind a wall, a creeper only, or a skeleton;
- a creeper keep-away pinned with a zombie fights the zombie only, and the line names the heading;
- the done line on stop, once.

789 pass, resources 9.

**Not changed yet**
- **Why the flees did not move the bot** at (847, 71, -625): the new line's heading hazard should say whether it was cornered (100, blocked) or walking into a wall (20).
- **Health 11.7 for two minutes** at food 15-18 by day, before the dusk bed prep. And bed prep at dusk with a creeper following.
- **The hard3 cave morning** that stopped at `head sky 0 at y=80` with a surface of 80 (the sky pillar only runs under the surface).
- **From round 90:** silverfish in a night box, no regeneration without food, the late fuse wall, the 40 s morning box takedown, the click-loop caller, the round-85 respawn guard (unexercised), picking the bed back up, night-mine climbs that time out, and `chest_spot_blocked`.

## Round 92 (2026-11-04)

**What the round-91 soak showed** (`11ec45b`, report `73d2ba1`)
- **Iron on 5 of 6, 1 death** (0/0/0/0/0/1), the triple promoted, every run its full length, `errors` empty, 0 kicks, 0 uncaught, 0 `PACKET_RUNAWAY`. Probe 10/11. normal1 made a diamond pick at 2288 s; hard1 crafted a bed at 2198 s; nobody slept.
- **The round-91 cornered fight did not run:** 0 `cornered - fighting back` lines. 0 fuse walls, so the new done-line ending was not exercised either.
- **The sky pillar ran twice** (hard1 and hard2 cave mornings). Both reached head sky 12 or more, with no health lost.
- **hard3, skeleton**, at (933, 53, -431) in a crowd of 89-91 loaded hostiles, ledge-guarding a drop, `held iron_sword`, health 17.6 -> 11.6 -> 0. The last flee was `(armed, but health 12 below 14 - COMBAT_SPEC 7f)`. It was not pinned: the bot moved about 1.4 blocks in its last 30 s.
- **hard2 lost its last day in its box** at (817, 88, -552), from t=1505 to the end, with no furnace and no iron.
  - The box was sealed at 07:46:32, and dawn came at 07:49:30. It stayed sealed for 5 minutes, waiting for a clear morning.
  - `Shelter: morning (tod 7020, nearest hostile 6.2); opening up` at 07:54:30.
  - 1.5 s later: `Reflex: creeper at 6.0 overrides the shelter hold`. removeShelter takes the outer cells first and the bot's own walls last, after its creeper wait. So the walls beside the bot were still standing when Mob Defense preempted it.
  - Then 4.5 minutes of `fleeing creeper` / `keeping 20 away` and three `fighting it from a pillar` (hits 0) that never moved the bot. The creeper could not reach it, and the stall rule never fired: the creeper stayed at about 6, and the chase restarted every 20-30 s.
  - The shelter job and then the goto were superseded. Dusk came at 07:59 and it sealed again.

**Fix**
- **A box coming down holds against a creeper while the bot's column stands** (`worker.js`).
  - `removeShelter` now sets `shelterOpening` for the whole takedown, and `survivalHold()` reports it as `opening`.
  - New `walledIn(bot)`: true when the four feet cells and four head cells beside the bot, and the roof over it, are all solid.
  - The gate's creeper override (within 6, or fusing within 10, plus the round-24 latch) now treats `sealed || (opening && walledIn)` as the walls being the answer.
  - Once the walls beside the bot come down (after `waitCreeperClear`, at most 60 s), the override is back as before.
  - A shelter still placing its walls, and the eat and sleep holds, are unchanged.

**Tests:** `round92.test.js` (4); round84's deep-equal now includes `opening:false`:
- `walledIn`: every column cell is needed;
- the hard2 shape: a creeper at 6, and a fusing one at 3, wait on the walls; with a feet cell open the override is back and logs;
- a shelter still building, and an eat hold, keep the override;
- `removeShelter` sets the mark and clears it, also on a throw.

793 pass, resources 9.

**Not changed yet**
- **The creeper stall rule** misses a creeper parked at about 6 that never comes nearer. A flee that cannot move the bot, with a creeper that cannot reach it, has no exit except the walls coming down.
- **The 5-minute sealed morning:** a box held from dawn to noon by a hostile at about 6.
- **hard3's death in a 90-mob crowd** while armed at 12 health.
- **From round 91:** why the flees did not move the bot in round 90's hard2 (the cornered line still has not fired), health 11.7 for two minutes, and bed prep at dusk with a creeper following.
- **From round 90:** silverfish, no regeneration without food, the late fuse wall, the click-loop caller, the round-85 respawn guard, night-mine climbs that time out, and `chest_spot_blocked`.

## Round 93 (2026-11-04)

**What the round-92 soak showed** (`e7f1d03`, report `68373cd`)
- **Iron on 6 of 6, 1 death** (0/0/0/1/0/0), the triple promoted, every run its full length, `errors` empty, 0 kicks, 0 uncaught, 0 `PACKET_RUNAWAY`. Probe 10/11. normal3 crafted a bed; nobody slept.
- **The round-92 fix was not exercised:** 0 `overrides the shelter hold` lines, and no morning opening named a creeper. No day stand of 3 minutes or more; round 91's hard2 shape did not come back.
- **Round 91's done line worked:** 2 fuse walls, each 0.41 s after the swell, both with `the fuse wall is done ... - the fuse flee was replaced`. hard2's stood (2 of 2); hard3's held dirt and stood 0 of 4. No creeper death. The cornered fight still did not run (0 lines).
- **The sky pillar ran twice**, hard2, both to head sky 15, with no health lost.
- **hard1, skeleton, as its noon box came down:**
  - `Shelter: morning (tod 6000, nearest hostile 11.3); opening up`.
  - `a skeleton 7.7 away; keeping the walls up`, then 60 s later `skeleton 13.5 away; opening the walls` (`CREEPER_WAIT_MS` cap).
  - 19 s of digging the walls down, then `Death: health 15.4 -> 15.8 -> 16.2 -> 11.7 -> 10.2 -> ... -> 11.3 -> 5.3 -> 6.3 -> 0; armour 0; held stone_pickaxe; 2 hostile(s) within 8: skeleton 4.9, skeleton 5.8`, with 83 loaded hostiles.
  - Not one Reflex line from the opening to the death. The shelter hold kept Mob Defense off for everything but a creeper while the box came down, and the stone sword in the bag was never drawn.
  - After the respawn: `Short of shelter blocks: 1 held, 23 needed`, and it held at the spawn to the end.
- **hard3's second noon box** opened with a skeleton at 4.5. The gather after it was hit (Mob Defense struck once and took 6), and health fell 20 -> 10. It did not die.

**Fix**
- **An open box lets Mob Defense through** (`worker.js`).
  - The trigger is the night mine's threat (round 84): a hostile within 8, or a hit in the last 3 s.
  - The gate computes `exposed` for a shelter coming down (`opening`, round 92) once `walledIn(bot)` is false. `nightMineOverride` accepts `hold.exposed`.
  - The override marks the job `openedUnder`. The paused job, in `survivalHold()`'s waiting branch, reports `opened` for `OPENED_GUARD_MS` 60 s, and that keeps the override while the threat lasts.
  - With the threat gone, the job resumes: it re-seals where the bot stands while the morning is not safe, or takes the rest down.
  - New log line: `Reflex: <threat> with the box open; Mob Defense answers`.
  - While the column stands (the outer cells and the creeper/skeleton wait), nothing changes.

**Tests:** `round93.test.js` (4):
- `nightMineOverride` with `exposed`;
- the hard1 shape: a skeleton at 4.9 is held off by a standing column, and gets Mob Defense once a head cell is dug (the job is marked and the line logged);
- a hit is the threat, and nothing near with no hit is not;
- the paused job keeps the override for 60 s and then gives the job its turn; a sealed box and a box still building keep the old hold.

797 pass, resources 9.

**Not changed yet**
- **The 60 s skeleton wait** opens the walls while the skeleton is still around (13.5 here, 4.5 on hard3). Consider re-checking it, or fighting from the box first.
- **The respawn with an empty bag:** 23 blocks needed, 1 held; it held at the spawn to the end.
- **From round 92:** the creeper parked at about 6 (the stall rule), the 5-minute sealed morning, and deaths in huge crowds.
- **From rounds 90-91:** the cornered fight is still unexercised, health 11.7 for two minutes, silverfish, no regeneration without food, the click-loop caller, night-mine climbs that time out, and `chest_spot_blocked`.

## Round 94 (2026-11-05)

**What the round-93 soak showed** (`20a7d93`, report `cc6237d`)
- **Iron on 4 of 6, 1 death** (0/0/0/0/1/0), the triple promoted, every run its full length, `errors` empty, 0 kicks, 0 uncaught, 0 `PACKET_RUNAWAY`. Probe 10/11. normal3 and hard3 crafted beds; nobody slept.
- **The round-93 line fired once**, hard2: `Reflex: a spider within 8 with the box open; Mob Defense answers`. The shelter resumed 0.85 s later and was superseded 18 s after that, with no damage. Not a test of skeleton fire.
- **The cornered fight ran once** (hard2, a drowned at 3.0, `held dirt`), 4.3 s before the death. No `Combat:` line after it.
- **hard2, no wood for 10 minutes, then the death:**
  - The hard anchor `[704, 71, -423]` sits on a plains strip with the ocean west and a lake east. The soak world's region files show no log within ~100 blocks of it after the soak; the nearest are the cherry grove ~100-150 east and south-east.
  - Six `wood failed 3 times; exploring before retry` legs, each `direction:"random"`, took the bot ~220 blocks south down the strip. Three ended `Boxed in at ... no way to stair out` on the water cells (708, 62, -598), (724, 62, -641), (726, 62, -667), with `Water: no dry stand within 12`.
  - Biome samples from three of those explore starts ((694, -491), (699, -515), (707, -575)) read `cherry_grove` 96 east; west and north were ocean everywhere.
  - Night came at (727, 61, -639): `Could not seal the shelter: 26 open cells` (water), a night pillar at (761, 63, -640). Phantoms hit it three times on the perch (20 -> 11).
  - At dawn, still at 11 with no sword and no food, it went for wood 80+ blocks east into the morning crowd, and `Death: health 6.5 -> 2 -> 0; armour 0; held dirt; 1 hostile(s) within 8: drowned 1.5` in the water at (842, 62, -715). Wood came at 1717 s, after the respawn; no furnace, no iron.
- **hard3 never reached iron:** its day went to the furnace, food and the bed (bed at 1416 s), and the iron gather only started at 18:01. Its creeper `has followed ...; fighting it from a pillar` / `keeping 20 away` alternated every 0.1-0.3 s for 41 s (17:47:21-17:48:02, 47 pillar lines and 43 `Fight result: creeper ... hits=0 ... result=stopped`), with three `pillar-up failed (left the column)`.

**Fix**
- **The wood step's explore heads somewhere** (`autopilot.js`).
  - New `woodHeading(bot)`: samples the biome at `WOOD_SAMPLES` 16/48/96/128 blocks in each cardinal, the same way `grazeDirection` does. A `TREE` biome scores +2 (+3 at 96 and beyond); a `WET` biome (ocean, river, beach, stony shore) scores -2 within 48 and -1 beyond. Unloaded columns are neutral.
  - It picks the best score, splitting ties at random. With no column loaded it stays `random`.
  - The blocked-step branch now submits `this.blockedExplore(step,surface)`. For wood that is `woodHeading`'s direction, logged as `Autopilot: the wood explore heads <dir> (<biome> at <dist>)` or `(the least water)`. Every other step explores `random` as before, 64 blocks; wood is still 48.
  - Nothing else changes: the gather's own search legs still aim at logs seen within `SEARCH_SCAN` 96, and the fixed east/north/west/south order when none is seen.

**Tests:** `round94.test.js` (3):
- from (694, -491) with the soak world's biomes, the heading is east with `cherry_grove` at 96; a near forest beats a far grove;
- from the hard anchor with no tree biome in reach, north or south (both least wet), the tie split both ways; nothing loaded is `random`;
- `blockedExplore` gives wood the heading and the line, stone stays `random` 64 with no line, and the blocked branch submits it.

800 pass, resources 9.

**Not changed yet**
- **The creeper pillar flip-flop** on hard3: `fighting it from a pillar` and `keeping 20 away` alternating for 41 s.
- **Leaving the night pillar at dawn** hurt (11), unarmed and without food, into the morning crowd. The box has the crowd/unarmed hold; the perch only checks the nearest hostile.
- **Phantoms on the perch** (the bot never sleeps, so they come after the third night).
- **hard3's pacing:** the bed and food before iron on a hard run.
- **From round 93:** the 60 s skeleton wait, the respawn with an empty bag, the creeper parked at about 6, the 5-minute sealed morning, deaths in huge crowds, silverfish, no regeneration without food, the click-loop caller, night-mine climbs that time out, and `chest_spot_blocked`.

## Round 95 (2026-11-05)

**What the round-94 soak showed** (report `48f2981`, bot code `4563145`, promoted): iron on 5 of 6, 1 death (0/0/0/0/0/1).
- **The round-94 wood heading worked.** Hard wood 211/331/271 s (round 93: 301/1717/362). Two heading lines, both hard3, both `east (cherry_grove ...)`; two more wood failures climbed out from under rock instead. No water march, `no dry stand` 0.
- **The one death, hard3:**
  - A cave morning climbed out through the roof to y=89 (`head sky 12`, health 20 to 20, stone sword held, 49 cobble).
  - A creeper was there: `fleeing creeper` 0.03 s after `Completed shelter`, then `a creeper has followed for 3 s; keeping 20 away`.
  - 6 s later: `creeper fuse (swell 1)`, then `creeper fuse at 2.9 and the flee is not moving the bot; walling 4 cell(s)`, 2 placed, none standing, `blown up by Creeper` with armour 0.
  - The keep-away never kept it off, and the pillar fight waits for `CREEPER_PERSIST` 20 s of following.
- **The pillar thrash did not recur at length:** the longest pillar/keep-away alternation is 5.1 s. No `pillar-up failed`.
- hard3 lost its iron to the death. No bed on any run.

**Fix**
- **A creeper that closes in through the keep-away is fought from a pillar at once** (`mobDefenseChain.js`).
  - New `CREEPER_CLOSING_NEAR` 6. Once a chase has run `CREEPER_CHASE_S` (3 s) and its creeper comes within 6, that chase is marked closing. From then on it is a `FightTask` (the combat controller pillars inside 8, strikes from the top) instead of the keep-20 flee, for as long as the chase lasts (lost for 5 s or past 20 ends it).
  - Gate (`pillarFightOk`): a sword or axe, health 14+ (10+ armoured), at most 2 melee mobs, daylight or armoured - the 7f policy without its creeper-within-5 check, since the pillar is the answer to exactly that. Plus 2+ pillar blocks, and alone: no other creeper within 10 and nothing else within 6. A creeper backing off past 10 does not end it (the `lone` count in the round-46 branch does).
  - Line: `Reflex: a creeper has followed for N s and closed to D through the keep-away; fighting it from a pillar`, once per chase.
  - The first 3 s stay the plain `fleeing creeper`; a creeper the keep-away holds past 6 is fled as before, and the round-46 `CREEPER_PERSIST` fight is unchanged. A fuse still outranks everything (the fuse flee replaces the fight).

**Tests:** `round95.test.js` (3):
- the round-94 shape: 4 away, the keep-away at 3 s, 5.2 away 2 s later is the pillar fight with the line; it stays the fight at 7-12 with one line, ends past 20, and a new chase starts with the plain flee;
- a creeper the keep-away holds at 6.5-12 is still fled; within 6 in the first 3 s is the plain flee;
- the gate: no sword, 1 block, health 11, night, a zombie within 6 or a second creeper within 10 each keep the flee; within 5 with no bow is still the pillar.
- `round91.test.js`: the creeper-at-2.5 case now becomes the pillar fight after 3 s (never the cornered line).

803 pass, resources 9.

**Not changed yet**
- **A fuse during a pillar climb:** the fuse flee replaces the fight, so a bot one or two blocks up drops off and runs. Watch for swell lines inside the new pillar fights.
- **Leaving the night pillar at dawn** hurt, unarmed and without food (round 93).
- **Phantoms on the perch**; no bed on any run this round.
- **The round-46 `lone` count** flips when a creeper crosses 10, a likely source of the round-93 thrash.
- **From round 93:** the 60 s skeleton wait, the respawn with an empty bag, the creeper parked at about 6, the 5-minute sealed morning, deaths in huge crowds, silverfish, no regeneration without food, night-mine climbs, `chest_spot_blocked`.

## Round 96 (2026-11-05)

**What the round-95 soak showed** (report `7226342`, bot code `480d8fa`, promoted): iron on 3 of 6 (the normals only), 1 death (0/0/0/1/0/0).
- **The round-95 close-in pillar never fired:** 0 `closed to`, 0 fuses, 0 creeper deaths. Three `keeping 20 away`, none closing past 6 after the chase started (hard2's two closest approaches, 2.7 and 2.8, were in the first 3 s).
- **hard1, the death:** a cave-morning climb out of a deep box (818, 62, -547) to y=87 into a crowd of ~80, and `slain by Enderman` 12.5 s after `Completed shelter`.
- **hard1 after the respawn, 15 minutes in one cell:**
  - Its night box at (785, 86, -517) was two under the grass of a cherry grove. At dawn `morning in a cave (3 hostiles within 24, sky 0)` - the sky was the canopy, not rock.
  - `no path up from y=86; pillaring`, `Ascend: y=86 -> 94 (surface 94)`, `head sky 13`: up its own column into the leaves, 6 over the grass (the soak world after the soak: grass at 87, cherry leaves 94-97 on every side of x=786).
  - From (786, 94, -517): 23 wood gathers (`No path to the goal!`, `Only the block under the bot is in reach`) and 20 explores, all `east (cherry_grove at 16)` and all `no path for explore`, until dusk. 512 s on the samples in that cell.
  - The pathfinder's error there is `noPath`, not the empty path, so the round-44 stranded retry (drops of 6 and digging, then the round-80 dig-down) never ran.
- hard2 and hard3 ran short of iron on pacing (hard2 at health 8.7 on food at 1233 s, hard3 on bed-prep, 6 raw iron unsmelted at the end).

**Fix**
- **A sky climb under a canopy stops at the ground** (`worker.js`).
  - New `walkOut(b,p)`: a cell beside the bot whose floor is solid and not leaves, whose feet and head cells are free (no fluid), and with nothing solid for `OUT_SCAN` 24 over it but leaves, logs, wood, stems or vines.
  - `ascend` with `sky`: `out()` is `skyOpen() || walkOut(...)`. It ends the no-path pillar segments (their `pillarUp` now takes `until:out` on a sky climb), skips the round-88 sky pillar and the round-90 target past the surface, and skips the first path-up when the bot is already out. A box wall beside the bot, a rock roof over the neighbour, or a leaf floor is not out.
  - Line: `Ascend: out under cover at y=N (ground beside at X, Z with only the canopy over it); not pillaring into it`, before the usual `Ascend: y=A -> B (surface Y)`.
  - Nothing changes in a real cave: the round-88/89/90 sky pillar still climbs through rock to open sky.

**Tests:** `round96.test.js` (3):
- `walkOut` on the round-95 grove: grass beside the bot under the cherry is out; walled on four sides, stone 10 over, leaves underfoot, and the y=94 canopy cell are not;
- the round-95 climb from (786, 86, -517) in its box: stops at y=88 on the grass with the line, no sky pillar, every pillar given `until`;
- with stone over the grove the climb goes through to head sky 15 as before.

806 pass, resources 9.

**Not changed yet**
- **The noPath branch of `navigate` has no stranded retry** (only the empty-path branch does). A bot that strands some other way still loops `no path` from one cell.
- **The wood heading repeats a direction that has just failed from the same cell** (21 in a row on hard1). Random would at least have varied.
- **Hard pacing:** iron on 0 of 3 hard runs this round; the bed and food before iron.
- **Cave-morning exits into crowds** (the hard1 enderman death, round 94's creeper).
- **From earlier rounds:** a fuse during a pillar climb, leaving the night pillar at dawn hurt and unarmed, phantoms on the perch, the round-46 `lone` flip, the 60 s skeleton wait, the respawn with an empty bag, silverfish, no regeneration without food, night-mine climbs, `chest_spot_blocked`.

## Round 97 (2026-11-05)

**What the round-96 soak showed** (report `90fe366`, bot code `e643009`, promoted): iron on 5 of 6 (every run but hard3), 0 deaths. Hard iron 1144/1657/- s.
- **The round-96 canopy stop never fired:** 0 `out under cover`. The two cave mornings were a real cave (hard1, no-sky pillar from y=68, no damage) and a 4-step stair to head sky 15 (hard2). No daytime same-cell stand of 3 minutes; 0 `no path for explore`.
- **The round-95 close-in pillar fired 5 times** (hard1 four, hard3 one; 4.7-5.9). Every one reached a `pillar-up`, none killed the creeper (`result=stopped`), four saw a fuse and fled past 7, 0 damage taken, no creeper death.
- **hard3, ~5 minutes on a cherry canopy:**
  - `Gather: search leg 3 north toward logs at 830,101,-496` took it onto the canopy of the grove. The soak world after the soak: at (831, -496) cherry leaves at y=100, air 96-99, grass at 95.
  - From (831, 101, -496): a 90 s sheep hunt that timed out with no target, then three stone gathers, 10 targets each, all `Cannot reach ... (walk: No path to the goal!` from that cell, and `stone failed 3 times`.
  - The dusk cobble gather's `No exposed stone within reach; digging down` got it down 5 minutes after the search leg. The gather's own `canopyDrop` runs only for a target below and refuses a fall of more than 4; this drop was 5.
  - Its stone pick at 542 s, furnace 964 s, the iron step from 1958 s, and the run ended at y=47 smelting with no iron pick.

**Fix**
- **A walk with no path from a leaf stand digs down through the leaves** (`worker.js`).
  - New `canopyFloor(b,f)`: with leaves under the feet, the first solid non-leaf block at most `CANOPY_DROP` 6 below (3 damage at most), with no water, lava, magma, cactus, campfire, berry bush, powder snow or dripstone in the column and nothing unloaded. Returns the stand y, or null.
  - New `canopyDown(token)`: with health `STRANDED_HEALTH` 12+, not in a tunnel climb (`_ownFallback`), digs the leaf under the feet and falls, repeating while leaves are under the feet. Lines: `Navigation: no path from the canopy at (X, Y, Z) (<leaves> under the feet, the ground N below); digging down through the leaves`, then `Navigation: down from the canopy y=A -> B; pathing again`.
  - `navigate` calls it in both no-path branches (the `noPath` rejection and the empty path), right after the no-avoidance retry and before the water search, the stair-out and the round-44 stranded retry, then paths again.
  - A bot on its own pillar block, on a log, or on the ground is not on the canopy; nothing else changes.

**Tests:** `round97.test.js` (3):
- `canopyFloor` on hard3's column: stand 96 under the leaf, through a second leaf on the way, 6 below allowed and 7 not; null on grass, a log, a dirt pillar, water, lava, magma and an unloaded cell;
- `canopyDown` from (831, 101, -496) with a second leaf at 97: two digs, down to y=96 with both lines; nothing at low health, in a tunnel climb, or while already digging;
- both no-path branches call it, in that order.

809 pass, resources 9.

**Not changed yet**
- **The close-in creeper pillar is 2-3 high and the creeper still swells** (4 fuses in 5 fights, 0 kills). No damage this round.
- **Hard pacing:** hard3's day went on food (two 90-100 s cow and sheep timeouts), the pre-iron wool hunt and a broken stone pick (`A suitable harvesting tool is required` on coal at 11:06).
- **The wood heading repeats a direction that has just failed from the same cell** (not seen this round).
- **Cave-morning exits into crowds**, a fuse during a pillar climb, leaving the night pillar at dawn hurt and unarmed, phantoms on the perch, the round-46 `lone` flip, the 60 s skeleton wait, the respawn with an empty bag, silverfish, no regeneration without food, night-mine climbs (`Took to long to decide path` on all four this round), `chest_spot_blocked`.

## Round 98 (2026-11-06)

**What the round-97 soak showed** (report `9faaf2d`, bot code `d573823`, promoted): iron on 5 of 6 (every run but hard1), 5 deaths (0/0/1/2/1/1). Hard iron -/1295/1144 s.
- **The round-97 canopy dig never fired:** 0 `no path from the canopy`. No daytime 2-minute stretch with 5+ `No path` failures, and no 3-minute daytime same-cell stand.
- **The round-95 close-in pillar never fired** (0 `closed to`), and the round-96 canopy stop didn't either (0 `out under cover`).
- **hard1, killed by a witch at 1096 s, before iron** (the first witch death in the reports):
  - `Reflex: fleeing witch` at 16:29:46 from the iron gather at (794, 79, -590), a hole 2 wide and 4 deep in the soak world after the soak. The gather was `queued` on the next sample (the flee held the runner), and the bot was still at (794, 78, -590) at the death 21 s later.
  - `Death: health 12.8 -> 3.8 -> 2.8 -> 1.8 -> 0.8 -> 0 ... armour 0; held stone_pickaxe; 1 hostile(s) within 8: witch 3.6`, with 6 cobblestone in the bag. The run-away is a raw forward-and-sprint on a heading, so in the hole it pressed against a wall, and the pinned-flee answer (round 91) fights melee mobs only.
  - The death emptied the bag, and the zombie death at 1430 s came holding dirt. hard1 never made an iron pick.
- **The two skeleton deaths came during creeper flees** (hard2 with a fuse wall and a blast, 18.4 -> 4.9; hard3 on a `keeping 20 away` keep-away by day, shot 15.8 -> 0.3). The creeper flees don't look at skeletons. normal3 died in lava at y=-25 holding an empty bucket after dousing.

**Fix**
- **A pinned witch flee blocks the witch's line of sight** (`fallbackTasks.js`, `mobDefenseChain.js`). A witch throws only with a line of sight.
  - New `witchCoverCell(bot,witch,tries)`: walking the line from the bot's eyes to the witch's, it skips the bot's own cells and returns the first open cell within `WITCH_COVER_REACH` 4.5 that has a solid face to place against. With nothing to place against at head height on open ground, it returns the cell under it first. It returns `{covered:true}` once a solid cell cuts the line, and null for an unloaded cell, the witch's own cells, or a cell tried `WITCH_COVER_TRIES` 2 times.
  - New `WitchCoverTask`: it stands still, equips the pillar blocks, and places one block every 0.25 s until the line is cut. When the chain moves on, it logs `Reflex: the witch cover is done: N block(s) placed (held X); the witch is D away`.
  - In MobDefenseChain's witch branch, a flee pinned `FLEE_PINNED_S` 2 s within 1 block, with a witch within 10 in sight and pillar blocks held, takes the cover instead (priority 68, as the witch flee). It logs `Reflex: the witch flee has kept the bot in one spot for N s with the witch D away in sight (health H, <block> C); blocking its line of sight` once per spot.
  - While the bot stays in that spot, a witch that sees it again gets a fresh cover at once. With no cell left, the flee runs for `WITCH_COVER_OFF` 3 s before it looks again. The cover ends when the bot moves off the spot.
  - A witch flee that moves the bot, or one with no blocks held, is unchanged.

**Tests:** `round98.test.js` (3):
- the cover cell: from a 1x1 hole with the witch on the rim, the cell over the head; on flat ground the feet cell first, then the head cell; covered, unloaded, tried;
- the chain in the hole: the flee, the cover at 2.1 s pinned with the start line, the equip and the block over the head, the vulnerable flee once out of sight, one done line, a fresh cover from the same spot when the block is lost, the 3 s fallback, and the end on moving off;
- no cover with no blocks or for a flee that moves, and no done line when nothing was tried.

812 pass, resources 9.

**Not changed yet**
- **Creeper flees ignore skeletons** (both skeleton deaths this round).
- **The lava death at y=-25** after a douse with the bucket.
- **The close-in creeper pillar is 2-3 high and the creeper still swells** (not exercised this round).
- **Hard pacing:** food timeouts, the pre-iron wool hunt, broken stone picks; `Only the block under the bot is in reach` three times on the iron step before its explore.
- Cave-morning exits into crowds, a fuse during a pillar climb, phantoms on the perch, the respawn with an empty bag, night-mine climbs, `chest_spot_blocked`.

## Round 99 (2026-11-06)

**What the round-98 soak showed** (report `ece98b4`, bot code `aace128`, promoted): iron on 4 of 6 (every run but hard1 and hard2), 3 deaths (0/0/0/1/2/0). Hard wood 361/362/271, hard furnace 602/542/1144, hard iron -/-/1837 s.
- **The round-98 witch cover never fired:** 0 `fleeing witch`, 0 cover lines, no witch death. It is still untested live.
- **The round-97 canopy dig fired once** (normal3, oak leaves, 3 to the ground, gather done 27 s later, no damage).
- **Both iron losses were the bag, not the fight.** Each death was before iron, 100-150 blocks from the respawn, and the ladder started again from nothing:
  - **hard1, 899 s:** `speared by Zombie` at (793, 89, -530) by day, on a sheep hunt, `health 9.5 -> 0`: two spear hits took 20 to 0 in about a second, armour 0. The bag held two stone picks, a stone sword, a furnace and two tables. At 1235 s it held a wooden pick again; it never made iron.
  - **hard2, 804 s:** `shot by Skeleton` at (782, 68, -549). A chicken hunt walked it under a cave roof, `Ledge guard` twice, a mob cave of 7, then `Fall: dropping from (781, 78, -565)` during the zombie's `group-spacing`, and four arrows 20 -> 0 in 7 s. The bag held two stone picks, a stone sword, a furnace, a table, 17 cobblestone.
  - **hard2, 1017 s:** `slain by Zombie` at (735, 61, -519), held dirt, on the way back to wood. It later held 3 ingots and never crafted a pick.

**Fix**
- **The bag run** (`autopilot.js`, `worker.js`, `schema.js`). The drops lie for 5 minutes and the walk back takes about one.
  - `onDeath` records `lastDeath.bag` from the bag as the bot dies: `deathBag(bot,at)` gives the item count, the kit names worth a walk (tools, armour, furnace, table, shield, bucket, raw iron, ingots, diamonds), and whether the cell is lava.
  - In the idle branch, after `recovering` and off the shelter hours, `Autopilot.bagRun(b)` sends one `{type:'bagrun',position}` job under the step `bag`, up to `BAG_RUN_TRIES` 3 for a failed run. A run a reflex paused holds the ladder (a new job would supersede it) until `BAG_RUN_MS` 270 s after the death.
  - `bagRunSkip` logs `Bag run: skipped (...)` for no kit in the bag, lava, more than `BAG_RUN_FAR` 220 away, more than `BAG_RUN_DEEP` 32 above or below, or two deaths within 16 blocks in 10 minutes (no spiral at a spot that kills).
  - `Worker.bagRun` logs `Bag run: walking D back to the death at P (kit; N s left on the drops)`, walks straight-line legs of `BAG_RUN_LEG` 48, closes on the cell, runs `sweepDrops` within 24 for up to 30 s, and logs `Bag run: at the death after N s; picked up ...` or `no drops picked up`. The other ends are `out of time after N run(s)`, `given up after N run(s)`, `too late for the drops`, and a job failure `Bag run: stopped D short of the death at P`.
  - Night still wins: the running job is not in the protected list, so the night branch cancels it.

**Tests:** `round99.test.js` (6): the bag read and every skip reason; one run per death, the reflex hold and the next death's run; retries, the time limits, one line per end; the legs and sweep with the final line; a failed leg and time running out; the wiring. 818 pass, resources 9.

**Not changed yet**
- **Cornered with no weapon:** two rounds running the cornered line was followed by no `Combat:` strike before the death (round 97 hard1 2.2 s, round 98 hard2 1.9 s), both held dirt.
- **Spear zombies:** two hits kill an unarmoured bot; a flee in a line stays in the spear's reach.
- **Group-spacing beside a drop:** hard2's fall into the cave came during `group-spacing` right after two `Ledge guard` stops.
- **A food hunt that follows an animal under a roof** into a cave.
- **Creeper flees ignore skeletons** (round 97), the lava death at y=-25 (round 97), the close-in creeper pillar still sees a swell.
- **Hard pacing:** hard3's furnace at 1144 s and iron at 1837 s; normal2's 662 s `bag full` stand at (765, 13, -523).
- Cave-morning exits into crowds, a fuse during a pillar climb, phantoms on the perch, night-mine climbs, `chest_spot_blocked`.

## Round 100 (2026-11-07)

**What the round-99 soak showed** (report `0c98efb`, bot code `4199c01`, promoted): iron on 4 of 6 (every run but hard1 and hard2, the same two as round 98), 4 deaths (0/0/0/0/2/2). Iron picks 632/813/964/-/-/1962, hard wood 331/241/514, hard stone 422/1113/845, hard furnace 1265/1836/936. normal1 made a diamond pick at 2169 s (round 98: 2 diamonds and no pick).
- **The bag run worked once and was cut off once.**
  - **hard2, 18:19:16:** a spider at (851, 86, -543). The run started 12.6 s after the death, walked 189, and `at the death after 72 s; picked up cobblestone 161, ...`. The stone pick was crafted 95 s after the death, on the table it walked back for.
  - **hard2, 17:58:49:** a zombie at (793, 75, -568). The run walked 64 s to about 21 blocks from the drops with 124 s left on them, a creeper flee paused it, and 80 ms after the second pause `Autopilot [wood]` went out and `the paused bagrun job was superseded`. No end line, and the kit stayed on the ground.
  - **hard3:** both deaths came before wood, with an empty bag: `Bag run: skipped`, correctly.
- **That cut-off was a round-99 bug.** `tick()` counts a paused job as not active and settles it, and settle's else-branch set `bagDone`, so the run was over before `bagRun()` reached its reflex hold. The round-99 test called `bagRun` directly and stepped round `settle`.
- **hard1 lost its iron with no death.** Its second box at (825, 87, -568) stood over a cave: dawn at 17:40:09, held sealed to tod 6000, then a creeper hold of 60 s and `9 hostiles within 16` for 157 s, and the crowd sent it back in at 17:48:25. That is 489 s of a 550 s day. The log gives no height for those mobs, so it cannot say whether they were on the surface or in the cave below.
- **The round-98 witch cover has still not fired** (0 lines, four crowd lists named a witch). The round-97 canopy dig fired once (normal3, one layer, no damage).

**Fix**
- **A reflex pause no longer ends the bag run** (`autopilot.js`). settle sets `bagDone` only when the job is `complete`, so a paused run reaches the `bag: waiting on a reflex` hold and nothing goes out to supersede it. A run that was paused settled with the pause, so its finish reaches no settle: `bagRun()` now closes the death itself when the last `bagrun` job is `complete`, and only once the run has had a try, so an old run's `complete` cannot close the next death.
- **Diagnostic only, no behaviour change** (`worker.js`): `hostileSpread(r,n=6)` gives name, distance, height against the bot and the sky at the mob, e.g. `zombie 5.0 dy 0 sky 15, creeper 8.6 dy -7 sky 0 and 1 more`. It feeds two lines: `Shelter: held past dawn by ...` once per box when the morning is light and the exit is not safe, and `Shelter: around the box as it opens: ...` when anything is within 16 at the opening.

**Tests:** `round100.test.js` (6), through the real `tick()`: a pause does not end the run and the ladder waits; a finish after two pauses with no second run; a finish with no pause; a failure after a pause retries and the next death gets its own run; `hostileSpread` output; the wiring of the two lines. With the old settle line restored, three of them fail. 824 pass, resources 9.

**Not changed yet**
- **The box held by mobs that may be under it:** the next candidate, once the two lines show where they stand. Either check `caveMorning` during the dawn hold (about 250 s saved on hard1) or stop counting mobs under rock.
- **Pickless with a full bag:** hard2 broke its wooden pick at 18:10:46 and its stone pick at 18:15:01 holding 161 cobblestone, and went into the cave morning with no tool; the stone-pick craft sent out after the climb never finished. It dug out by hand for 38 s into a crowd of 91 at health 9.8.
- **Cornered with no weapon** never strikes (third round running: hard2, 4.7 s, `held nothing`).
- **hard3's opening:** two deaths in the first 271 s before wood, a 99-mob storm at (694, 63, -497) and a creeper that followed from `keeping 20 away` to the blast.
- **`BAG_WORTH` ignores a large stack:** 161 cobblestone came back on hard2 as a side effect; alone it would be skipped.
- Spear zombies, group-spacing by a drop, a food hunt under a roof, creeper flees ignoring skeletons, lava at y=-25, the close-in creeper pillar, hard pacing.

## Round 101 (2026-11-07)

**What the round-100 soak showed** (report `bb67742`, bot code `6a6d95e`, promoted): iron on 5 of 6 (every run but hard1; hard2 made one for the first time in three rounds), 3 deaths, all hard1 (0/0/0/3/0/0). Iron picks 512/663/693/-/2290/1295, hard wood 362/271/211, hard stone 783/362/331, hard furnace 904/482/422. hard2 made a bed at 1657 s and slept in it.
- **The round-100 pause fix held:** one reflex paused a bag run, `Reflex: resumed the bagrun job` 0.5 s later, nothing went out, and 0 `paused bagrun job was superseded`. Every run had an end line.
- **No kit came back, and the cause is the leg, not the reflex.**
  - **hard1, 01:54:03:** `shot by Skeleton` at (800, 71, -569) in a mob cave at dusk, holding the whole stone kit, 170 from the respawn with 268 s left. Three runs in 20 s: no path from (715, 66, -434), (730, 64, -432), (739, 63, -433), each walking 11-16 blocks east along the river bank before it failed. `given up after 3 run(s)` with about 240 s left. No reflex touched it. Round-99 hard2's first leg failed the same way at the spawn lake.
  - **Why it fails:** a leg across the water goes over the pathfinder's search budget, the bot walks the partial path, and the rejection comes at its end.
  - **hard1, 02:10:37:** the third death fell in shelter hours, so its run started one second into hard2 with 44 s left and ran out of time at 45 short. That cost hard2 about 50 s.
- **The new box lines answered round 99's question.** Four `held past dawn by` lines. Three boxes cleared in 0.5-8.3 s. hard2's box at (844, 72, -560) was held 249.8 s past dawn with all four named mobs at sky 0, then `morning in a cave`, and its climb stopped under a ceiling (`head sky 0 at y=78`). 0 `around the box as it opens` lines.
- **The witch cover has still not fired** (0 lines; 21 crowd lists named a witch, all hard1).

**Fix**
- **A leg with no path turns off the line** (`worker.js`, `bagLeg`). From wherever the partial path left the bot it tries the same length at 45, -45, 90 and -90 degrees from the line to the death, logging `Bag run: no path on the line from P; turning` and `Bag run: no path 45 off the line from P; turning`. The next leg aims at the death again. Only every bearing failing ends the run. A timeout, a pause or the clock ends a leg as before. The last stretch turns too, by no more than what is left.
- **Log wording:** `Bag run: stopped D short of the death at P` named the bot's position; it now names the death.

**Tests:** `round101.test.js` (6): a turn and the run goes on; the round-100 river replayed with partial paths along the bank; every bearing once and in order before the run fails; only a no-path turns; the last stretch; the stopped line. `round99.test.js` changed in two places: a run now fails when every bearing fails, and the stopped line names the death. With the turn removed, four of the new tests fail. 830 pass, resources 9.

**Not changed yet**
- **The dawn hold in a cave:** the next candidate. `caveMorning` is tested only after the hold ends, which cost hard2 250 s here and hard1 about 250 s in round 99. With every mob under rock, the check belongs inside the hold.
- **A walk back into what killed it:** hard1's death was in a mob cave of 7 at dusk. A run that now arrives may meet them; the night branch still cancels it at shelter time. Watch this one.
- **Bag run across a run change:** `lastDeath` survives into the next harness run. `Autopilot.start()` also runs on a death resume, so it cannot be cleared there.
- **Cornered with no weapon** never strikes (four rounds now; hard1 twice this round, held dirt).
- **Hostile list:** an enderman at 3.2 counted as a mob holding the box (cleared in 2.8 s).
- **The death line names the wrong killer:** the log said creeper, the server `shot by Skeleton`.
- **`BAG_WORTH` ignores a large stack.** Going pickless with a full bag (round-99 hard2), spear zombies, group-spacing by a drop, a food hunt under a roof, creeper flees ignoring skeletons, lava at y=-25, hard pacing.

## Round 102 (2026-11-07)

**What the round-101 soak showed** (report `ae97bb5`, bot code `d215121`, promoted): iron on 5 of 6 (every run but hard1, the same miss as round 100), 2 deaths (0/0/0/1/0/1), down from 3. Iron picks 542/844/753/-/1296/1206, hard wood 361/362/271, hard stone 573/422/331, hard furnace 994/542/392. hard1 made a bed at 874 s and never slept in it. No diamonds, the first round without one since 97.
- **The first full kit came back.** hard3 was sniped at (799, 88, -514) at 09:09:46 with 0 hostiles within 8. Its run started 5.4 s later, held 53.9 s through one flee, and ended `at the death after 116 s` with the whole kit, furnace and raw iron. Its iron pick came 367 s after the death.
- **The round-101 turn did not fire:** 0 `turning` lines, 0 `given up`. Neither run had a leg end in `No path`, so the fix is still untested live.
- **hard1 lost its kit 9 blocks away.** Shot at (832, 90, -455) after a 27-mob flee list. The run was paused and resumed 49 times over 190 s, the bot held at (832, 99, -456) with health 20, and the night job superseded it at 07:57:16. The drops despawned at 07:58:34; `out of time` came at 08:06:48. It held 6 iron ore and never smelted it.
- **A creeper took hard3's last day.** Box at (828, 91, -502), `held past dawn by creeper 2.3 dy 1 sky 0` at 09:23:24, and the same words at the opening 404.4 s later, at tod 9080.
  - **Why the walls stayed up:** the box opens at the job's exit margin, 60 s before the limit, and `waitCreeperClear` then waits 60 s. The two ended together: `Job time limit reached`, walls standing.
  - **What it cost:** every sample from there to the end of the run reads (828, 91, -502). 753 s from dawn to the harness stop.
- **hard2's two boxes** were held 63.7 s (a creeper 6.0 away, sky 0, then `morning in a cave`) and 147.4 s (a skeleton 12 below, sky 0). Every mob named on all three held boxes was at sky 0, as in round 100.

**Fix**
- **A box pinned by mobs under rock is left through the roof** (`worker.js`, `boxPinned`, `BOX_PINNED_MS=30000`, `ROCK_SKY=3`). 30 s after the first `held past dawn` line, with the tod between `MORNING_SAFE` and `DUSK_PREP`, if every hostile within `REFUGE_CLEAR` reads sky 3 or less at its head, the hold ends and the existing cave-morning climb runs: `Shelter: pinned N s past dawn by <mobs>; climbing out through the roof`.
- **It does not need `caveMorning`.** hard3's box was not a cave morning even at the opening, so moving that test into the hold alone would have missed it. The mob's own sky decides, because a sealed box reads sky 0 anywhere (round 57).
- **One try a box** (`job.roofTried`). A climb that fails logs `Shelter: could not climb out; holding the box` and goes back through `shelter()`; the walls do not come down beside the mob. A plain cave morning is unchanged, and `markMobCave` still runs only for one.
- **Refactor:** `hostilesNear(r)` now holds the filter `hostilesWithin` and `hostileSpread` shared.

**Tests:** `round102.test.js` (7), through the real `shelter()` hold on a fake clock: the round-101 box; a mob that leaves inside the 30 s; a mob under the sky holds the box as before; a canopy is not rock; the gates (by day, once held, after the wait, one try, an empty list); a failed climb; a pinned box in a mob cave and a plain cave morning. With the pin removed, the replay test fails. 837 pass, resources 9.

**Not changed yet**
- **The exit margin and the creeper wait are the same 60 s,** so any box still held at the margin times out with its walls up. This fix only takes the under-rock case away from it. A creeper in the open at the wall still ends that way, and hard3 then sat `queued: store` for 270 s.
- **The roof climb leaves the box's blocks behind.** On a surface box held by a mob far below (hard2's skeleton, dy -12) simply opening may be better, and hard1 went `Short of shelter blocks` this round. Watch the block counts after each pinned climb.
- **A kit in a crowd:** hard1 stood 9 blocks from its kit for 190 s at health 20. The run has no way to go in, and going in with 27 mobs may just drop it again.
- **Bag run across a run change** (0 this round), **cornered with no weapon,** the enderman counted as holding a box, the wrong killer on a death line, `BAG_WORTH` and large stacks, going pickless with a full bag, spear zombies, group-spacing by a drop, a food hunt under a roof, creeper flees ignoring skeletons, lava at y=-25, hard pacing.

## Round 103 (2026-11-07)

**What the round-102 soak showed** (report `bd18440`, bot code `31aa1a4`, promoted): iron on 5 of 6 (every run but hard1, the third round running), 1 death (0/0/0/0/1/0), down from 2. Iron picks 602/904/753/-/964/1476, hard wood 1054/302/241, hard stone 1145/392/331, hard furnace 1235/483/482. hard2's 964 s is the fastest hard iron in the report's comparison. No diamonds. No `Job time limit reached` on a shelter job, and the longest seal past dawn was 30 s.
- **The round-102 pin did not fire:** 0 `pinned` lines. hard1's last box qualified (`stray 15.7 dy 9 sky 0`), but the harness ended the run 29.98 s after the `held past dawn` line, 0.02 s short of the 30 s gate. hard3's box had a spider at sky 15, which blocks the pin by design, and it cleared in 23.6 s.
- **The round-101 turn did not fire either:** 0 `turning` lines.
- **The second full kit came back.** hard2 was sniped at (847, 85, -550) with 0 hostiles within 8, during a cobblestone drop, 4.2 s after a 99-mob flee list. Its run started 25.4 s later, held once through a 95-mob flee and a river crossing, and picked up the whole kit 148.7 s after the death.
- **hard1 lost 13 minutes to wood.** It reached the oak at (756, 74-77, -602) 118 s in and skipped it. Its first logs came at about 980 s near (926, 73, -920), over 500 blocks from the anchor, and the wooden pick at 1054 s. That left no time for iron. hard2 took logs from the same oak, in a job begun at y=78.
  - **Why the tree was lost:** the job began on a hill at y=80-81. That height is not logged; it is inferred from the log at y=77 passing the floor and a walk tripping it at y=67 but not at y=71. `surfaceY-4` then hid every log under y=76-77, so only the top of the trunk was a target.
  - **Why the top log failed:** the walk asks for a stand within 2 of the log, and the ground under a tall trunk does not give one. `No path`, 6.4 from the eye, `Cannot reach`, and round 59's rule blacklisted the whole trunk for 10 minutes.
  - **What followed:** the old floor then failed the walk at (743, 67, -611) with `Navigation left the surface`, the third strike, and the coastal wander began. Two other logs this round went the same way, at (830, 101, -496) and (885, 104, -508).
- **normal3 stood 7.5 minutes** at (831, 57, -418), `waiting: bag full (iron craft)`, dropping cobblestone that came straight back 15 times. Its iron pick was already made.

**Fix: a tree in a valley is no longer lost from a hill** (`worker.js`, the gather's `searchLeg` and `gatherFailed`). Neither half saves that oak alone, so they went in together.
- **A finished search leg brings the surface floor down.** If the leg ends below `job.surfaceY` under open sky (`SKY_OPEN`), `job.surfaceY` drops to the bot's y: `Gather: the surface floor comes down from y=A to y=B at the end of the leg`. Down only, and only at a leg's end, so a failed path that drops the bot into a ravine still moves nothing. A leg is already held to the old floor plus `SURFACE_SLACK`, so one leg lowers it by 12 at most.
- **A walk that fails on a log with logs below it tries the foot once.** The trunk is not blacklisted on that first failure (the block itself still is): `Gather: no walk to the oak_log at P; trying the foot of the trunk`. The next try on that column goes to its lowest log. If that also fails, the trunk goes, as in round 59. A `walk ok` failure, the lowest log and ores are unchanged.

**Tests:** `round103.test.js` (7), through the real `gather()`: the round-102 oak from the hill; a leg ending under a roof; a leg ending higher; a gather with no floor; a foot with no walk; a tree the walk reached but cannot dig; the lowest log and an ore. Five mutations each fail at least one test (no floor change, no foot in `gatherFailed`, no foot in the target choice, no sky gate, no down-only gate). 844 pass, resources 9.

**Not changed yet**
- **hard2's death:** a bag-clearing drop ran with a 99-mob crowd in range, and the shot came in two bursts. A drop job gives no cover.
- **The bag-full wait** (normal3) and cobblestone dropped where it is picked straight back up.
- **The round-102 pin and the round-101 turn** still have no live run. Their risks stand: the roof climb leaves the box's blocks behind, and the exit margin equals the creeper wait for a mob in the open.
- **A kit in a crowd,** bag run across a run change, cornered with no weapon, the enderman counted as holding a box, the wrong killer on a death line, `BAG_WORTH` and large stacks, going pickless with a full bag, spear zombies, group-spacing by a drop, a food hunt under a roof, creeper flees ignoring skeletons, lava at y=-25, hard pacing, the `Shelter block remained` error at two openings.

## Round 103, pre-soak changes (2026-11-07)

These went in after the wood fix and before the round 103 soak, so the soak tests all of them together. The work stopped when its usage ran out, before writing this section; this is the review of it. It left nothing uncommitted.

**Commits**
- `e9fa1ab`: `tests/soak_report.py` prints a round's per-run counts, quoted lines, rung table and box list. Run on round 102 it gives the report's figures: 6 run windows, 3 `held past dawn by`, 25 `Job: Navigation left the surface`, 5 `Gather: skipping *_log`.
- `a687ab9`: two scenarios in `tests/obstruct.py`, `bag_run_no_path` and `box_pinned`, so the probe now has 13.
- `42c25b9`: a toss that comes back underground climbs to the surface once per drop job and tosses there (`dropClimbOut`, `DROP_CLIMB_MIN=3`). Line: `Drop: the toss at P came straight back; climbing to the surface (y=N) to toss there`; `Drop: the climb out stopped (...)` if it does not.
- `70d3f71`: the shelter exit margin is now the creeper wait plus `SHELTER_OPEN_MS`, and the creeper and crowd waits stop `SHELTER_OPEN_MS` before the job limit. New ending on the wall line: `Shelter: creeper D away with N s left on the job; opening the walls`.
- `e74aee9`: the iron helmet comes first after the iron core: crafted as soon as 5 ingots are held, its raw iron smelted before the torch trip, and the bucket waits for it.

**What the review changed**
- **The round-102 pinned climb did not work in a box that reads open sky.** The first live `box_pinned` run proved the pin fires (`Shelter: pinned 30 s past dawn by zombie 6.7 dy -3 sky 0`), then `Ascend: head sky 15 at y=-60`, `y=-60 -> -60`, `could not climb out; holding the box`. A roof the bot placed does not darken its head cell on the client, so `pillarUp`'s sky test ended the climb before it began. `ascend` now takes `minY`, the rise a climb must make before the sky test counts, and a pinned climb passes `y0+3`. Rerun live: `y=-60 -> -57` in 3.5 s, job complete. Round 101's hard3 box was at the surface, so without this the fix would probably not have saved it. That is inferred; no soak has logged the head sky of a sealed surface box.
- **`SHELTER_OPEN_MS` went from 30 s to 45 s** (margin 105 s), because round-102 openings took up to 42 s from `opening up` to the next job.
- **Comment fixed:** normal3's tunnel was 34 under the surface (y=91), not 6.
- **Round-103 lines added to `tests/soak_report.py`.** `tests/round79.test.js` reads the source text of the climb call, so it was updated with it.

**Live results on the flat world:** `bag_run_no_path` fired all four `turning` lines (`no path on the line`, then 45, -45 and 90 off it), the first live proof of the round-101 turn. `box_pinned` is above.

**Tests:** 856 pass, resources 9, rung table ok. Seven mutations across the climb, the toss, the exit margin and the helmet each fail at least one test.

**Not done**
- **Diamonds:** no findings were written and no change made.
- **Using a held bed:** not started.
- **The flaky round 71 test:** not started.

**Risks to watch**
- **A creeper at the wall now gets the walls opened beside it** when the job is nearly out of time. Before, the bot stayed inside.
- **A toss deep in a mine climbs all the way up.** There is no depth limit, so one in the diamond band could cost minutes and the place in the branch mine.
- **The helmet moves ingots ahead of torches and the bucket.** Torches can come later when raw iron is held.
- **The soak changes several things at once,** against the one-change rule, at the user's choice. The wood fix shows at the start of a run; the helmet, toss and exit timing show after the iron pick.

## Round 104 (2026-11-08)

**What the round-103 soak showed** (report `ee2120c`, bot code `a485c4b`, promoted): iron on 5 of 6 again, but the miss moved from hard1 to hard2. Iron picks 543/904/814/1901/-/573. hard1's 1901 s is its first iron since round 98. Hard wood 362/453/241 (round 102: 1054/302/241), hard stone 422/543/332, hard furnace 513/-/422. Deaths 0/0/0/1/5/1 = 7 (round 102: 1). No diamonds.
- **The valley-tree fix worked.** 19 `surface floor comes down` lines; hard1's floor came down 10 blocks and its wood landed at 362 s. 8 `trying the foot of the trunk` lines; normal2's foot walk took a cherry trunk in 94.5 s.
- **The helmet fix worked.** Helmets were worn at 1359/1274/1150/1763 s (round 102: first armour 2110/1657/1808/2229). Torches always came first, and the bucket after the helmet. All seven deaths still say `armour 0`.
- **The toss climb fired twice and rose 0 and 2 blocks** (`Pillar: no rise`). The retried drop stayed gone both times. Bag-full stands fell to one: normal2 at (923, -22, -423), where no chest could be placed (six `no path for place chest`) and no drop job ran.
- **The round-102 pin fired for the first time** (hard1, a creeper 7.2 and a zombie 9.9, both sky 0). The roof climb rose 4 (`y=78 -> 82`), but a creeper override 2.3 s in, then a 60.6 s pillar/keep-away thrash, ended in `blown up by Creeper` 78 s after the pin. One `TaskRunner error: Cannot read properties of null (reading 'toFixed')` came just before the shelter supersede.
- **The exit-timing line did not fire** (0 `creeper D away`); 0 `Job time limit reached` on a shelter job.
- **hard2's run was lost to one chain of deaths.**
  - Death 1 is the start, at 20:00:13, `slain by Zombie`. The night mine from the box at (821, 88, -548) went down to y=76 and was on its way home: the samples show it at (821, 86, -548), in the sump.
  - At 20:00:07.837, `Reflex: a hit on the night mine; Mob Defense answers` came with a 45-mob flee list, and Mob Defense preempted the shelter.
  - At 20:00:08.136, `Reflex: resumed the shelter job`, 0.3 s later. Then `Shelter: moved from 821,88,-548 to (820, 87, -547); building a new box here`.
  - 5 s after that came the death, with `health 14 -> 9.5 -> 5 -> 0.5 -> 0; 5 hostile(s) within 8: zombie 0.8, ...`.
  - What followed: a night respawn into a zombie crowd at the spawn (death 2, 31 s later, 78 respawn-guard lines), then 18 minutes in the western water maze at hp 1.3, then deaths 3-5 (a drowned trident, drowned, zombie).

**Why death 1 happened.** The round-84 override that lets Mob Defense answer on the night mine needs `hold.mining`. In `survivalHold()` that comes only from the running branch (`nightMining && !shelterSealed`). As soon as Mob Defense preempts, the shelter job is paused, nightMine's `finally` clears `nightMining`, and the waiting branch has no `mining` at all. The next gate tick holds Mob Defense off, the runner goes idle, and the resume bridge hands the bot back to the shelter, which starts placing a 25-block box among the zombies. Round 93 had the same hole for an opened box and closed it with `openedUnder`; the night mine never got the same treatment.

**Fix: the paused shelter keeps the night mine's override** (`worker.js`, the chain gate and `survivalHold`). When the override fires on the night mine, the job is marked (`minedUnder`), and the waiting branch reports `mining` for `OPENED_GUARD_MS` (60 s) after the last mark, as `opened` does. Mob Defense keeps answering while `mineThreat` has a hit in the last 3 s or a hostile within 8. When the tunnel is clear, or past the guard, the shelter resumes as before. The first time a paused job holds this way it logs `Reflex: the shelter job waits off the night mine while Mob Defense answers <threat>` (`a hit` or `a zombie within 8`), once per job. A sealed box, a box still going up, and a paused shelter that never mined keep the old hold.

**Tests:** `round104.test.js` (4), through the real chain gate and `survivalHold`: the round-103 hard2 shape (hit on the mine, paused, still answered, the line once); the tunnel clear and past the guard; a shelter that never mined; a sealed box and a box building after the mine. Removing the waiting-branch `mining` fails 3; removing the mark fails 1. 860 pass, resources 9.

**Not changed yet**
- **The pinned climb walked out beside the creeper that held it.** The pin does not look at creepers; a creeper at 7.2 and dy -4 was one of the two named mobs. The thrash after it (60.6 s) is the longest of the series.
- **The `toFixed` of null error** at hard1's shelter supersede: one occurrence, caught.
- **hard2's night respawn** into a spawn crowd (death 2, 31 s after the respawn), then the water maze at hp 1.3.
- **The toss climb rose 0 and 2:** `Pillar: no rise` under diorite and dirt. The drop retry made it harmless this round.
- **normal2's iron pickaxe broke** at 18:20:12 with no new one before the run ended, and its bag-full wait at y=-22 had no drop job.
- **Beds crafted (normal1, normal2) and never slept in;** diamonds 0 for the third round.
- **Older items:** a kit in a crowd, cornered with no weapon, the enderman counted as holding a box, the wrong killer on a death line (hard1's `killed by skeleton` after `blown up by Creeper`), `BAG_WORTH`, spear zombies, group-spacing by a drop, a food hunt under a roof, lava at y=-25, hard pacing.

## Round 105 (2026-11-08)

**Round 104 results** (report `5a09729`, bot code `1f28558`, the triple promoted).
- Iron came on 4 of 6 runs: 542/1416/874/-/1265/-. Hard wood was 362/271/181 s, every run under 400 s.
- There were 3 deaths, all hard3 (two creeper blasts, then a drowned in the river its night job walked it into). Round 103 had 7.
- All three normal runs wore two armour pieces (1566/1928/1054 s). normal3 went from iron pick to helmet in 164 s, the fastest yet.
- The round-104 fix fired 3 times, all hard2: `Reflex: the shelter job waits off the night mine while Mob Defense answers a skeleton within 8` (and a creeper). hard2 had 0 deaths and got iron at 1265 s, one round after five deaths and no iron.
- The round-102 pinned climb fired cleanly a second time, on hard2. It rose 10 to head sky 15 with no damage; a creeper hovered for 4.5 minutes after it, but never fused.
- The round-103 toss climbs both rose this time (0 `climb out stopped`). There were no bag-full stands and no `TaskRunner error`.

**What went wrong: hard1 sat on its night perch for 32 minutes.** At 00:08:51 (tod about 9950), a crowd of 6 sent it up a 3-block night pillar at (798, 81, -508). It laid the overhang ring and the walls, logging `Night: perched 3 up; holding until morning`. Every sample from t=490 to the end of the run (2408 s) then stood at (798, 84, -508) with `queued: craft`: 1921 s, 80% of the run, through a whole day. It made no furnace or iron, and it never got hungry.

**Why it held.** The perch is left by `leaveRefuge`: once the morning is light, it needs nothing hostile within 16, and from tod 3000 nothing within 6. The ring is an overhang 2 blocks over the cells around the column's foot. A mob standing there is in its shade and never burns, and a creeper does not burn at all. Mobs held there have no reason to leave, so the morning rule could not release the perch, and nothing else would.

The queued stone-axe craft also kept the night job back all night. The autopilot treats a queued craft as "about to start", but Mob Defense held the runner, so the craft never started and no shelter was ever sent (see Not changed yet).

**Fix: a perch pinned past dawn comes down** (`chains/fallbackTasks.js`, NightPillarTask; `chains/mobDefenseChain.js`).
- Still perched in the light morning means something holds the perch. The first such tick logs `Night: held on the perch past dawn by <mob D dy N under cover|in the open>, ...`: up to 4 mobs, within 16 before tod 3000 and within 6 after.
- `PERCH_PINNED_S` (30 s) later, if none of the holders is a mob the sun will clear, the perch is pinned. A mob the sun will clear is a zombie, zombie villager, skeleton, stray, bogged, drowned or phantom with nothing solid over its head for 24 blocks. The pinned line is `Night: pinned on the perch N s past dawn by <...>; opening the <east|west|south|north> wall and coming down`.
- The bot then digs the head and the feet wall block on the side farthest from the holders, with its pickaxe. No ring or wall goes back up. The perch ends when that side is open, or after `PERCH_OPEN_S` (20 s).
- Mob Defense then answers the holders on the ground, by day. It does not plan a new pillar for `PERCH_RETRY_S` (120 s), because a day crowd of 6 would otherwise put the bot straight back up on the same deck.
- A holder the sun will clear (a zombie in the open) keeps the old wait. So do a dark morning (before tod 1000) and a day pillar (round 40, down once quiet).

**Tests:** `round105.test.js` (5), on the real NightPillarTask and MobDefenseChain:
- the round-104 shape (a zombie and a creeper in the ring's shade): held line, pinned at 31 s, the west wall dug head then feet, the perch ended, no wall re-placed, the state kept through `resumeCopy`;
- a zombie in the open, a dark morning and a day pillar, none of which pin;
- past tod 3000 only holders within 6 count, and a hold pillar pins the same way;
- an opening that never lands still ends after 20 s;
- Mob Defense does not re-pillar for 120 s.

Removing the `_pinnedTick` call fails 4 tests; removing the retry backoff fails 1. 865 pass, resources 9.

**Not changed yet**
- **The night job behind a queued craft.** `autopilot.js` counts a queued craft as busy, so the night job does not go out. A craft that Mob Defense holds back never starts, so hard1 got no shelter (and no night skip) all night. With a shelter queued, the gate would have stood Mob Defense down, and the box would have gone up on the deck, as in round 99.
- **hard3's deaths:**
  - a 22.4 s creeper thrash with no pillar before the fuse, and both fuse walls placing 0 blocks;
  - the night job's burrow walking it into the river, where `Pillar: stopped at y=62 (no blocks held)` came twice before the drowned death;
  - no kit back from its bag runs (`out of time after 3 run(s)`).
- **Beds crafted (normal1, normal3) and never slept in;** diamonds 0 for the fourth round.
- **Older items:** the pinned climb beside a creeper (round 103), the night respawn into a spawn crowd, a kit in a crowd, the wrong killer on a death line, `BAG_WORTH`, spear zombies, a food hunt under a roof, lava at y=-25, hard pacing.

## Round 106 (2026-11-08)

**Round 105 results** (bot code `2de4780`, the triple promoted). These come from the soak log and the bot log: the tester's report was not in when this was written.
- Iron came on 3 of 6 runs, all normal: 512/572/663/-/-/-. Every normal run wore two armour pieces (1175/1054/934 s).
- normal2 found the first diamonds in any soak (3) and made a diamond pick at 2320 s. normal3 made a bed at 512 s.
- On the hard runs, hard1 got its furnace at 603 s and 2 raw iron but no ingots; hard2 got its furnace at 512 s. hard3 never kept any wood.
- Deaths were 0/0/0/0/3/31.
- The round-105 perch fix did not fire. No perch was still held at dawn: there were 2 perches, and both were knocked off the pillar.
- The round-104 fix fired once (`waits off the night mine while Mob Defense answers a creeper within 8`).

**What went wrong: hard3 died 31 times in a respawn loop.**
- **The first night.** At dusk hard3 held 9 cherry planks and 3 logs on a cherry hill at (825, 89, -535). Its night pillar placed one plank and fell off (`left the column at 0/3`). The burrow was `not here (cherry_planks at 825,89,-536)`, on that plank. The shelter then logged `Short of shelter blocks: 0 held, 24 needed`: planks do not count as shelter blocks, though the 3 logs would have made 12 more, enough for the 13-block pod. A second pillar also failed, and it was slain at 08:17:38.
- **Every respawn after that.** Each came back at night to the world spawn, (704, 71, -423) on a river bank, with an empty bag. It logged `respawned at night; shelter at the spawn point first`. The burrow there was `not here (open wall beside 707,65,-431)`, then `(water at 717,62,-437)`. A night pillar from 3 dug blocks was knocked over in 16 s, and Mob Defense's respawn override (round 85) then fled unarmed among drowned, with `resumed the shelter job` about once a second.
- **The loop.** It died again 10-40 s after each respawn: 23 deaths in two clusters, 08:17-08:22 and 08:36-08:44. Hostiles do not despawn while a player stays within about 32 blocks, so every death at the spawn kept the crowd there, and the flee lists grew past 30 mobs.

**Fix: a night respawn into a crowd runs out before it digs in** (`worker.js`: `escapeSpot`, `respawnEscape`, the shelter job, `survivalHold`, the death handler).
- This is what a skilled player does: they do not build at the spawn, they sprint out of the crowd and dig into the ground by hand where it is dry.
- **When.** At the start of a dark shelter job, before the burrow or the dirt dig. All of these must hold:
  - the bot is within `ESCAPE_SPAWN_R` (16) of where it respawned, or the world spawn point if that is not known yet;
  - the bot is inside the respawn guard (180 s after the death);
  - there is a hostile within `ESCAPE_NEAR` (16), or no burrow fits at its feet.
- **Where.** `escapeSpot` tries 16 bearings at `ESCAPE_DIST` (36) and at 27 blocks. A spot counts only if:
  - it has a surface stand within 10 blocks of the bot's level;
  - there is no water or lava within 2 of it;
  - a burrow fits there by hand, or with a pickaxe on stone if one is held.

  The score is the room from the hostiles (capped at 48), less 6 for every wet column on the line, plus 8 times how well it lines up with the flee direction. The shorter radius costs 4.
- **The log.** `Respawn: at night with <N hostile(s) within 16 (mob D, ...)|no hostile within 16>[, no burrow here (<why>)]; running D blocks <compass> to dig in at X,Y,Z (nearest hostile D from it[, N wet column(s) on the way])`. Then either `Respawn: ran out to P in N s; digging in`, or `Respawn: the run stopped at P after N s (<error>); sheltering there`.
- **The run.** `ESCAPE_WALK_S` (35 s) at most. While it is on, Mob Defense's night-respawn override is off: the run is the answer to the threat. A creeper still overrides.
- **After the run.** The shelter job goes on where it stands. With an empty bag that is the hand burrow (round 32).
- **Limits.** `ESCAPE_TRIES` (2) runs per death, for a shelter job that a preemption resumed. If no dry spot is found: `no dry spot to dig in 36 out; sheltering here`.
- The death handler now records where the respawn landed (`respawnPos`).

**Tests:** `round106.test.js` (10):
- `escapeSpot` on a river bank with the mobs on the river side (dry, burrowable, 28+ from the mobs);
- the flee line on dry ground;
- water everywhere, and stone without and with a pickaxe;
- `compassOf`;
- the run with its log lines, and the override off during the walk;
- quiet ground that can be dug into stays put, while a wet spawn with no mob still runs;
- only at the spawn, only in the guard, 2 runs per death, and a new death runs again;
- a run that stops on the way;
- no dry spot anywhere;
- `survivalHold`'s respawned flag and `nightMineOverride` during the run;
- the shelter job calls the escape before any burrow.

Removing the `respawnEscaping` check from `survivalHold` fails 1 test. 875 pass, resources 9.

**Not changed yet**
- **Planks and logs as shelter blocks in the dark.** hard3's first death had 9 planks and 3 logs: `SHELTER_ITEMS` counts only cobblestone, dirt, cobbled deepslate and netherrack. This is the next candidate.
- **Waiting out the night on the death screen** after repeated night deaths at the spawn. This is a backstop if the loop still shows up.
- **The night job behind a queued craft** (round 105).
- **hard3's round-104 deaths:** the creeper thrash, the river night job, bag runs that came back empty.
- **Beds crafted and never slept in** (normal3 made one at 512 s).
- **Older items:** the pinned climb beside a creeper, a kit in a crowd, the wrong killer on a death line, `BAG_WORTH`, spear zombies, a food hunt under a roof, lava at y=-25, hard pacing.

## Round 107 (2026-11-08)

**Round 106 results** (bot code `87ccb93`, report `ad3f305`, the triple promoted).
- Iron came on 4 of 6 runs: 572/632/723/-/-/1206. hard3 got iron for the first time since round 102, despite 2 deaths.
- normal3 wore 4 iron pieces at 964 s, the first full iron kit of the series. normal2 found 5 diamonds.
- Deaths were 7 = 0/0/0/3/2/2 (round 105: 34).
- **The round-106 run-out fired once and worked.** After hard2's second death it logged `Respawn: at night with no hostile within 16, no burrow here (open wall beside 702,67,-431); running 36 blocks south-east to dig in at 735,71,-417`, `ran out to (734, 71, -417) in 7.9 s`, then `Burrow: dug in` 4.1 s later. It took no damage, and the night skip later came from that burrow. There were 0 deaths within 120 s of a respawn (round 105: about 23).
- The round-105 perch fix did not fire again: no perch lasted to dawn.

**What went wrong: armed bots ran from the one mob that was already on them.**
- **hard3, death 1.** It opened box D (held 238 s past dawn) with a stone sword at health 17 and struck a spider once. Then `Reflex: fleeing ... (vulnerable)`: `_inDanger` reads armour 0 and health under 18 as vulnerable. The spider bit it from behind, 17 -> 14 -> 11 -> 8 -> 5 -> 2 -> 0 in 7 s, and `cornered - fighting back` (round 91, 2 s pinned) came at health 2.
- The flee lists flickered with and without the spider: `leaveAlone` drops a spider at sky 12+ by day whenever it is more than 2 away, even one that is biting.
- **hard2, death 1.** It fled one zombie `(vulnerable)` and was cornered at health 4.3 against lava.
- **hard2, death 2.** The same shape with a drowned in the river: cornered at health 11, then 3.
- A spider is about as fast as a sprinting player and climbs, so a flee from one cannot open a gap. A skilled player turns and fights one or two melee mobs that are already on them, and runs only from a crowd or from what they can outrun.

**Fix: stand and fight a melee mob that keeps up with the flee** (`mobDefenseChain.js` `_chasedBy`, the cornered branch; `provoked.js`; `combatPolicy.js` `leaveAlone`).
- **When it applies.** All of these must hold:
  - this chain's last tick was a flee (`RunAwayFromHostilesTask` or `KeepDistanceTask`; not the creeper keep-away);
  - the bot holds a real weapon (a sword or an axe);
  - there are at most `CHASE_MAX_MELEE` (2) melee mobs within 8;
  - a melee mob (not a creeper) is within `CHASE_NEAR` (3) and in sight.
- **When it fights.** At once for a mob in `OUTRUNS` (spider, cave spider). After `CHASE_S` (1 s) of a mob staying within 3 otherwise; a gap of more than 1 s starts the clock over.
- **The fight.** It uses the round-91 cornered fight (`KillEntitiesTask` `lastResort`). It does not bail at health 6, and it keeps on while a melee mob stays within `PINNED_KEEP` (5).
- **The log.** `Reflex: <mob> D away outruns the <flee>|has kept up with the <flee> for N s (health H, held X, M melee within 8); standing to fight`, once per episode.
- **The spider in daylight.** A spider that hurts the bot is now marked provoked (`DAY_NEUTRAL`; `entityHurt` already did this for passive mobs), and `leaveAlone` keeps a provoked spider as a threat for 60 s.

**Tests:** `round107.test.js` (4 tests):
- the round-106 hard3 spider: fought on the second tick, logged once, and still a target at 3.5 once it has bitten;
- a zombie on the heels of a moving flee: fought after 1 s; a flee that gains is not; the clock restarts;
- no stand unarmed, with 3 melee mobs, through a wall, from a creeper, or from a skeleton;
- the provoked spider and `leaveAlone`, and other hostiles not marked.

`round91.test.js` now runs on the round-91 pinned path alone (`_chasedBy` stubbed out). Removing either the chase from the cornered branch or the provoked check from `leaveAlone` fails 2 tests. 879 pass; resources 9.

**Not changed yet**
- Planks and logs as shelter blocks in the dark: not hit in round 106.
- **Boxes held past dawn by mobs in the open.** hard3's box D was held 238 s by a spider and skeletons at sky 13-14. A daylight spider holds a box forever, and the skeletons' burn is not read.
- hard1's skeleton snipes (death 2 had 0 hostiles within 8) and the late wood (1748 s).
- hard3's death 2 in its own mine at y=37 (`pillar-up failed ... on unloaded`).
- Waiting out the night on the death screen, the night job behind a queued craft, beds never slept in, and the older items.

## Round 108 (2026-11-08)

**Round 107 was stopped before its soak.** The tester had pulled `61bbe50`, passed the units (879) and was restarting the services when the user stopped it. It is replaced by this round, so round 107's stand-and-fight has never run in a soak.

**A correction to round 107.** Its comment said a spider is about as fast as a sprinting player, so a spider within 3 was fought at once. That was wrong.
- **The game's figures** (the wiki's Sprinting and Walking pages): sprinting 5.612 blocks/s, walking 4.317, sprint-jumping about 7.13.
- **Mob speeds:** the mob speed attribute (spider 0.3) is not on the player's scale. A spider runs about 3.9 blocks/s and a zombie about 2.3, so a sprinting player outruns both.
- **How players escape:** they sprint (food above 6) and break line of sight. They get into light, where a spider that followed calms down unless it was hit. A 1-wide gap stops a spider; a 2-high pillar, water or a door stops a zombie. They fight when the run cannot work.
- **What round 106 actually showed:** the bot's flees were not moving. hard3 was `stranded at (809, 93, -544) (drops on every side)` on its box top 9 s before the spider got it, and moved about 5 blocks in its last 7 s. hard2's flee was stopped by `Lava guard: ... lava ahead`. hard2's second death was in the river, where drowned outswim a player.

**Fix: the stand rule without the spider exception** (`mobDefenseChain.js`). `OUTRUNS` is gone, so every melee mob is fought only once it has kept within `CHASE_NEAR` (3) of a flee for `CHASE_S` (1 s), which a sprinting flee never allows. The line is always `Reflex: <mob> D away has kept up with the <flee> for N s (health H, held X, M melee within 8); standing to fight`. The rest of round 107 stands: the conditions (a real weapon, at most 2 melee mobs within 8, not a creeper, in sight), the cornered fight, and the provoked spider.

**New: the speed meter** (the user asked for it, to match the bot's real sprint against the game's).
- **Flee episodes** (`mobDefenseChain.js` `_fleeMeter`, `GAME_SPRINT`, `FLEE_METER_MIN` 1 s). Each run-away, creeper keep-away or keep-distance episode of 1 s or more logs, when it ends: `Speed: the <flee> ran P blocks (straight S) in T s = V blocks/s, N% of the game sprint 5.612 (walk 4.317); sprint key A% and forward B% of K ticks, food F; nearest hostile <mob D> -> <mob D|none>`.
- **Every 5 minutes** (`worker.js` `speedTick`, beside the sprint-share gauge). The measured horizontal speed while the forward key is down on land, given for sprinting, for sprinting on the flat (on the ground, y steady, no jump, the first 10 ticks of each stretch left out), the best 1-s flat window, and walking: `Speed: sprinting V blocks/s over T s (N% of the game sprint 5.612), on the flat V over T s (N%), best 1 s V (N%); walking V over T s (the game walk 4.317)`. A tick over 200 ms or a step over 2 blocks (lag, a teleport) is not counted.
- **The reason:** it shows whether the bot's sprint is really a sprint, and which flees ran and which stood still.

**Tests:** `round108.test.js` (4): the 5-minute line at the game's own speeds (lag and teleports left out), a slow sprint and a sprint-jump kept off the flat figure, no line in water, a flee's speed line with its sprint share, nothing for a flee under 1 s, and the stand line before the speed line of the flee it ended. In `round107.test.js`, the spider is fought after 1 s, not at once. The chain tests that compare the last log line (rounds 75, 91, 95, 98, 107) leave `Speed:` lines out of their logs. Disabling the flee meter fails 2 tests; dropping the speed-up ticks from the flat figure fails 1. 883 pass; resources 9.

**Next, once the meter shows it:** make a stuck flee move. When the flee is stranded on a box top, at a lava edge or in water, drop off the side away from the mob and sprint; head for daylight from a spider; use a 1-wide gap against a spider and a 2-high pillar against zombies. Flee only from the mobs that can reach the bot, not from 30 mobs underground.

## Round 109 (2026-11-09)

**What the round-107 soak showed.** The round-108 code (the speed meter and the 1-s stand) was committed at 22:53 IST, six minutes before the soak's first run started from the same folder, so the "round 107" soak (`93e4ff8`) ran the round-108 code throughout: its `Speed:` lines start at 23:02 IST. The round-108 tester run was stopped at the service restart on the user's go-ahead, and this round uses that soak's figures.

- **The bot can sprint.** Every run had a best 1-s flat stretch of 5.9-7.0 blocks/s (the game sprint is 5.612). On the flat it ran 4.9/4.8/5.3/4.7/4.0/3.4 blocks/s (60-95% of the sprint); over all sprinting ticks about 3.2 blocks/s, the pathfinder's stops, turns and climbs.
- **The flees did not run.** 35 flees of 1 s or more, all on the hard runs: running from hostiles 24 at a median of 1.2 blocks/s, 16 under 2.0; running from creepers 10 at a median of 2.0, 6 under 2.0. hard2 held sprint and forward for 14.8 s and moved 1.3 blocks with a zombie 3.5 away throughout; hard3 ran 37.6 blocks in 20 s and ended 0.2 from where it started. All four deaths came 2-3 s after a `cornered - fighting back` line, the bot pinned.

**Why.** The blind flee (`RunAwayTask`) held forward and sprint toward its heading and never pressed jump. The game steps up 0.6 of a block without a jump, so a one-block rise stopped it dead. It never gave up a heading that was not moving it, and it re-chose its heading from scratch every tick, so a crowd that shifted turned it in circles.

**The fix (what a skilled player does: pick one way out, jump what is in the way, sprint-jump, turn when blocked).**
- **Jumps:** `fleeJump` (night.js). The flee jumps when the cell ahead is a one-block step with room over it. It also sprint-jumps on open ground (the game's sprint-jump is about 7.1 blocks/s against the sprint's 5.6) when there is headroom over the bot and ahead and footing ahead. Never into a low roof, a drop, water, or while swimming.
- **Commits to a heading:** `fleeHeading` takes `prev`, the last tick's heading, which costs `FLEE_KEEP` 4 less within 0.4 rad of it.
- **Turns off a blocked heading:** a heading that has not moved the bot `FLEE_STUCK_BLOCKS` 0.8 in `FLEE_STUCK_S` 1 s goes on an `avoid` list for `FLEE_AVOID_S` 3 s (+50 cost within 0.6 rad). Time off the flee (over `FLEE_STUCK_GAP` 0.5 s between its ticks, such as the fuse wall holding) restarts the clock. The first 3 per flee are logged: `Flee: no headway for N s heading <dir> from (x, y, z) (ahead: feet F, head H); trying another way`. The round-91 pinned fight still takes over after 2 s pinned.
- **The flee speed line** now carries the jump share: `sprint key A%, forward B% and jump C% of K ticks`.

**Tests:** `round109.test.js` (5): the step jump, the sprint-jump and every case it refuses; the kept heading and the avoided one; a dead-end pocket that logs `no headway`, turns, stops logging once moving, forgets the heading after 3 s, and logs at most 3 lines; the step jump inside the task, and a heading blocked by water standing without a jump; and time off the flee not counted. `round108.test.js`'s flee line has the jump share. Removing the jump fails 2 tests; removing the avoid list 1; removing the pause reset 2 (with round 87's fuse wall). 888 pass; resources 9.

**Next:** read the flee lines again. Flees should run at 4+ blocks/s with a jump share on rough ground, `Flee: no headway` lines should be followed by movement, and there should be fewer `cornered` lines and deaths after them. Then armour: all four round-107 deaths had armour 0, and only single helmets were made.

## Round 110 (2026-11-09)

**What the round-109 soak showed** (`57c14d4`, bot code `765e802`; the tee is named `soak-round108.log` but the code was round 109's). The flee moves now: 21 flee lines, median 4.53 blocks/s (round 107: 1.2), jump share 42-56% on the running flees, one `Flee: no headway` line that turned into a 105.9-block flee at 92% of the game sprint. 0 `cornered - fighting back` lines (round 107: 4). Iron pick on 6 of 6 runs, two full iron kits, and 1 death (round 107: 4).

**The one death** (hard3, 02:43:41Z). The box was pinned at dawn by a creeper and a skeleton under rock. The bot climbed out under the canopy into a crowd and went back to crafting. A skeleton fight (`spacing skeleton`, 0 hits, 5.9 taken) left it at health 7. The 30-block flee ran 7.3 blocks in 1.4 s, then the `still recovering` branch replaced it with `KeepDistanceTask(16)`, with the skeleton 10.0 away. It was `shot by Skeleton` 3 s later: health 14.8 -> 7.4 -> 1.8 -> 0, armour 2.

**Why.**
- The keep-away (`KeepDistanceTask`, also used for the daylight-burn flee) never got the round-109 flee: it had no jump and no turn off a heading that does not move it.
- Its 16 blocks are inside a skeleton's bow. The wiki's skeleton shoots within 15 blocks with a line of sight, and under leaves it does not burn.
- Between 16 and 20 blocks it walked back toward the mob, so it hovered at the edge of the bow's reach.

**The fix (what a skilled player does: get out of the bow's reach or out of its sight).**
- `fallbackTasks.js`: the round-109 flee step is one function, `fleeStep`, used by both the run-away and the keep-away.
- A skeleton, stray or bogged within `RANGED_KEEP` (24) that can see the bot (`inSight`, eye to eye, every half block) keeps the keep-away running until it is past 24 or out of sight, with no back-walk toward it. This is logged once a keep-away as `Reflex: <mob> D away has the bot in sight (health H); keeping 24 away, past its bow range`.
- Melee mobs keep the old 16-block keep-away and the 16-20 hover.

**Tests:** `round110.test.js` (3):
- the skeleton at 10 (flee, one line), at 18 (still running, no back-walk) and past 24 (done), and a zombie at 18 (the old hover);
- a skeleton behind a wall (not in sight: the old keep-away);
- the keep-away's step jump and its `no headway` turn, 3 lines at most.

Each test fails with its part of the fix taken out. 891 pass with resources.test.js left out of the batch (3 more than at `765e802`), resources 9, metrics ok.

**Next:**
- Count the new `in sight` lines and the deaths by arrows, and read the keep-away speed lines (they should carry a jump share now).
- normal3 lost its iron pick at t=1802 with no wood to replace it: 1 stick, 1 plank, no logs. It was then stranded at (763, 71, -459) on a pillar top, with every path failing at once for its last 3 minutes. Keep a wood reserve for a replacement pick, and fix the general no-path stranded retry.

## Round 111 (2026-11-09)

**What the round-110 soak showed** (`4bb931e`, bot code `2126eff`). 4 deaths (0/0/2/0/1/1), all environment deaths: two lava deaths on normal3, an underground zombie crowd on hard2, and a creeper blast plus a skeleton on hard3. Iron pick on 5 of 6 runs; beds on two normals (normal1 at t=452, the earliest of the 2400-s era).
- **The round-110 keep-away never fired** (0 `has the bot in sight` lines). hard3's death came during the creeper flee, not the keep-away: health 12.2 -> 1.7 in one second with no creeper left within 8 at the death (the creeper went off), then `shot by Skeleton` from 6.6. The creeper flee does not count skeletons.
- **Flee median 1.12 blocks/s** (round 109: 4.53), 45 `Flee: no headway` lines. 28 of them came from one stone pocket on hard3 at (808, 82, -532), about 7 minutes. The shelter could not seal there (`1 open cells, first at 808,82,-532`, which is the bot's own cell, the bot at z -531.4), so the night pillar was tried and refused (`room 1`), and the flee thrashed in a pocket the mobs could not reach. No damage; food 18 -> 6.

**The death fixed this round** (normal3 d1, 09:05:19Z, `burned to death` at (836, 77, -407), armour 8, health 17 -> 0 in 5 s). The bot was dropping junk beside a lava pool and went in (`in lava; escaping ... (head air, feet air)`: the block under its feet was lava). It held the water bucket it had filled 14 minutes earlier. Both pours were refused: `Bucket-into-lava skipped: No ground below to pour against` x2. The escape headings then thrashed 2 blocks away until the death. d2, 3.75 minutes later, was the bag run back into the second pool beside it, with no bucket left (it burned with d1's drops).

**Why.** `douseFire` only aimed at the top of a solid block directly under the feet. Standing on lava, there is none.

**The fix (what a skilled player does: pour the water wherever it lands on or under them).** The wiki says water flowing into a lava source turns it to obsidian (flowing lava to cobblestone). Guides tell a player who falls in to place the water at or over themselves. A water bucket's use ray passes through fluids to the solid block behind it, and the water lands in the open cell on the face it hits.
- `escape-from-lava-task.js`: new `pourSpot(bot)`. It picks the cells to fill, best first: the feet, the lava under the feet, then the lava beside the feet (at the feet and one below). Each is filled against a solid neighbour: the block under it first, then its sides, then the one over it. The face must be within the game's 4.5 reach (`POUR_REACH`), with the eyes on the open side of it and no solid block between.
- `worker.douseFire` pours at that spot. A pour that is not the plain ground-under-the-feet one is logged as `Douse: no ground under the feet; pouring into (x, y, z) against the <block> <side>`. With nothing to pour against it fails with `No solid block within 4.5 to pour against` (was `No ground below to pour against`). The water check reads the filled cell.

**Tests:** `round111.test.js` (3):
- standing on a one-deep pool: the pour goes into the lava under the feet against the pool floor's top, with one log line;
- a four-deep pool: the pour goes against the rim beside the feet; with ground under the feet it is the old pour, with no log line;
- nothing solid in reach: an honest refusal.

Taking out the under-the-feet cell fails 2 tests; taking out the floor faces fails 2. The reach check is a safeguard: every face it tries is within about 3.6 of the eyes. 894 pass with resources.test.js left out of the batch (3 more than at `2126eff`), resources 9, metrics ok.

**Next:**
- Count the `Douse: no ground under the feet` lines, the lava deaths, and `Bucket-into-lava skipped` by message.
- The creeper flee should count a skeleton that can see the bot (hard3's death).
- The shelter's own-cell open seal (hard3's 7-minute pocket thrash).
- The hard2 underground zombie crowd during the night tunnel mine.

## Round 112 (2026-11-09)

**What the round-111 soak showed** (`0984431`, bot code `e9769f2`). **0 deaths on all six runs, the first zero-death soak since runs went to 2400 s.**
- Iron pick on 5 of 6 runs (hard3 missed it: its ingots peaked at 0). Two armour pieces on all three normal runs.
- The bed on normal3 came at t=693. Every hard run ran the full 2400 s.
- The round-111 douse fix never fired: the bot never entered lava. The round-110 keep-away never fired either: no skeleton ever had the bot in sight.
- 13 `Flee: no headway` lines with no cell over 5, so no pocket thrash.
- 3 pinned climbs, all completed. The probe matches earlier rounds.

**The problem fixed this round** (the group's builds; hard3, 15:40-15:52Z). After a night mine, the morning climb out of its box (`Boxed in ... dug 4 steps up east to (916, 83, -444)`, then `Ascend: no sky at y=83 ...; pillaring to the sky`) came up through the floor of a nether wart farm. The farm is a soul_sand bed at y=99 with warts at y=100, around (913-917, -443..-445).
- Next came `Navigation: stranded at (914, 99, -444) ... allowing drops of up to 6 and digging` on the farm itself.
- The night shelter then failed among the crop rows (`open cells 913,100,-445=nether_wart ...`, 25 open cells), and the bot night-pillared on the farm until morning.
- Its final bag held `nether_wart 5`.
- There were 0 `Dig: broke` lines: soul_sand is natural ground to every dig rule (`NATURAL_DIG`, `BURROW_SOFT`), and a wart pops off as an item when its soul sand goes.

**Why.** No dig rule knew about farms. The explore pathfinder, the stranded retry (which turns `canDig` on for the normal movements, whose `safeToBreak` is the library default), the ascend and stranded pillars, and the boxed-in stair-out could all dig soul sand under a wart, or farmland.

**The fix (what a player on a shared server does: never break someone else's farm).** On a shared server, breaking someone else's work is griefing, and a crop field is someone's work. Nether wart outside the Nether is always planted by a player. Breaking the soul sand under a wart, or the farmland under a crop, pops the crop off.
- `worker.js`: new `farmBlock(bot, block)`, which returns `'a crop'`, `'farmland'` or `'under a <crop> crop'`, else null. The crops are nether_wart, wheat, carrots, potatoes, beetroots, the melon and pumpkin stems, torchflower, pitcher and cocoa.
- `farmHarvest(block, spec)`: a gather job may harvest the crop it names (the wheat harvest). Never a wart, never farmland, never the block under a crop.
- `guardDig(bot, ...)`, installed at spawn: wraps `bot.dig` and refuses a farm block. The refusal is logged once per block as `Farm guard: not breaking <block> at (x, y, z) - <why>; a player-made farm (job <type>)` and throws `Farm guard: ...`. This is the backstop for every dig, the pathfinder's included (its dig error replans).
- `farmSafeMoves(m, bot)` on the normal movements, and a farm check in the explore movements' `safeToBreak`: the pathfinder never plans a farm dig.
- The ascend and stranded pillars' `clear` refuses a farm block, so they stop with `Pillar: ceiling at ...` under a farm floor.

**Tests:** `round112.test.js` (3):
- `farmBlock` and `farmHarvest`: the wart, the soul sand under it, farmland, bare soul sand and the rim beside the farm; harvests of wheat, carrots, a wart and the soil.
- `bot.dig` refuses the soul sand under a wart and farmland, with one log line per block. Plain dirt and a wheat harvest go through; a wart under a gather job is refused.
- With real `Movements` (prismarine-registry 1.21.4), both the explore and normal movements refuse the soul sand under a wart and allow the dirt rim. The sky climb's pillar `clear` refuses the farm floor.

**Mutation checks:**
- Taking out each of these fails at least one test: the normal guard, the explore guard, the ascend guard, the dig guard, the wart rule, and the under-a-crop rule (that last one fails all 3).
- The stranded pillar's own guard is not caught by any test. The `bot.dig` backstop covers it.

897 pass with resources.test.js left out of the batch (3 more than at `e9769f2`); resources 9; metrics ok.

**Next:**
- Count `Farm guard:` lines and `Dig: broke` lines, and what each climb that stopped under a farm floor did next.
- A climb that hits a farm floor should step a block or two sideways and come up beside it.
- A shelter should not be sited among crop rows; it moves off a farm before sealing.
- The autopilot's `gather wheat` from ripe farms takes from other players' farms too. It is out of scope this round; flagged for the user.
- hard3's missed iron pick (ingots peaked at 0).
- normal1's 35-minute flooded-quarry stretch (navigation refusals).
- hard1's night mine came back one block below its box.

## Round 113 (2026-11-10)

**Soak (report `c44aa36`, round 112, bot code `7173d54`):** clean, 6 deaths = 0/0/0/1/2/3, all on hard runs at armour 0; normals zero-death for the third round running; iron pick 4 of 6 (hard2 and hard3 lost their ingots on the floor). The round-112 farm guard never fired (0 `Farm guard:` lines; the climbs stayed ~95 blocks from the wart farm) - correct and unexercised. **3 deaths were endermen**, the first of the soak era, and 4 of the 6 fell within 4 blocks of each other on the cave floor at (857-860, 57-60, -542..-545).

**Cause:** hard2's death 2 - an enderman stood 1.8-2.0 from the bot for about 6 s while the bot's health rose 9 -> 14 (it was calm: an angry enderman at 2 blocks strikes at once). `leaveAlone` made any enderman within `LEAVE_ALONE_CLOSE` (2) a threat whether or not it was screaming, so the pinned KeepDistanceTask's `cornered - fighting back` (01:05:53.968, "enderman 2.0 away") hit it with the KillEntitiesTask, and `standing to fight` followed; the enderman answered 14 -> 3.5 -> 0 (`slain by Enderman`, 10.5 a hit on hard). The wiki: an enderman attacks only a player who looks at its eyes or hits it first.

**Fix (one change - never provoke a calm enderman):**
- `combatPolicy.leaveAlone`: an enderman is left alone at any distance unless it is screaming (metadata 17, new export `endermanAngry`); the 2-block rule still holds for the day spider. So `getHostiles`, the cornered and stand fights, the night-mine guard and the shelter guard never pick a calm enderman.
- `reflexes.isRealThreat`: the same for the old 6-block threat reflex (it fought a neutral within 2).
- `forcefield.js`: it read metadata 16 (the block an enderman carries) as the anger flag - one carrying a block with an odd state id was swung at. Now it uses `endermanAngry`.
- Diagnostic: `installEndermanWatch` (provoked.js, installed at spawn) logs once per anger `Enderman: the one at P (D away) turned angry; the bot's look was A deg off its eyes[ (a stare)]; last swung at it N s ago|never` - the game's stare test is a look within acos(1 - 0.025/d) of the eyes (2.55 up) with a clear line, so a level look at one 20+ blocks ahead provokes it. The next soak tells whether the bot's looks (pathfinder yaw/pitch, flee headings) provoke endermen too; a gaze guard is the follow-up if they do.

**Tests:** `tests/round113.test.js` (3): the death-2 shape (a pinned, chased flee with a calm enderman at 2.0 then 0.4 - never cornered or stand, never a KillEntitiesTask; the same enderman screaming is answered); the force field never swings at a calm enderman, carrying a block or not, and swings at an angry one; the anger line logs once, names a stare and the last swing, and clears when calm. `mob-etiquette.test.js`'s "cornered: answer it" case flipped (it encoded the bug). 900 pass with resources.test.js left out (+3), resources 9, rung table ok. Mutations: moving the enderman check back after the 2-block rule fails test 1; the old metadata-16 forcefield check fails test 2. The reflexes.js change has no unit test (the old reflex is a fallback path).

**Next candidates:** a sword sweep can still clip a calm enderman standing beside the zombie being fought; a gaze guard if the new line shows stares; hard runs' night crowds (flee median under 1 block/s on hard2, the 29-line no-headway pocket on hard3 at (812, 67, -552)); death 5's armed bot pinned 1 s against stone without the cornered gate; normal3 pick/wood and the noPath stranded retry still open; #375 skipped.
