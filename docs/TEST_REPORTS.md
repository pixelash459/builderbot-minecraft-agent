# Live test reports (Cursor)

Local verifier for whatever is on `origin main`. Model off. No name-kills. No second soak. Test server stays `server-ip=0.0.0.0`, world `agent-test-world`.

## 2026-10-14 15:18–15:52 IST — units and integration (`7cecac9` + local fixes)

`git pull --rebase` was already up to date at `7cecac9` (cloud commits `c3c0ce6`..`10112de` plus the tester brief). Unit tests, every `tests/*.test.js` except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000`: **222 passed, 0 failed**.

Services restarted with `AGENT_MODEL=off`. Supervisor: `model server disabled`. Port 8081 closed.

### Integration

| Run | Result | Where it stopped |
| --- | --- | --- |
| 1 | fail | Sleep. Dashboard: `Mob Defense engaging`, armor equips, `Server set position to (452, -63, 450)`, `Sleeping through this night`, then **You are sending too many packets!** The job never reached `Sleeping until morning`. |
| 2 | fail | First gather, `badColumns ["3,4"]`. The bot had been kicked at the bed and the origin floor had been filled solid at foot level while recovering the world. Not a code failure. |
| 3 | fail | Fresh restart. Gather, explore, chest craft passed. **Same packet kick** at the sleep site (09:39:37Z). Reproduced. |
| 4 | fail | After pacing `position_look`. Sleep, shelter, fight passed. Smelt died in 1 s: `destination full` on a leftover furnace within 16 of (800, -60, 800). |
| 5 | fail | That furnace removed. Smelt **completed** and the ingots were real. `pickUp` then dug the furnace with no pickaxe (`give_kit` is leather only) and the drop never entered the inventory (`Left the furnace at (800, -60, 799)`, block gone, `furnace` count 0). The nearby-furnace assert failed. A trial edit of that assert was reverted. |
| 6 | **pass** | `All in-game integration tests passed` at 10:22:40Z, 1081 s. A4 lava escape hp 18.8. |

### Fixes (loaded for run 6, not yet the cloud commits)

- `src/compat.js` — `position_look` shares the 30/s movement cap. A look every tick was turning the physics flood into uncapped `position_look` packets. Pure `look` stays uncapped.
- `src/worker.js` — a furnace this job placed is picked up only when a pickaxe is in the inventory. With no pickaxe it stays in the world, which is what the smelt assert checks. The ladder still picks it up after the stone step.

Combat and the dual soak are next. At most 3 combat runs.

## 2026-10-14 15:54 IST — combat run 1 of 3 (`5c2ff8d`)

`python tests/combat_integration.py`, model off, same services as the green integration. Exit 1. Two failures, neither is a mirrored-heading symptom:

- `test2_zombie_triple`: `Health below 8; retreated from zombie`.
- `test4b_creeper_roofed`: the spawn-corner dirt assert passed; the arena-center dirt assert timed out (execute-if stayed silent). The fight itself had already finished.

### Yaw / pillar / arrows

Lane creeper (`4_creeper`): one shot at d=14.1, then the gap opened 14.1 → 16.0 in 0.5 s. The job finished as **repelled** (creeper left alive, no crater on the three dirt samples). Recorded `damage_taken=0`, `hits=0`, `shots=1`. **End health was 3.86**, so the bot lost about 16 hp that the scoreboard did not count. No `pillar` line on this leg (it built the LOS wall instead).

Roofed creeper (`4b`): `Combat: pillar-up 2 at 1496,-60,1497 (creeper at 7.9)`, perched 2 up (the roof leaves no third block), one shot, `hits=0`. The log says `arrow no arrow entity found near the release` while an arrow name was visible. Server confirmed the creeper dead, end health **20**, recorded damage 0. The pillar fired. The arrow still did not count as a hit.

Movement did not look mirrored: the lane gap grew after the shot, and the roofed bot went up instead of walking into the creeper. Arrows still do not register hits. No second combat run — the same suite would not add a yaw sample, and two of the three allowed runs are still unused.

## 2026-10-14 16:01–17:39 IST — dual soak (`e34c364`)

`AGENT_MODEL=off`, one soak, exit 0, 5866 s. `SOAK DONE (clean)`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, difficulty peaceful). Supervisor still skipping llama-server. Anchors: normal [310, 131, 30], hard [138, 130, 21]. Deaths 0. No `No clear spot`. No second soak.

Times are seconds to the first sample that held the item. Wood/stone/food are the soak's end predicates (wooden pickaxe and table still in inventory; full stone kit plus a furnace; any edible food).

| Run | Wood | Stone pick | Furnace | Food peak | Eaten | Food points | Cooked | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 331 | 391 | 6 | 0 | 0 | 6 | 0 |
| normal2a2 | 120 | 301 | 421 | 8 | 0 | 0 | 8 | 0 |
| normal3a3 | 120 | 421 | 451 | 4 | 0 | 0 | 3 | 0 |
| hard1a1 | 180 | — | — | 0 | 0 | 0 | 0 | 0 |
| hard2a2 | pick at 150, end predicate no | 1233 | — | 0 | 0 | 0 | 0 | 0 |
| hard3a3 | 210 | 481 | 511 | 6 | 0 | 0 | 6 | 0 |

Totals: wood 5/6, stone 4/6, food 4/6. Median furnace at the end is 1. The cooked column is a real meal count (the old `_edible` key is gone). Eaten and food points are real zeros: the food bar stayed at 20 on every normal sample. hard3a3 ended at food 15 with 6 edible items and still eaten 0, stuck on `working: fight`.

### Night

Zero `[night]` lines in the dashboard for the whole soak. `tod_end` was `day` on all six runs. Hard runs are 1250 s from dawn, which is long enough to cross dusk, and none did. `apply_rules('dawn')` never sets `advance_time` back to true after the normal runs freeze it, so the clock stayed stopped. First night was not measured. The harness now sets and verifies `advance_time` and `advance_weather` on that branch. That change was not soaked again.

### Iron

Only normal2a2 reached the iron step. At 10:53:29Z it submitted `gather iron_ore` x6 with `targetY` 32. The job threw `Cannot read properties of undefined (reading 'name')` at `Worker.gather` (`worker.js` 1354) three times in 8 seconds, then `iron failed 3 times; exploring before retry`. The bot was still on the surface at [304, 159, 13] when the run ended. Ore 0, ingots 0, iron pickaxe 0. The empty-column index was undefined, and the catch logged `target.name` and replaced the real error, so the staircase never started. Gather now skips that column and an ore job above its `targetY` still digs down. Not remeasured. Unit tests after that change, every `tests/*.test.js` except `resources.test.js`: 222 passed, 0 failed. The smelt unit now holds a stone pickaxe for the pickup it asserts, and checks that a bare hand leaves the placed furnace in the world.

### Other

- hard1a1: one unstuck at the canopy spawn [138, 130, 21], then parked at [141, 130, 23] for the rest of the run with 0 cobble. The gather message is `Cannot reach or harvest this block`, over and over. Stone and food failed.
- hard2a2: same unstuck, then the same reach failure until it finally moved. Stone pickaxe and sword were in inventory at 1233 s. The table was gone by the end, so the wood predicate failed, and the furnace was never crafted, so stone failed. The run ended on `working: craft`.
- normal1a1: the operator returned the bot from below the anchor at [316, 112, 45] twice. It still finished wood, stone, and food. 0 deaths.
- normal3a3: autopilot went idle twice (resumed at t=541 and t=601) and still finished wood, stone, and food.
- Interventions 7, resumes 2, errors 0. Combat runs 2 and 3 were not used.

## 2026-10-14 18:17–18:34 IST — integration (`409f594`)

`git pull --rebase` was already at `409f594` (round 2, `bf26c2c`..`409f594`). Unit tests, every `tests/*.test.js` except `resources.test.js`: **250 passed, 0 failed**. Services restarted with `AGENT_MODEL=off`. Supervisor: `model server disabled`.

`python tests/integration.py` exit 1, 1053 s. Every leg through A3 passed: sleep, shelter, smelt, the melee zombie fight (`released=0 landed=0`, server confirmed the kill), and A1–A3.

A4 failed before the escape was measured: `A4 the lava trench is not in the world`. The server had just reported `Successfully filled 3 block(s)` after teleporting the bot to (1650, -60, 1648), and the water sweep in that box had removed 75 water blocks a second earlier. `execute if block 1650 -60 1648 minecraft:lava` never said the marker. The same cell reads as water now. At 13:04:32Z the dashboard logged `Reflex: Misc World Survival Chain engaging` and `Bucket-into-lava skipped: Douse interrupted: control changed hands`. The trench did not stay lava long enough to verify, so the escape hp was not measured.

## 2026-10-14 18:38–18:42 IST — combat run 1 of 3 (`82b1747`, code `409f594`)

`python tests/combat_integration.py`, model off, same services. Exit 0, 291 s. `All combat acceptance tests passed`. No second run: the arrow, the roofed damage, and the trio are already measured.

### Arrows

One shot in the whole suite. Roofed creeper, 13:10:18Z: `Combat: arrow creeper @0s: released (arrow entity 2319 at 3.03 b/t)`, inventory 32 → 31, then `@0.15s: landed (hurt event)`. Fight summary: `shots=1 released=1 landed=1`. No `unreleased`, no `missed`, no `PACKET_RATE` on that release. The skeleton leg never drew; it closed and melee'd (`approach=melee`).

### Creepers

`4_creeper` (lane, bot teleported to 1496, -60, 1518): the job completed at 13:10:00Z, 1.1 s, with no combat line at all. Recorded **repelled**, `damage_taken=0`, end health **20**, tactic not reported. No pillar, no wall, no shot. The creeper was still alive and the three dirt samples had no crater.

`4b_creeper_roofed`: the shot above, then `los-break` while the gap closed 9.6 → 2.8. **No pillar line.** Suite `damage_taken=17.1`, end health **3.89**. The fight summary still says `damage taken=0`; the new health-series number is the one that matches the hp lost. The creeper died. The suite printed `roofed creeper damage 17.1 >= 10` and still exited 0. Damage under 10 is not met.

The landed hurt event is a real hit, so this release was not a mirrored miss. After the shot the bot walked in to build the wall.

### Zombie trio

`2_zombie_x3`: ttk 22.6 s, hits 13, sweeps 10, `damage_taken=0`, end health 20, all three dead, tactic melee. Four `Combat: group-spacing zombie` lines between swings. No retreat.

## 2026-10-14 18:44–20:22 IST — dual soak (`e84fa05`, bot code `409f594`)

`AGENT_MODEL=off`, one soak, exit 0, 5862 s. `SOAK DONE (clean)`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, difficulty peaceful). Anchors: normal [310, 131, 30], hard [142, 131, 31]. Deaths 0, no death lines. Resumes 0. No `Autopilot stopped (Stop all)`. No second soak.

| Run | Wood | Stone pick | Furnace | Food peak | Eaten | Points | Cooked | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 331 | 361 | 1 | 0 | 0 | 0 | 0 |
| normal2a2 | 90 | 331 | 391 | 1 | 0 | 0 | 0 | 0 |
| normal3a3 | 90 | 331 | 391 | 6 | 0 | 0 | 6 | 0 |
| hard1a1 | 150 | — | — | 0 | 0 | 0 | 0 | 0 |
| hard2a2 | 150 | — | — | 0 | 0 | 0 | 0 | 0 |
| hard3a3 | 271 | 632 | — | 0 | 0 | 0 | 0 | 0 |

Totals: wood 6/6, stone 3/6, food 3/6. Every run ended with a crafting table still in the inventory (2, 2, 2, 2, 1, 1), so the wood predicate held. Eaten and food points are 0. Only normal3 cooked anything.

### Night

All three hard runs submitted `[night] {"type":"shelter"}` and the shelter completed: 13:58Z→14:08Z, 14:19Z→14:29Z, 14:41Z→14:51Z. No `[night]` sleep, and no `Sleeping` line. `tod_end` is `day` on all six because each hard run outlasted the night. hard1 spent that shelter stuck at [149, 132, 42] from t=632 to t=1233, then went back to stone gather with 22 cobble and no stone pickaxe.

### Iron

The iron step never started. No `[iron]` line, no ore, no ingots, no iron pickaxe. The three normal runs were still on food when the 600 s clock ended. The three hard runs never finished the stone kit.

### Stuck, table, idle

- Unreachable blocks are skipped in a burst now (`Gather: skipping stone at … (Cannot reach or harvest this block)` dozens of times in one second at 13:56Z and 14:14Z) instead of one column for the whole run. hard2 still finished with 0 cobble, backing off on stone. hard3 got a stone pickaxe and nothing else in the kit (`queued: gather` at the end).
- hard1 was unstuck four times, at [135, 129, 31], [139, 129, 34], [145, 126, 38], and [147, 130, 40].
- normal3's food explore went down to y=62 at [308, 62, 105] with health still 20, then climbed. No idle resumes.
- No deaths.

## 2026-10-14 21:22–21:40 IST — integration (`d4e3aac`)

`git pull --rebase` was already at `d4e3aac` (round 3, `669b652`..`d4e3aac`). Unit tests, every `tests/*.test.js` except `resources.test.js`: **270 passed, 0 failed**.

The first start failed: port 8765 was held by an orphaned `python -m http.server 8765` (pid 58972, parent already dead, not the agent). That pid was stopped, then `Start-Agent.ps1 -NoBrowser` with `AGENT_MODEL=off`. Supervisor: `model server disabled`.

`python tests/integration.py` exit 0, 1069 s. `All in-game integration tests passed`. A4: `escaped the lava trench (hp 18.8, at [1652, -59, 1650])`. No `Bucket-into-lava skipped` line on this run, and the suite printed no douse NOTE.

## 2026-10-14 21:41–21:46 IST — combat run 1 of 3 (`46a174b`, code `d4e3aac`)

`python tests/combat_integration.py`, model off, same services. Exit 0, about 5 min. `All combat acceptance tests passed`. No second run.

`4b_creeper_roofed`: `Combat: pillar-up 2 at 1496,-60,1497 (creeper at 7.8)`, perched 2 up, then two shots. `arrow creeper @0s: released` (entity at 3.01 b/t) and `@0.1s: landed (hurt event)`, then a second release at 3.03 b/t that also landed. Summary: `shots=2 released=2 landed=2`. Suite `damage_taken=0`, end health **20**, ttk 5.2 s, creeper killed, no crater. No `pillar step` line and no `los-break` on this leg. Damage under 10 is met.

`4_creeper` (lane) is unchanged: ttk 0.0, recorded repelled, damage 0, end health 20, no combat line. The cloud session left that case alone.

## 2026-10-14 21:46–23:36 IST — dual soak (`90c35d3`, bot code `d4e3aac`)

`AGENT_MODEL=off`, one soak, exit 0, 6617 s. `SOAK DONE (with errors)`. The clean copy was not promoted; the record is `data/soak-results-20261014-233621.json`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`). Anchors: normal [310, 131, 30], hard [141, 131, 30]. Three normal runs counted. hard3 was invalid three times (`timeOfDay=None`), so hard is 2 attempts and the second one lost the dashboard before the final read.

| Run | Wood | Stone pick | Furnace | Ore peak | Ingots peak | Iron pick | Cooked | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 301 | 361 | 30 | 1 | 812 | 9 | 0 |
| normal2a2 | 150 | 301 | 361 | 0 | 0 | — | 3 | 0 |
| normal3a3 | 90 | 301 | 361 | 0 | 0 | — | 2 | 1 |
| hard1a1 | 60, empty at the end | cobble at 150, no pick | — | 0 | 0 | — | 0 | 2 |
| hard2a2 | 90, final read failed | cobble at 241, no pick | — | 0 | 0 | — | — | suffocated; counter unread |

`iron_runs` 1. Eaten and food points are 0 on every counted run. normal1's stone predicate is no because the furnace was out of the inventory at the bell (it was smelting); the stone kit and the iron pickaxe were held. normal3's stone predicate is no because the death emptied the inventory.

### Iron

Only normal1 reached it. `[iron] gather iron_ore` x6 at 16:29Z, then coal, smelt 6, craft iron pickaxe at 16:32Z (sample t=812), iron sword, shield, then `gather iron_ore` x30. It ended `working: smelt` with 30 raw iron still in the furnace and 0 ingots in the inventory. normal2 was still backing off on food. normal3 died before any ore.

### Hard stone

The dig-down fired. `Gather: No exposed stone within reach; digging down to y=130` and again to y=125 on hard1, and to y=123 on hard2. Neither run crafted a stone pickaxe or a furnace. hard1 suffocated in a wall at [149, 129, 36] at 17:30Z, respawned at [89, 76, -22], and the operator returned it. A normal-anchor dig-down at 16:42Z stopped in 2 s: `Tunnel needs a suitable tool in the inventory for snow_block`. That run still got its stone pickaxe at 301 s.

### Night

No `[bed-prep]` line and no `[night] sleep`. Two shelters: 17:30Z (hard1, after the suffocation) and 17:51Z (hard2). `tod_end` was day on the runs that could still be read.

### Deaths

- normal3, 17:14Z, [355, 41, 81]: `shot by Skeleton`. The operator resumed the ladder. The stone kit was gone afterward.
- hard1, 17:30Z, [149, 129, 36]: `suffocated in a wall`, during the dig-down, right after `Autopilot stopped (Stop all)`.
- hard1, 17:39Z, [143, 128, 31]: `slain by Zombie`.
- hard2, 17:46Z, [140, 129, 34]: `suffocated in a wall`, again right after `Stop all`. The run record never stored it; the dashboard connection was already failing.
- 17:58Z the server kicked the bot: `You are sending too many packets!` After that every sample is `connection refused`, and hard3 could not confirm dawn.

`Stop all` also fired twice on normal2 (16:48Z and 16:53Z). The soak resumed an idle autopilot at t=541 and t=872. No second soak.

## 2026-10-15 00:18–00:36 IST — integration (`b5c7c7b`)

`git pull --rebase` was already at `b5c7c7b`. Unit tests (`tests/*.test.js` except `resources.test.js`): **313 passed, 0 failed** (the cloud note said 304; nothing failed). Services restarted with `AGENT_MODEL=off`. Supervisor: `model server disabled`.

`python tests/integration.py`, exit 0, 1074 s. `All in-game integration tests passed`. A4: escaped the lava trench at 18.8 hp, at [1648, -59, 1648].

## 2026-10-15 00:37–00:42 IST — combat run 1 (`6dd5421`, bot code `b5c7c7b`)

`python tests/combat_integration.py`, model off, same services. Exit 0, 303 s. `All combat acceptance tests passed`. No second run.

`4b_creeper_roofed`: two ground shots first (`arrow creeper` released at 3.01 and 2.98 b/t, both landed), then `Combat: pillar-up 2 at 1496,-60,1497 (creeper at 7.9)`, perched 2 up, and a third shot that landed. Summary: `shots=3 released=3 landed=3`. Suite `damage_taken=0`, end health 20, ttk 6.2 s, creeper killed, no crater. No `pillar step` line and no `los-break` on this leg.

`4_creeper` (lane) is still the known gap: ttk 0.0, recorded repelled, damage 0, end health 20, no combat line. The cloud session left that case alone.

## 2026-10-15 00:42–02:58 IST — dual soak (`34dc5d4`, bot code `b5c7c7b`)

`AGENT_MODEL=off`, one soak, exit 0, 8117 s. `SOAK DONE (with errors)`. The clean copy was not promoted; the record is `data/soak-results-20261015-025757.json`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, peaceful). Model stayed off. Anchors: hard [142, 131, 31], normal [310, 131, 30].

| Run | Wood | Stone pick | Furnace | Ore | Ingots peak | Iron pick | Cooked | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 331 | 361 | 30 | 1 | 722 | 8 | 0 |
| normal2a2 | 90 | 271 | 301 | 30 | 6 | 662 | 8 | 0 |
| normal3a3 | 90 | 301 | 331 | 27 | 1 | 782 | 10 | 0 |
| hard1a1 | 240 | 541, gone at the end | never | 0 | 0 | — | 0 | 1 |
| hard2a2 | 90 | 631, still held | never | 0 | 0 | — | 0 | 0 |
| hard3a3 | never | never | never | 0 | 0 | — | 0 | 2 skeleton shots; the run line says 0 |

`iron_runs` 3, `stone_runs` 1 (only normal3 still held a furnace at the bell). Eaten and food points are 0 on every run. normal1 and normal2 fail the stone predicate because the furnace was out of the inventory while smelting. The operator returned normal1 from [319, 122, 34].

### Iron

All three normal runs crafted an iron pickaxe (722 s, 662 s, 782 s) and an iron sword. normal1 and normal2 were still smelting 30 raw iron at the bell. The job then logged `Smelt ended early: took 18 iron_ingot` (normal1, 19:36Z) and `took 17 iron_ingot` (normal2, 19:56Z). The soak's end inventory still reads 0 ingots and 30 raw iron on both. normal3 never started that long smelt; at the bell it was still gathering, with 0 ingots and 27 raw iron held.

### Hard stone

Dig-downs fired (y=125, 129, 123, 116) and none suffocated. No `snow_block` tool stop. hard1's pickaxe job started at 20:22Z, about 541 s, then sword, axe and shovel by 20:26Z. No furnace job followed, and the skeleton death emptied the kit, so the end count is 0 cobble and 0 stone tools. hard2 crafted only the pickaxe (20:48Z, 631 s) and ended holding it plus 24 cobble, with no sword, axe, shovel or furnace. On the normal runs the pickaxe job landed once cobble was already in the 20s (normal1 still had 29 cobble and no pickaxe at t=301), not within seconds of the first 3.

### Night and food

No `[bed-prep]` and no sleep. Shelters at 20:27Z (hard1), 20:48Z (hard2), and 21:09Z, 21:11Z, 21:14Z (hard3). Food explores do carry `surfaceFloor`. One dropped it to 92. No `taking cover` line and no `Navigation left the surface` line. Cooked food was 8, 8 and 10 on the normal runs and was never eaten.

### Deaths, stops, packets

No `suffocated in a wall`. No `Autopilot stopped (Stop all)`. No `PACKET_BUDGET` line and no packet kick.

- hard1, 20:36Z: `shot by Skeleton`. Four unstucks before that, all within a few blocks of the anchor. The operator resumed the ladder.
- hard3 stood on the anchor backing off wood for about 10 minutes with an empty inventory, then died twice: `shot by Skeleton` at 21:11Z and again at 21:14Z. Between them it was `working: shelter` at 8.3 hp and did not eat. The second shelter was still running at 0.3 hp. The final dashboard read timed out, so the run line records deaths=0 and two errors, and that is why the clean copy was not promoted. The death causes and the samples both have the two shots.

No second soak.

## 2026-10-15 00:42–02:58 IST — dual soak (bot code `b5c7c7b`), written up by Claude
Cursor launched this soak and ended its turn before it finished, so Claude read the results (`data/soak-results-20261015-025757.json`, `logs/dashboard.log`, `logs/test-server.log`). Model off, 0 invalid attempts; errors: one sample and the final read timed out (the bot timed out at 02:46 server time).

| Run | Wooden pick | Stone pick | Furnace | Iron ore peak | Ingots peak | Iron pick | Cooked | Deaths (soak count) |
|---|---|---|---|---|---|---|---|---|
| normal1 | 90 | 331 | 361 | 30 | 1 | **722** | 8 | 0 |
| normal2 | 90 | 271 | 301 | 30 | 6 | **662** | 8 | 0 |
| normal3 | 90 | 301 | 331 | 27 | 1 | **782** | 10 | 0 |
| hard1 | 240 | 541 | - | 0 | 0 | - | 0 | 1 |
| hard2 | 90 | 631 | - | 0 | 0 | - | 0 | 0 |
| hard3 | (sampling timed out) | - | - | 0 | 0 | - | - | 0 |

- **Iron pickaxe 3/3 normal runs (11-13 min).** Smelting now returns ingots to the inventory (`Smelt ended early: took 18 iron_ingot ...`, `took 17 ...`).
- Round-4 targets: **no suffocation, no `Autopilot stopped (Stop all)`, no `PACKET_BUDGET` line and no packet kick** in this soak. The only earlier kick (23:28 server time) was round 3.
- Hard: stone pickaxe in hard1/hard2 (541 s, 631 s; `achieved` also shows one for hard3), **no furnace in any hard run**.
- **Deaths at night in the dark forest** (server log): shot by Skeleton 02:06 (145,127,34, during `shelter`), 02:41 (130,125,24, during gather after a flee), 02:44 (104,141,-39, during `shelter`), **drowned** 02:46, then the bot timed out. The soak counter recorded only 1. The dashboard shows `Reflex: fleeing` dozens of hostiles at once and `Pause trace: shelter -> Reflex: preempted by Mob Defense` - Mob Defense pulled the bot out of its shelter job, then it was shot.
- Lane creeper test still "repelled" with no combat (known gap).

## 2026-10-15 04:58–05:15 IST — integration (`16f3609`)

`git pull --rebase` was already at `16f3609`. Unit tests (`tests/*.test.js` except `resources.test.js`): **352 passed, 0 failed** (the cloud note said 343; nothing failed). Services restarted with `AGENT_MODEL=off`. Supervisor: `model server disabled`.

`python tests/integration.py` exited 1 after 983 s, before phase 7A. Everything up to the drowning surface passed, including `reflex surfaced the drowning bot` (`WorldSurvival: drowning (air 6), swimming up` at 23:44:28Z). The next check never saw a paused gather. The oak log was placed 20 blocks out so the walk would still be going when a NoAI creeper spawned; `Completed gather` landed at 23:44:45Z, about 15 s after the teleport back to the origin, and the job message never started with `Reflex:`. No creeper flee line after that. The 30 s wait raised `TimeoutError: Condition did not become true` at `tests/integration.py:588`. A4 did not run.

## 2026-10-15 05:16–05:22 IST — combat run 1 (`d580306`, bot code `16f3609`)

`python tests/combat_integration.py`, model off, same services. Exit 1, 315 s. One error: `test4_creeper: TimeoutError`. The rest of the suite still ran. No second run.

`4_creeper` (lane, bot 1499,-60,1518, creeper 1499,-60,1508, open lane confirmed): real engagement. `Combat: pillar-up 2 at 1499,-60,1518 (creeper at 7.1)`, then `pillar-hold`. No perch, no `arrow creeper`, no release. Summary: `shots=0 released=0 landed=0`, ttk 4.1 s, hits 0, `damage_taken=0`. The server confirmed the creeper was defeated and the glowstone under the spawn (z=1508) was intact. The next check, glowstone at the lane midpoint (1499, -61, 1513), timed out, so that cell was not glowstone. That is the suite failure.

`4b_creeper_roofed`: `pillar-up 2 at 1496,-60,1497 (creeper at 7.8)`, perched 2 up, two arrows released at 3.01 b/t and both landed. `shots=2 released=2 landed=2`, ttk 5.2 s, `damage_taken=0`, end health 20, killed, no crater.

## 2026-10-15 05:23–07:31 IST — dual soak (`22ae54f`, bot code `16f3609`)

`AGENT_MODEL=off`, one soak, exit 0, 7694 s. `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, peaceful). Model stayed off. Anchors: hard [141, 131, 32], normal [310, 131, 30].

| Run | Wood | Stone pick | Furnace | Ore | Ingots peak | Iron pick | Cooked | Eaten | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 271 | 301 | 30 | 6 | 752, gone at the end | 8 | 0 | 0 |
| normal2a2 | 90 | 211 | 241 | 30 | 30 | 602 | 8 | 0 | 0 |
| normal3a3 | 120 | 331 | 331 | 0 | 0 | — | 7 | 0 | 0 |
| hard1a1 | 361 | 511 | never | 0 | 0 | — | 0 | 0 | 0 |
| hard2a2 | 150 | 421 | 451 | 0 | 0 | — | 0 | 0 | 0 |
| hard3a3 | 180 | 361 | 391 | 0 | 0 | — | 0 | 0 | 0 |

`iron_runs` 2, `stone_runs` 4. Food points are 0 on every run. normal2 ended holding the iron pickaxe and 30 ingots. normal1's end inventory was 0 ingots, 30 raw iron, and no iron pickaxe. normal1 fails the stone predicate because the furnace was out of the inventory while smelting.

### Night

No `Could not seal` line and no night-pillar line. No `sunset - finishing the stone kit` line.

- hard1, 01:07Z: `[bed-prep] hunt sheep`, then `[night] shelter` 20 s later. The shelter was cancelled at 01:18Z (`Current job cancelled`) with no `Shelter: sealed`. The run ended holding a stone pickaxe and 19 cobble, and no furnace.
- hard2, 01:28Z: shelter, cancelled at 01:39Z, again with no sealed line. The furnace had already been crafted at 01:26Z and was still held at the bell.
- hard3, 01:50Z: shelter, `Shelter: sealed at (142, 122, 50) (19 blocks placed)` three seconds later, completed at 02:00Z. From t=812 the samples sit on that cell at 20 hp with `queued: fight` for the rest of the night.

The Mob Defense bursts at 01:47–01:49Z preempted fight and collect jobs, not a shelter. One flee line lists a crowd of endermen, creepers, skeletons and zombies. No `Pause trace: shelter -> Reflex: preempted by Mob Defense`.

### Deaths and the counter

Every run's `death_sources` is counter 0, window 0, log 0, and `death_log` is empty. The dashboard has no death line in this window. The three sources agree, and they agree with the dashboard.

### Food, loops, connections

Cooked food was held on the normal runs (8, 8, 7) and never eaten. The hard runs held none. No `LOOP_SLOW` and no `LOOP_STALL`. The only connection lines are the soak's own restart: `ECONNREFUSED 127.0.0.1:25569` at 23:53Z while the soak world was coming up, and `Server closed` at 02:01Z when the flat world was restored. No mid-run timeout of the bot connection. Two navigation failures did print: `No path to the goal!` at 01:05Z and `Navigation timed out` at (144, 124, 53) at 01:45Z, both while climbing out of a tunnel.

No second soak.

## 2026-10-15 11:55–12:12 IST — integration (`02c8eb6`)

`git pull --rebase` was already at `02c8eb6`. Unit tests (`tests/*.test.js` except `resources.test.js`): **375 passed, 0 failed** (the cloud note said 366; nothing failed). Services restarted with `AGENT_MODEL=off`. Supervisor: `model server disabled`.

`python tests/integration.py`, exit 0, 1059 s. `All in-game integration tests passed`. The reworked reflex-pause fixture paused the gather: `Reflex: preempted by Mob Defense`, and the gather then resumed and completed. A4 escaped the lava trench at 18.8 hp, at [1654, -60, 1652].

## 2026-10-15 12:13–12:18 IST — combat run 1 (`88672a1`, bot code `02c8eb6`)

`python tests/combat_integration.py`, model off, same services. Exit 0, 316 s. `All combat acceptance tests passed`. No second run.

`4_creeper` (lane): `pillar-up 2 at 1499,-60,1518 (creeper at 7.3)`, perched, then `perch 2 up is inside the fuse ring; knocking the creeper back (at 3.6)`. Three `pillar-strike` lines followed. No arrow was released. Suite: ttk 7.3 s, hits 5, `damage_taken=0`, end health 20, killed. Glowstone held at the spawn, the midpoint, and the bot start.

`4b_creeper_roofed`: `pillar-up 2 at 1496,-60,1497 (creeper at 8.0)`, two arrows released (2.96 and 3.02 b/t) and both landed, then the same knockback line at 3.7 and one strike. `shots=2 released=2 landed=2`, ttk 7.3 s, hits 3, `damage_taken=0`, end health 20, killed, no crater.

## 2026-10-15 12:18–14:26 IST — dual soak (`309f1eb`, bot code `02c8eb6`)

`AGENT_MODEL=off`, one soak, exit 0, 7667 s. `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, peaceful). Model stayed off. Anchors: hard [142, 131, 31], normal [310, 131, 30].

| Run | Wood | Stone pick | Furnace | Iron pick | Ingots peak | Bar | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 331 | 391 | 692, still held | 6 | 20..20 never hungry | 0 |
| normal2a2 | 120 | 211 | 271 | — | 0 | 5..20 EAT FAILED | 0 |
| normal3a3 | 90 | 150 | 271 | — | 0 | 15..20 EAT FAILED | 0 |
| hard1a1 | 180 | never | never | — | 0 | 20..20 never hungry | 0 |
| hard2a2 | 150, gone at the end | 361, gone | 391, gone | — | 0 | 17..20 EAT FAILED | 1 |
| hard3a3 | 542, gone at the end | never | never | — | 0 | 17..20 never hungry | 1 |

`iron_runs` 1. normal1 ended holding the iron pickaxe, an iron sword, 30 raw iron and 0 ingots. The furnace was out of the inventory, so the stone predicate is no. The operator returned normal1 from y=122 and normal3 from y=19.

### Night

No `Short of shelter blocks` line.

- hard1, 08:02Z: `[night] shelter`, sealed 36 s later at (144, 129, 33) with 2 blocks. No pillar.
- hard2, 08:24Z: `Could not seal the shelter: 2 open cells, first at 158,154,-8; night pillar instead`, then `Reflex: no shelter tonight; night pillar until morning`. It perched 3 up four times and was `knocked off the pillar` each time. A spider killed it at 08:28Z. The respawn shelter sealed 45 s later at (87, 130, -38), 20 blocks.
- hard3, 08:45Z: sealed in 8 s at (132, 125, 38), 16 blocks. No pillar. A skeleton shot it at 08:56Z during a gather, at (135, 125, 36).

### Food

- normal1: `bar 20..20: never hungry (food min 20)`.
- normal2: `bar 5..20: EAT FAILED (due 1, failed 0, food min 5)`. Cooked 0. The due count rose and `failed` stayed 0, so there is no reason string.
- normal3: `bar 15..20: EAT FAILED (due 3, failed 4, Promise timed out., food min 15)`. Cooked 4, eaten 0.
- hard1: `bar 20..20: never hungry`.
- hard2: `bar 17..20: EAT FAILED (due 1, failed 0, food min 17)`.
- hard3: `bar 17..20: never hungry (food min 17)`.

### Tools and iron

A stone pickaxe broke at 07:06Z (`1 uses left, broke`) during normal1, and another at 07:46Z during normal3. A wooden pickaxe broke at 07:48Z. The iron pickaxe did not break. It was logged leaving once at 250 uses, at the same instant as the first stone-pick break, and again at the run-end clear with 147 uses left. normal1's end inventory still held it. No other run crafted one.

### Hard furnace

No `sunset - finishing the stone kit` or `dusk - finishing` line. hard2 crafted a furnace at 08:20Z (391 s) and the spider death emptied it before the bell. hard1 and hard3 never sent a furnace craft. hard1's dusk job was `gather grass_block x25`. hard3's was the same, at 08:44Z, a minute before its shelter.

### Deaths

The counter matches the server log on both deaths. hard2: counter 1, log 1, window 0, `slain by Spider` at (129, 138, -2), job none. hard3: counter 1, window 1, log 1, `shot by Skeleton` at (135, 125, 36) during a gather. The other four runs are 0 on all three sources.

No second soak.

## 2026-10-15 15:14–15:34 IST — integration (`2ea2321`)

`git pull --rebase` was already at `2ea2321`. Unit tests (`tests/*.test.js` except `resources.test.js`): **401 passed, 0 failed** (the cloud note said 392; nothing failed). Services restarted with `AGENT_MODEL=off`. Supervisor: `model server disabled`.

`python tests/integration.py`, exit 0, 1186 s. `All in-game integration tests passed`. The reflex-pause gather paused (`Reflex: preempted by Mob Defense`) and then completed. A4 escaped the lava trench at 18.8 hp, at [1650, -60, 1648].

## 2026-10-15 15:34–15:40 IST — combat run 1 (`474bdf4`, bot code `2ea2321`)

`python tests/combat_integration.py`, model off, same services. Exit 0, 312 s. `All combat acceptance tests passed`. No second run.

`4_creeper` (lane): ttk 7.4 s, hits 5, `damage_taken=0`, end health 20, killed, no crater at the spawn, the midpoint, or the bot start.

`4b_creeper_roofed`: ttk 7.4 s, hits 3, `damage_taken=0`, end health 20, killed, no crater. Both creepers stayed at 0 damage.

## 2026-10-15 15:40–17:49 IST — dual soak (`03edc95`, bot code `2ea2321`)

`AGENT_MODEL=off`, one soak, exit 0, 7712 s. `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, peaceful). Model stayed off. Anchors: hard [142, 131, 31], normal [310, 131, 30].

| Run | Stone pick | Furnace | Iron pick | Ore / ingots peak | End raw / ingots | Bar | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 241 | 301, held | 903, held | 3 / 1 | 0 / 0 | 14..20 EAT FAILED | 0 |
| normal2a2 | 181 | 241, gone at the bell | 1204, held | 2 / 5 | 1 / 0 | 15..20 EAT FAILED | 0 |
| normal3a3 | 241 | 331, gone at the bell | 993, held | 3 / 1 | 3 / 0 | 16..20 EAT FAILED | 0 |
| hard1a1 | 211 | 331, held | — | 0 / 0 | 0 / 0 | 20..20 never hungry | 0 |
| hard2a2 | 602 | 602, held | — | 0 / 0 | 0 / 0 | 20..20 never hungry | 0 |
| hard3a3 | 331, gone | never | — | 0 / 0 | 0 / 0 | 20..20 never hungry | 1 |

`iron_runs` 3. All three iron pickaxes were still held at the bell, with an iron sword. Eaten is 0 on every run.

### Food

The bot did not eat. All three normal runs held cooked food (9, 10, 8) and printed `EAT FAILED` with `failed 0` and no reason: `bar 14..20: EAT FAILED (due 1, failed 0, food min 14)`, `bar 15..20: EAT FAILED (due 2, failed 0, food min 15)`, `bar 16..20: EAT FAILED (due 1, failed 0, food min 16)`. `food_no_food` is 0. The hard runs were `never hungry (food min 20)`.

### Night

No `Could not seal`, no night pillar, no overhang ring, and no `knocked off`.

- hard1, 11:25Z: sealed in 6 s at (142, 124, 30), 11 blocks. `Shelter: dawn (tod 9); staying sealed`, then `Shelter: morning (tod 1029, nearest hostile 16.0); opening up` at 11:35Z. It stayed in until morning.
- hard2, 11:46Z: sealed in 11 s at (150, 134, 25), 17 blocks. Dawn hold at tod 4, opened at tod 1004 (nearest hostile 16.2). It stayed in until morning.
- hard3 died before its sunset shelter. After the respawn it sealed in 30 s at (89, 128, -33), 8 blocks, and the dawn line at 12:17Z (tod 16) was still holding when the bell ended the run. No morning opening on that run.

### Deaths

One death, and the counter matches. hard3, 12:05Z, (138, 123, 39): `blown up by Creeper`, during a craft. counter 1, window 1, log 1. The death log's killer field is empty; the cause string names the creeper. The other five runs are 0 on all three sources.

### Hard kit

hard1's furnace craft was at 11:20Z (331 s), after the pickaxe at 211 s, and both were held at the bell. hard2 logged `dusk - cobble for the stone kit first (3)` at 11:44Z, then `dusk - finishing the stone kit first` through the pickaxe, sword, axe and shovel, and `sunset - finishing the stone kit first (furnace)` at 11:46:21Z, ten seconds before the shelter. Both were held. hard3 crafted the pickaxe at 331 s and never a furnace; the creeper wiped the kit.

### Iron and stone pickaxes

Each normal run placed a kiln: `Gather: kiln at 200,150,44` (normal1, loaded 3), `kiln at 185,126,-115` (normal2, then `loaded with 2 raw_iron (3 ingots taken so far)`), and two kilns on normal3 (`132,139,-48` and `117,128,-56`). The end inventories still show 0 ingots. normal1 had smelted everything it held (0 raw). normal2 had 1 raw left, normal3 had 3.

Two stone pickaxes broke and were replaced: `1 uses left, broke` at 10:31Z, recrafted at 10:31:54Z (normal1, during the kiln), and again at 10:41Z, recrafted at 10:42Z (normal2). The other `Tool left the inventory: stone_pickaxe` lines still had uses left. No iron pickaxe break.

No second soak.

## 2026-10-15 18:25–18:43 IST — integration (`72e5329`)

`git pull --rebase` was already at `72e5329`. Unit tests (`tests/*.test.js` except `resources.test.js`): **423 passed, 0 failed** (the cloud note said 414; nothing failed). Services restarted with `AGENT_MODEL=off`. Supervisor: `model server disabled`.

`python tests/integration.py`, exit 0, 1062 s. `All in-game integration tests passed`. The reflex-pause gather paused (`Reflex: preempted by Mob Defense`) and then completed. A4 escaped the lava trench at 18.8 hp, at [1656, -59, 1654].

## 2026-10-15 18:43–18:49 IST — combat run 1 (`fa1b212`, bot code `72e5329`)

`python tests/combat_integration.py`, model off, same services. Exit 0, 312 s. `All combat acceptance tests passed`. No second run.

`4_creeper` (lane): ttk 7.2 s, hits 5, `damage_taken=0`, end health 20, killed, no crater at the spawn, the midpoint, or the bot start.

`4b_creeper_roofed`: ttk 8.4 s, hits 4, `damage_taken=0`, end health 20, killed, no crater. Both creepers stayed at 0 damage.

## 2026-10-15 18:49–20:57 IST — dual soak (`ab6c239`, bot code `72e5329`)

`AGENT_MODEL=off`, one soak, exit 0, 7672 s. `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, peaceful). Model stayed off. Anchors: hard [142, 131, 31], normal [310, 131, 30]. No iron pickaxe, no torches, no worn armour, no bed, and no diamond step on any run. Deaths are 0 on every run, and counter, window, and log all agree.

| Run | Food verdict | Iron pick | Torches | Armour worn | Bed | Diamonds | Night |
| --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | `bar 16..20: EAT FAILED: never attempted (due 2, failed 0, food min 16)` | — | 0 | 0 | — | 0 | day at the bell |
| normal2a2 | `bar 5..20: no food held (food min 5)` | — | 0 | 0 | — | 0 | day |
| normal3a3 | `bar 6..20: no food held (food min 6)` | — | 0 | 0 | — | 0 | day |
| hard1a1 | `bar 20..20: not hungry enough (food min 20)` | — | 0 | 0 | — | 0 | shelter, stayed sealed |
| hard2a2 | `bar 20..20: not hungry enough (food min 20)` | — | 0 | 0 | — | 0 | pillar, perched at the bell |
| hard3a3 | `bar 20..20: not hungry enough (food min 20)` | — | 0 | 0 | — | 0 | shelter, still sealed at the bell |

Stone pickaxes: normal1 211 s, normal2 180 s, normal3 271 s, hard1 391 s, hard3 180 s. hard2 never made one. Furnaces: normal1 301 s, normal2 271 s, hard1 482 s, hard3 542 s. normal3 and hard2 never made one. Eaten is 0 on every run.

### Food

The bot did not eat at a bar of 14. The sampled bar on normal1 never went below 16, and the verdict says the two due meals were never attempted. The dashboard did log `Food: ate cooked_porkchop (bar 20)` twice, at 13:33Z and 13:38Z, while the bar the soak recorded was already 16–20. normal2 and normal3 dropped to 5 and 6 with nothing held. No `Food: meal failed` line and no deferred reason in the log.

### Creepers and crafts

No creeper interrupted a craft. No `blown up by Creeper`, no `Runner: closed the open crafting window`, and no `Reflex: creeper ... overrides`. One craft, at 15:12Z, was paused by the world-survival chain, not by Mob Defense.

### Night

No bed and no `[night] sleep`.

- hard1, 14:33Z: a night pillar started, then the shelter sealed 16 s later at (132, 144, -4), 22 blocks. `Shelter: dawn (tod 15); staying sealed` at 14:43Z, which is the end of the run. No morning opening.
- hard2 never gathered a log. At 14:55Z: `Short of shelter blocks: 10 held, 14 needed at (140, 128, 31); night pillar instead`. The pillar then failed `timed out at 0/3` about every 3 s until 15:04Z, when it perched and placed `overhang ring 8/8`. The run ended on that perch. It did not reach morning.
- hard3, 15:16Z: sealed in 9 s at (134, 124, 31), 11 blocks. Dawn hold at 15:26Z (tod 2) was still up when the bell ended the run.

No second soak.

## 2026-10-15 21:26–21:44 IST — integration (`649790b`)

`git pull --rebase` already at `649790b`. Unit tests: 438 passed, 0 failed (`--test-skip-pattern resources`, 40.9 s). The cloud note expected 429/429; nothing failed. Services restarted with `AGENT_MODEL=off`. Supervisor log: `model server disabled`.

`python -u tests/integration.py`, model off. Exit 0, 1068 s. `All in-game integration tests passed`.

`Reflex paused the gather: Reflex: preempted by Mob Defense`. `PASS: A4 escaped the lava trench (hp 19.8, at [1652, -59, 1650])`. Eat at health 9 raised food from 2 to 14. Sleep used the bed until morning.

## 2026-10-15 21:45–21:50 IST — combat (`b705b8f`, bot code `649790b`)

`python -u tests/combat_integration.py`, model off, same services. Exit 0, 306 s. `All combat acceptance tests passed`. No second run.

`4_creeper` (lane): ttk 7.4 s, hits 5, `damage_taken=0`, end health 20, killed, no crater at the spawn, the midpoint, or the bot start.

`4b_creeper_roofed`: ttk 5.2 s, hits 2, `damage_taken=0`, end health 20, killed, no crater. Both creepers stayed at 0 damage.

## 2026-10-15 21:50 – 2026-10-16 00:58 IST — dual soak (`b25ab08`, bot code `649790b`)

`AGENT_MODEL=off`, one soak, exit 0, 11287 s. `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, peaceful). Model stayed off. Anchors: hard [143, 132, 31], normal [310, 131, 30]. No second soak.

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 181 | 271 | 451 | 19 | 4 at 632 | — | 0 | ate 4 | 0 |
| normal2a2 | 90 | 150 | 241 | 361 | 16 | 2 at 602 | — | 0 | ate 1 | 1 |
| normal3a3 | 90 | 211 | 301 | 512 | 16 | 2 at 782 | — | 0 | ate 2 | 0 |
| hard1a1 | 543 | — | — | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard2a2 | 121 | 362 | 483 | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard3a3 | 241 | 301 | — | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |

Times are seconds from each run start. Diamond pick never. No bed on any run.

### Food

Meals are counted now. Verdicts are `ate 4`, `ate 1`, and `ate 2`, and `eaten` matches (4 / 1 / 2). The log form is `Food: ate cooked_mutton (bar A -> B)`.

Four of the seven meals started at bar 14. Three started above 14:

- normal1, 16:48Z: a `Health or food is low` pause, then `bar 17 -> 20` and, 13 s later, `bar 19 -> 20`. The second bite is a fill-up after the first meal.
- normal3, 18:02Z and 18:04Z: `bar 16 -> 20` while the diamond staircase was dropping the bot (sampled hp 18.4, then 12.4, then 3.5). The operator returned it from y=20.

The food step did not hold the ladder for a whole run. All three normal runs reached an iron pickaxe. It was set aside twice: normal2 at 17:08Z (`failed 3 times`) and normal3 at 17:50Z (`6 explore legs without food`). No `food failed 3 times; exploring before retry`.

### Iron, armour, diamonds

normal1 wore the full iron set (helmet, chestplate, leggings, boots) by 632 s and entered `diamond-rung` at 812 s. Diamonds stayed 0. normal2 and normal3 wore helmet and chestplate only (2). normal3 also entered `diamond-rung` (targetY -58) at about 993 s, then the operator pulled it back from y=20. No `Tunnel stopped: lava`.

### Night

No bed and no `[night] sleep`. No `sealing a 1x1 pod` and no night-pillar timeout loop.

- hard1 got wood only at 543 s, after `searching further afield` (5 columns / 24 blocks, then only refused logs). Sealed at 18:34Z at (154, 136, 30), 22 blocks. Dawn hold at 18:44Z (tod 16); opened at 18:45Z (tod 1016, hostile 18.2 away).
- hard2 got wood at 121 s. Sealed at 18:56Z at (186, 152, 54), 22 blocks. Dawn hold at 19:05Z (tod 12) was still up when the run ended. No morning opening line.
- hard3 searched further afield, then sealed at 19:17Z at (83, 117, -98), 25 blocks, and stayed there. Dawn hold at 19:27Z (tod 12); opened at 19:27Z (tod 1012) as the bell ended the run.

### Deaths

One death. normal2, 17:24Z: `BuilderBot fell from a high place` at (444, 13, 10). The iron pickaxe left the inventory with 103 uses left, along with the wooden and stone tools and the iron sword. The soak counter is 1, and that is the only death line in the window. The bot respawned and the run ended still holding an iron pickaxe.

## 2026-10-16 04:32–04:50 IST — integration (`3f4db59`, bot code `ad5f0a0`)

`git pull --rebase` landed on `3f4db59`, which only strips machine-specific paths from docs and `bootstrap.py`. Bot source is still the round-10 tip `ad5f0a0`. Unit tests, run on that bot code before the pause: 509 passed, 0 failed (`--test-skip-pattern resources`, 41.3 s). The cloud note expected 500/500; nothing failed. An earlier integration attempt was stopped mid-suite while the machine was in use and is not a result. Services were down when testing resumed; `Start-Agent.ps1 -NoBrowser` with `AGENT_MODEL=off`. Supervisor log: `model server disabled`.

`python -u tests/integration.py`, model off. Exit 0, 1081 s. `All in-game integration tests passed`.

`Reflex paused the gather: Reflex: preempted by Mob Defense`. `PASS: A4 escaped the lava trench (hp 18.8, at [1648, -60, 1648])`.

## 2026-10-16 04:51–04:56 IST — combat (`1f81a24`, bot code `ad5f0a0`)

`python -u tests/combat_integration.py`, model off, same services. Exit 0, 306 s. `All combat acceptance tests passed`. No second run.

`4_creeper` (lane): ttk 7.3 s, hits 5, `damage_taken=0`, end health 20, killed, no crater at the spawn, the midpoint, or the bot start.

`4b_creeper_roofed`: ttk 5.3 s, hits 2, `damage_taken=0`, end health 20, killed, no crater. Both creepers stayed at 0 damage.

## 2026-10-16 04:56–08:04 IST — dual soak (`d888731`, bot code `ad5f0a0`)

`AGENT_MODEL=off`, one soak, exit 0, 11271 s. `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, peaceful). Model stayed off. Anchors: hard [141, 131, 30], normal [310, 131, 30]. No second soak. Deaths are 0 on every run. No `fell from a high place` in the soak window.

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 211 | 301 | 421 | 16 | 2 at 692 | — | 1 | not hungry (bar 20) | 0 |
| normal2a2 | 120 | 180 | 271 | 391 | 16 | 0 | — | 0 | not hungry (bar 20) | 0 |
| normal3a3 | 90 | 181 | 271 | 692 | 16 | 2 at 1023 | — | 0 | ate 1 | 0 |
| hard1a1 | 150 | 271 | 391 | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard2a2 | — | — | — | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard3a3 | 301 | 421 | 481 | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |

Diamond pick never. No bed on any run. The one meal is `Food: ate cooked_beef (bar 14 -> 20)` at 01:14Z. No meal started above bar 14.

### Descent (A)

The drop guard fired, and the bot still fell through one step. normal1, 23:47Z: `Gather: descent stopped at y=49 (Tunnel stopped: dropped to y=49 below the step at (359, 50, 64))`. It then turned at cave openings (`Tunnel: cave opening under 359,39,52`, then `415,-16,53`) and stopped again at 23:53Z: `descent stopped at y=-16` after three openings with `no safe way on`. It never reached y=-53. End inventory still had `diamond: 1`. There is no `Tunnel: mined diamond_ore`, no `Digging a branch mine`, and no `filled a hole`.

normal3, 01:16Z: diamond-rung (`targetY -53`, `strip:true`) stopped at `y=84` after three cave openings under (352, 83, -156) and the two neighbours. No diamonds.

### Furnace side jobs

Leave-and-take worked. Example, normal1 23:36Z: `Smelt: furnace at 293,95,61 loaded with 3 raw_iron; back for the iron_ingot in ~30 s`, then `[furnace]` coal gathers, then `Smelt: took 3 iron_ingot`. The same pattern repeated at 23:39Z and 23:41Z, and on later runs (00:18Z took 3, 01:02Z took 3, 01:05Z took 3, 01:10Z took 6).

Three loads never logged a take: 00:16Z furnace (284, 144, 32) loaded 4, take queued twice; 00:21Z the same furnace loaded 3, take queued twice; 00:24Z furnace (361, 124, 20) loaded 3, take queued twice. The next smelt placed a different furnace.

### Food, bed, bucket, chest

No hunt job in the soak window, so the food step did not batch animals. It was set aside on every normal run: 23:35Z and 00:15Z `failed 3 times`, 00:55Z `6 explore legs without food`. Iron still happened on all three.

Bed rung only explored. 23:44Z and 01:14Z: `no sheep after 3 search legs; bed set aside for 10 min`. No sheep hunt, no `white_bed`, no `Home set`, no sleep.

Bucket was crafted on the iron step (23:39Z, 00:23Z, 01:04Z) and `use bucket` ran. Six fills failed: three at (358, 94, -43) at 00:27Z and three at (315, 130, -13) at 01:12Z, each `produced no water bucket`. No `water_bucket` line.

`Job: Inventory nearly full; deposit items first` at 23:53Z and 01:16Z. No `Completed deposit` and no `[inventory]` deposit in the soak window.

### Night

- hard1 sealed at 01:40Z at (163, 121, 34), 11 blocks. `Night mine: down from the shelter` at 01:41Z (tod 12602), three coal wall digs. At 01:42Z: `could not climb back into (163, 121, 34): No path to the goal!` and, in the same second, `Night mine: back in the shelter (done; 19 steps...)`. The bot was not in the box: re-seal from 01:43Z through 01:50Z kept reporting `open cells 163,120,34=air (bot at 163.50,18.34)`.
- hard2 never got a log. From 02:00Z, `Gather: no diggable target left` at (141, 131, 30) while the remaining logs sat at y=136–137. At 02:02Z: `6 blocks held, 10 for the box; sealing a 1x1 pod (6)` at (141, 128, 30), then sealed. Dawn hold at 02:11Z (tod 14); opened at 02:12Z (tod 1014, hostile 17.7 away).
- hard3 got wood at 301 s after `searching further afield` on refused canopy logs (3 columns / 10 blocks, then 2/10, then 1/10). At 02:23Z a night crowd of 2 hostiles started a pillar at (190, 151, 55). At 02:24Z the shelter failed (`1 open cells`, bot at y=55.55) and the pillar `timed out at 0/3; rose 0.00, 0 clicks, holding cobblestone, on grass_block`. No later seal, and no death.

## 2026-10-16 12:24–12:42 IST — integration (`d0ca751`, bot code `4410d99`)

`git pull --rebase` landed on `d0ca751`, which only adds the commit-authorship rule. Bot source is the round-11 tip `4410d99`. Unit tests: 541 passed, 0 failed (`--test-skip-pattern resources`, 41.4 s). The cloud note expected 532/532; nothing failed. Services restarted with `AGENT_MODEL=off`. Supervisor log: `model server disabled`.

`python -u tests/integration.py`, model off. Exit 0, 1067 s. `All in-game integration tests passed`.

`Reflex paused the gather: Reflex: preempted by Mob Defense`. `PASS: A4 escaped the lava trench (hp 18.8, at [1653, -59, 1652])`.

## 2026-10-16 12:43–12:48 IST — combat (`84ac0e3`, bot code `4410d99`)

`python -u tests/combat_integration.py`, model off, same services. Exit 0, 311 s. `All combat acceptance tests passed`. No second run.

`4_creeper` (lane): ttk 7.3 s, hits 5, `damage_taken=0`, end health 20, killed, no crater at the spawn, the midpoint, or the bot start.

`4b_creeper_roofed`: ttk 6.2 s, hits 2, `damage_taken=0`, end health 20, killed, no crater. Both creepers stayed at 0 damage.

## 2026-10-16 12:49–15:58 IST — dual soak (`fc1a171`, bot code `4410d99`)

`AGENT_MODEL=off`, one soak, exit 0, 11331 s. `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, peaceful). Model stayed off. Anchors: hard [140, 130, 32], normal [310, 131, 30]. No second soak.

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 211 | 271 | 362 | 16 | 1 at 663 | — | 0 | no food held (bar min 5) | 0 |
| normal2a2 | 90 | 150 | 241 | 361 | 16 | 3 at 752 | — | 0 | ate 3 | 1 |
| normal3a3 | 120 | 181 | 241 | 391 | 16 | 2 at 692 | — | 0 | not hungry (bar min 18) | 0 |
| hard1a1 | 120 | 451 | 512 | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard2a2 | 181 | 361 | 421 | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard3a3 | 90 | 452 | 512 | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |

Diamond pick never. No bed on any run. All three hard runs got wood, a stone pickaxe, and a furnace. None reached iron.

### Night mine

- hard1, 09:34Z: sealed at (147, 127, 32), 16 blocks, then `Night mine: down from the shelter`. A cave opening turned the strip east. `could not climb` was not logged. `walking the tunnel back by hand` then `pillaring up the sump from y=125`, then `Night mine: back in the shelter`. No later `not in the box`. Dawn hold at 09:44Z (tod 1) was still sealed when the run ended.
- hard2, 09:55Z: sealed a 6-block box at (143, 119, 40). The mine opened a cave, the pathfinder climb failed, and the hand walk did not finish. `Night mine: not back in the shelter (...); bot at (143, 116, 39), the box is at (143, 119, 40)`. `Shelter: not in the box ... sealing where it stands`, then `Shelter: sealed at (143, 116, 39)` (7 blocks). Dawn hold at 10:05Z (tod 12).
- hard3, 10:17Z: sealed at (134, 121, 37), 14 blocks. The strip bridged a gap (`Tunnel: bridged a gap under (128, 113, 32) with cobblestone`), the pathfinder climb failed, the hand walk ran, then `pillaring up the sump from y=119` and `Night mine: back in the shelter`. Dawn hold at 10:26Z (tod 1) was still up at the bell. No `holding the box and re-sealing` and no night-pillar timeout.

### Diamond descent

Both diamond trips stopped at y=60 on water and never reached y=-53. No `Digging a branch mine`, no `bridged a gap` on a diamond trip, no `moved 3`, diamonds 0.

- normal2, 08:18Z and again 08:19Z: `diamond-rung` `targetY -53`. The second job died immediately: `Tunnel stopped: water under 458,60,212` (and the two neighbours) `no safe way on`. At 08:22Z `BuilderBot drowned` at (473, 56, 210). That is the only death. The soak counter is 1. End armour worn is 0 after the respawn; the rung had recorded 3 worn at 752 s.
- normal3, 09:00Z: the same stop, `water under 318,60,160` and the two neighbours. A bucket use at (316, 62, 160) is the line just before it.

### Furnace, bucket, bed, chest

`Smelt: took N` did happen, including `took 2 cooked_chicken ... (left standing)` and later iron from the same furnace at (159, 161, -24). There is no `Smelt: collecting the ... before a new batch` and no `gave up on the batch`.

The bucket was crafted and used. Fills failed out of reach: (317, 113, 18) at 15.4 blocks (07:31Z, twice) and (172, 133, -36) at 14.6 blocks (08:39Z, twice). No `water_bucket`.

Sheep were found and killed. 08:30Z `[bed-rung] hunt sheep` finished in 3 hits, and 08:57Z the same after an explore `south` for 39. No `craft white_bed`, no `Home set`, no sleep. `no sheep after 3 search legs; bed set aside for 10 min` still fired at 08:18Z and 09:00Z.

08:38Z: `home chest placed at 162,145,-21`, then three `Completed deposit` lines (cobblestone keep 64, cobblestone again, dirt keep 32).

### Food and canopy

The food step was set aside on every normal run before it stuck: 07:38Z and 08:08Z `6 explore legs without food`, 08:48Z `failed 3 times`. The explore failures in the log are `Cannot gather safely: nearby trunks could not be reached` (07:36Z) and `Navigation climbed above the graze cap` (08:07Z and 08:48Z). normal1's bar fell to 5 with nothing held, and `Health or food is low` repeated from 07:38Z to 08:03Z. normal2, after the set-aside, did hunt: pig, then chickens, and ate 3 (`porkchop` bar 13 to 16, raw `chicken` bar 14 to 16, `cooked_chicken` bar 14 to 20).

No `pillaring N up to the canopy log`. All three hard runs still gathered wood (120 s, 181 s, 90 s).

## 2026-10-16 16:09–16:26 IST — integration (`1721cd6`)

`git pull --rebase` already at `1721cd6`. Unit tests: 543 passed, 0 failed (`--test-skip-pattern resources`, 41.5 s). The note expected 534/534; nothing failed. Services restarted with `AGENT_MODEL=off`. Supervisor log: `model server disabled`.

`python -u tests/integration.py`, model off. Exit 0, 1066 s. `All in-game integration tests passed`.

`Reflex paused the gather: Reflex: preempted by Mob Defense`. `PASS: A4 escaped the lava trench (hp 18.8, at [1649, -60, 1649])`.

## 2026-10-16 16:27–16:33 IST — combat (`bad9169`, bot code `1721cd6`)

`python -u tests/combat_integration.py`, model off, same services. Exit 1, 316 s. `COMBAT SUITE ERRORS: test3_skeleton: TimeoutError('Condition did not become true')`. One run. The suite continued after that failure.

`3_skeleton_15`: ttk 0.0, hits null, `damage_taken=0`, blocked 0. The skeleton was summoned and the fight timed out without a kill.

`4_creeper` (lane): ttk 5.3 s, hits 3, `damage_taken=0`, end health 20, killed, no crater at the spawn, the midpoint, or the bot start.

`4b_creeper_roofed`: ttk 7.1 s, hits 3, `damage_taken=0`, end health 20, killed, no crater. Both creepers stayed at 0 damage. Zombie trio lost 13.7 hp and still killed all three.

## 2026-10-16 16:33–17:14 IST — dual soak stopped early (`d69f48f`, bot code `1721cd6`)

`AGENT_MODEL=off`. The soak was stopped on purpose during normal1. It had been running 2450 s (started 11:03:28Z, process ended 11:44:18Z) and had not printed SUMMARY, RUNGS, or `SOAK DONE`. Only normal1a1 had started (spawn [310, 131, 30]). The last sample is t=2227 of 2400, still `inventory: drop`. Hard runs never started. Anchors already scouted: hard [142, 131, 31], normal [310, 131, 30]. Deaths stayed 0. After the stop, services were restarted with the model off onto the flat world (`level-name=agent-test-world`, `server-ip=0.0.0.0`, `difficulty=peaceful`). Supervisor log: `model server disabled`. No second soak.

Sample times, not a rung table. The run never printed one. First sample that already held the item: wood pick 90 s, stone pick 211 s, furnace 301 s, iron pick 391 s, 16 torches 632 s, armour worn 2 at 1084 s. Bed 0 and diamonds 0 on every sample. Food bar stayed 20, eaten 0.

### Throw and pickup loop

This is why the run was stopped. From t=1656 to the stop, the bot did not leave [228, -34, 44] and the step stayed `inventory: drop`.

At 11:34:02Z: `Job: Inventory nearly full; deposit items first`, then `Autopilot [inventory] {"type":"drop","item":"cobblestone","count":256}` and `Dropped 256 cobblestone` / `Completed drop`. The same second-scale cycle then alternated `cobblestone` 256, `dirt` 45, and `cobbled_deepslate` 32 until 11:44Z. In that window the log has 300 `Dropped 256 cobblestone`, 167 `Dropped 45 dirt`, and 133 `Dropped 32 cobbled_deepslate`. At 11:39:26Z, `PACKET_RATE 49 per second, last: window_click`.

There is no collect or sweep line between those drops. The drop job's own check passed (`Completed drop`), so the count fell, and the stacks came back while the bot stood on them. Soak samples show cobble 64 after a drop and 320 at t=1896 (64 plus one 256 stack) before the next sample is 64 again. An earlier pass did the same thing while the bot was still walking: drops at 11:23–11:24Z (`Dropped 51/82/104/107 cobblestone`, `Dropped 40 dirt`), then cobble climbed from 64 at t=1084 to 206 at t=1114 and kept rising through the bed-rung explore.

### What this run did reach

No drowning line, no swim-up dig, and no `waiting: Misc World Survival Chain`.

Diamond: `[diamond-rung]` gather `targetY -53` `strip:true` at 11:26:21Z. Samples then walked down through y=40, 13, -4, -30, -46, -51 (t=1626) and the next sample is back at y=-34 dropping items. No `Digging a branch mine`, no `filled a hole`, no `moved` sidestep, no `water under`, diamonds 0. It did not reach y=-53.

Bucket: `craft bucket` at 11:18:24Z, then `use bucket` at (317, 113, 18), (316, 113, 18), (315, 114, 16), and (311, 62, 95). No `water_bucket` line and no `produced no water bucket` line in the window.

Bed: `no sheep after 3 search legs; bed set aside for 10 min` at 11:26:17Z. No `shears`, no `shear`, no sheep hunt, no `white_bed`, no `Home set`, no sleep, no home chest.

Food: bar never left 20, so the empty-bar hunt path was not reached. `food step set aside for 8 min (failed 3 times)` at 11:11:43Z. No `Health or food is low` and no `Food: ate`.

No night mine. The hard runs did not start.

## 2026-10-16 17:30–17:35 IST — combat (`383e021`)

`git pull --rebase` already at `383e021` (round 13: toss junk down an open run). Unit tests: **546 passed, 0 failed** (`--test-skip-pattern resources`, 41.4 s). The note expected 537; nothing failed. Services restarted with `AGENT_MODEL=off`. Supervisor log: `model server disabled`.

`python -u tests/combat_integration.py`, model off. Exit 0, 305 s. `All combat acceptance tests passed`. One run.

`3_skeleton_15` passed. ttk 5.8 s, hits 4, `damage_taken=1.5`, blocked 0, approach melee. The skeleton was summoned and the server confirmed it was defeated. The harness wait completed. Round 12's timeout (fight ended in 4 s with no target) did not repeat.

`4_creeper` (lane): ttk 5.3 s, hits 3, `damage_taken=0`, end health 20, killed, no crater at the spawn, the midpoint, or the bot start.

`4b_creeper_roofed`: ttk 5.3 s, hits 2, `damage_taken=0`, end health 20, killed, no crater. Both creepers stayed at 0 damage.

Zombie trio: ttk 15.8 s, hits 11, `damage_taken=5.0`, all three killed.

## 2026-10-16 17:36–20:44 IST — dual soak (`0cd08c8`, bot code `383e021`)

`AGENT_MODEL=off`, one soak, exit 0, 11286 s. `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Dashboard window used below is 12:08:14Z–15:14:12Z (join through the soak stop). After the stop, the flat world was restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, `difficulty=peaceful`). Supervisor log: `model server disabled`. Anchors: hard [141, 131, 30], normal [310, 131, 30]. No second soak.

The wood column is the first sample that held a wooden pickaxe. At the end of every normal run the wooden pickaxe was still held and the crafting table was gone, so the end predicate `wood` is no. hard1 and hard3 show a furnace or stone pick in this table that was gone by the bell, so their end `stone` predicate is no.

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 211 | 271 | 361 | 18 | 4 at 753 | — | 0 | ate 4 (1 meal failed: Promise timed out) | 0 |
| normal2a2 | 90 | 181 | 241 | 482 | 19 | 2 at 1234 | — | 0 | ate 1 | 0 |
| normal3a3 | 90 | 150 | 241 | 421 | 16 | 2 at 722 | — | 0 | not hungry (bar min 19) | 0 |
| hard1a1 | 90 | 211 | 301 | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard2a2 | 602 | — | — | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard3a3 | 271 | 331 | — | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |

Deaths 0. No death line in the dashboard window (`drowned`, `was slain`, `blew up`, and the rest). Interventions 3: normal1 returned from y=74; hard2 unstuck at [146, 132, 34] and [155, 138, 20].

### Drops

The round-12 loop did not return. In the window: `Dropped N item` 4, `No room to toss` 9, `came back into the inventory` 4, `dropped twice in 3 min` 0.

The four tosses that landed: 12:39:04Z `Dropped 415 cobblestone (toward -1,0, open 8)`, 12:39:07Z `Dropped 57 dirt (toward -1,0, open 8)`, 12:39:11Z `Dropped 37 diorite (toward 1,0, open 8)`, 13:04:51Z `Dropped 73 cobblestone (toward -1,0, open 8)`. Came-back failures: cobblestone at 12:33:55Z, dirt at 12:39:14Z (the 57-dirt toss), dirt at 12:44:34Z, dirt at 13:05:23Z. No 256-stack repeating for minutes. The bot left the cell after each refusal.

A different loop did run, after a toss was refused in a full inventory. `Job: No room for crafting result` fired 167 times, in two clusters, paired with `Autopilot [light] craft torch`: 46 lines from 13:23:44Z to 13:29:55Z (about 6 min, end of normal2 at y=-48) and 121 lines from 13:53:47Z to 14:10:12Z (about 16 min, rest of normal3). Same line, about every 8 s.

### Diamond, bucket, bed

Four `[diamond-rung]` gathers, all `targetY -53`, `strip:true`. Diamonds held 0. No `Digging a branch mine`. No `filled a hole`. No water-fill line and no `water_bucket`.

- normal1, 12:25:33Z. `Gather: descent stopped at y=48 (Tunnel stopped: water at (359, 47, 130))` at 12:26:45Z, and that stop line repeated six times in four seconds. Soak sample lowest y=47. Did not reach y=-53.
- normal2, 13:13:41Z. The staircase kept going. Deepest dashboard block is `Tunnel: mined deepslate_gold_ore in the wall at 457,-48,99` at 13:23:40Z. Soak sample lowest y=-49 at [458, -49, 99] (t=2046). At 13:23:41Z the gather hit `Job time limit reached`, then `No room to toss cobblestone (open run 0)`, then the torch craft loop above. No water stop on this trip. Did not reach y=-53.
- normal3, 13:48:46Z. `descent stopped at y=20 (Tunnel stopped: water at (579, 19, -30))` at 13:53:14Z. Soak sample lowest y=22. Then `Inventory nearly full` and `No room to toss cobblestone (open run 1)`.
- A fourth submit at 12:49:21Z (tail of normal1) died in the same second on `Inventory nearly full` and did not dig.

An earlier iron descent (13:01Z, not a diamond trip) logged five `Tunnel: bridged a gap` lines between y=62 and y=50. Nothing like that on a diamond trip.

Bucket was crafted three times (12:17Z, 13:04Z, 13:40Z) and `use bucket` ran. Fills that logged a failure: (317, 113, 18) out of reach 15.6, (316, 114, 15) out of reach 15.5, (574, 100, 69) no change after the use. No `water_bucket`.

Bed: `craft shears` at 12:40:07Z, two `Completed shear`, then `Shearing produced no wool` at 12:41:35Z. No `white_wool` line, no `white_bed`, no `Home set`, no `Sleeping`. `no sheep after 3 search legs; bed set aside for 10 min` at 12:25:27Z, 13:13:06Z, and 13:48:41Z.

### Food and hard runs

Lowest bar in the dashboard is 8, on `Food: ate porkchop (bar 8 -> 11)` at 12:37:48Z. Soak sample mins are 9, 15, 19, 20, 20, 20. Eat lines: three raw porkchop (one of those did not move the bar) and one `cooked_porkchop` 11 to 19 on normal1; one `cooked_porkchop` 14 to 20 on normal2 at 13:11:28Z. normal1 also logged `Food: meal failed - Promise timed out. (2 tries)` while a furnace place was refused holding porkchop. Food hunts that connected: normal1 one pig (3 hits), normal2 three pigs, normal3 one chicken. The food step was still set aside first on every normal run (12:14Z failed 3 times, 13:35Z 6 explore legs, 14:18Z failed 3 times).

No hard run reached an iron pick or an ingot. hard1's iron-ore peak is 3 and it ended holding 1 raw iron; furnace was in a sample at 301 s and gone at the end. hard3 held a stone pick at 331 s and never a furnace. hard2 got a wooden pick at 602 s and nothing past it. No `WorldSurvival: drowning`, no swim-up, no roof dig. Night: hard1 sealed at (153, 127, 30), mined, `could not climb`, walked back, `pillaring up the sump from y=125`, `back in the shelter`. hard2 sealed at (153, 139, 18) and held until dawn with no night-mine line. hard3 sealed at (126, 134, -7), mined, walked back, `pillaring up the sump from y=132`, `back in the shelter`. Hard pig fights timed out with the pig still standing (14:17Z, 14:18Z, 15:01Z, 15:02Z) while the bar stayed at 20.

## 2026-10-16 21:11–21:28 IST — integration (`bde4fb6`)

`git pull --rebase` already at `bde4fb6` (round 14: turn the staircase away from water, stop crafting in a full bag, toss from open ground, skip shorn sheep). Unit tests, every `tests/*.test.js` except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000 --test-skip-pattern resources`: **552 passed, 0 failed** (43.6 s). The note expected 543; nothing failed. Services restarted with `AGENT_MODEL=off`. Supervisor log: `model server disabled`.

`python -u tests/integration.py`, model off. Exit 0, 1067 s (15:41:11Z–15:58:58Z). `All in-game integration tests passed`.

`Reflex paused the gather: Reflex: preempted by Mob Defense`. `PASS: A4 escaped the lava trench (hp 19.8, at [1656, -59, 1654])`.
