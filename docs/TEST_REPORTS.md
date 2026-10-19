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

## 2026-10-16 21:30 IST – 2026-10-17 00:38 IST — dual soak (`4be8d67`, bot code `bde4fb6`)

`AGENT_MODEL=off`, one soak, exit 0, 11288 s (16:00:18Z–19:08:27Z). `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Dashboard window used below is 16:00:20Z–19:08:13Z. After the stop, the flat world was restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, `difficulty=peaceful`). Supervisor log: `model server disabled`. Anchors: hard [141, 131, 30], normal [310, 131, 30]. No second soak.

The wood / stone-pick / furnace columns are the first sample that held the item. End predicates differ where the item was gone at the bell: normal1 `stone` no (stone pickaxe 0, furnace still 1, diamond pickaxe still 1), normal3 `wood` no and `stone` no (table and furnace gone, iron pickaxe still 1), hard2 `wood` no and `stone` no (empty inventory), hard3 `stone` no.

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 181 | 271 | 602 | 17 | 2 at 1084 | — | 3 | ate 2 | 0 |
| normal2a2 | 120 | 211 | 301 | 452 | 18 | 2 at 722 | — | 0 | not hungry (bar min 17) | 0 |
| normal3a3 | 90 | 181 | 271 | 542 | 19 | 1 at 1114 | — | 0 | ate 2 | 0 |
| hard1a1 | 90 | 331 | 512 | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard2a2 | 181 | 391 | — | — | 0 | 0 | — | 0 | not hungry (bar min 17) | 3 |
| hard3a3 | 271 | — | — | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |

Deaths 3, all hard2. Interventions 11, resumes 3. normal3 was returned from y=61, y=81, and y=82. hard1 unstuck at [144, 129, 32]. hard2 resumed after each death and was returned from y=60 and y=48. hard3 unstuck at [128, 127, 36] and was returned from y=62.

### Deaths

Three `Bot died at` lines, matching the soak counter.

- 18:37:05Z `BuilderBot drowned` at 119, 53, 39.
- 18:38:55Z `BuilderBot was slain by Zombie` at 132, 127, 34.
- 18:39:49Z `BuilderBot drowned` at 119, 53, 39.

### Diamond trips

Three `[diamond-rung]` gathers, all `targetY -53`, `strip:true`. No `Digging a branch mine`.

- normal1, 16:21:57Z, count 3. Samples walked y=56, 37, 30, 23, 17, 8, 1, -5, -10 (2 diamonds), -15, -52. `Tunnel: mined deepslate_diamond_ore in the wall at 402,-8,176` at 16:26:51Z. Nine `filled a hole` lines on this descent, from `(400, 31, 138)` through `(401, -23, 191)`. No `water beside`, no `bridged a gap`, no `start a new staircase`, no `descent stopped`. A second submit at 16:28:50Z (count 1) then `craft diamond_pickaxe` at 16:29:02Z. Sample t=1535 still on diamond-rung at y=-51 holding 3 diamonds; t=1565 at y=-53 already held the diamond pick (step iron). Later iron samples reached y=-59. Diamonds held peaked at 3, then 0 once the pick was crafted. Two `Tool left the inventory: diamond_pickaxe` lines followed (1561 uses left, then 1491); the end inventory still held one.
- normal2, 16:58:37Z, count 3. Two `filled a hole` lines under `(277, 106, 12)` and `(277, 105, 13)`. Then `moved 3 north to start a new staircase` at (278, 75, 39) and again at (278, 73, 34), four `bridged a gap` lines from y=73 to y=68, and `Gather: descent stopped at y=68 (Tunnel stopped: cave opening under 278,67,28 ...)`. Sample lowest y=60 at [278, 60, 39]. Diamonds held 0. Did not reach y=-53.
- normal3 submitted no diamond gather. Diamonds held 0. Sample lowest y=22 was a wood gather at the bell, not a diamond trip.

The one `water beside` line is not on a diamond trip: 17:46:25Z `Tunnel: water beside (341, 48, 87); turning south`, during normal3's iron descent (sample y=38 on iron just before). One later `bridged a gap` and one `filled a hole` on that same iron descent.

### Full bag

The torch craft loop did not return. `No room for crafting result` 3, `the bag is full; no crafting for 5 min` 3 (16:34:45Z, 16:39:48Z, 17:04:49Z). No craft-fail every 8 s.

`Dropped N item (toward` 10, `came back into the inventory` 6, `No room to toss` 2 (`open run 1` at 17:04:27Z, `open run 0` at 17:09:53Z), `dropped twice in 3 min` 1 (dirt, 17:58:11Z). Landed tosses were 130 cobblestone, two single spruce saplings, 113 cobblestone, then 115 cobblestone / 52 dirt / 29 andesite / 14 diorite / 3 spruce sapling, then 52 dirt. No 256-stack repeating.

After the second pause, normal1 stood at [452, -58, 270] on `waiting: bag full (stone craft)` from t=1897 to t=2408 (511 s). The dashboard in that slice has no line repeating 6 times. The pause stopped the craft spam, and the run then ended still waiting.

### Bed

No `shears`, no `shear`, no `No unshorn sheep`, no wool line, no `white_bed` or other bed, no `Home set`, no `Sleeping`. One bed line: 16:57:33Z `no sheep after 3 search legs; bed set aside for 10 min` (start of normal2). Bed 0 on every run.

### Bucket

No `water_bucket` line in the window, so none was logged as held. Three fill failures, all out of reach, one second apart at 17:10Z: (276, 61, 46) at 21.3, (283, 60, 44) at 22.4, (273, 59, 38) at 22.1. A bucket was crafted at 16:15Z, 16:53Z, and 17:35Z. Uses at 16:16Z and 17:20Z–17:21Z logged no `produced no water bucket` line.

### Food

Lowest bar on a meal line is 14. Soak sample mins are 15, 17, 15, 20, 17, 20. Meals: `Food: ate cooked_beef (bar 14 -> 20)` at 16:27:45Z, 17:45:02Z, and 17:57:30Z. Hunts that connected: normal1 four cow fights (hits 3, 4, 3, 2) at 16:08Z–16:10Z; normal3 three cow fights (hits 2, 2, 4) at 17:28Z–17:30Z. hard1 submitted a chicken fight at 18:25:23Z as the run ended; no `Fight result` line. normal2 ate nothing. Its bar stayed at least 17 while health sat at 9.

### Hard runs

No hard run reached an iron pick or an ingot.

- hard1 furthest rung is the furnace (512 s; stone pick 331 s). It sealed at (161, 112, 29), mined (`Night mine: down from the shelter`, `walking the tunnel back by hand`, `pillaring up the sump from y=110`, `back in the shelter`), and held that shelter from about t=632 to t=993. The 18:10Z–18:30Z slice has no job line repeating inside a few minutes. It ended on the chicken fight above. Ore 0.
- hard2 furthest rung is the stone pick (391 s). No furnace. It stood on `working: gather` at [119, 63, 38] from t=391 to t=572. At 18:36:33Z `WorldSurvival: drowning (air 4), swimming up` started, and `swimming up` then ran 31 times through 18:39:18Z (air down to -1). No roof-dig line. In the same two minutes `Reflex: resumed the shelter job` 46 times against `Reflex: preempted by Misc World Survival Chain` 29 times, until the drown at 18:37:05Z and the zombie kill at 18:38:55Z, then the second drown. After that, `Short of shelter blocks` at (97, 144, -27) and (95, 123, -14), `Night: pillar-up failed (left the column at 0/3)`, and `night: no shelter; holding for morning` at [95, 123, -14]. It ended gathering wood at [103, 48, 11] with an empty inventory.
- hard3 furthest rung is the wooden pick (271 s). No stone. From 18:50:34Z to 18:52:48Z, `Explore stopped early at (141, 132, 30)` 12 times, and `Gather: pillaring 4 up to the canopy log at (142, 137, 31)` 7 times in 64 s with `no diggable target left`. Then `Short of shelter blocks: 0 held, 23 needed at (135, 138, 21)` and `night: no shelter; holding for morning` at [135, 141, 21] from t=632 to t=1173. It ended `backing off (6s): wood`.

### Other loop

normal2, after the y=68 stop, stood at [278, 60, 39] with health 9 from t=1625 to the bell (t=2407). From 17:10:32Z to 17:23:54Z the same lines repeat: `Job: Health or food is low` 66 times, `gather coal_ore` count 13 `targetY 32` 37 times, and `iron failed 3 times; exploring before retry` 21 times.

## 2026-10-17 03:22–03:27 IST — combat (`804de91`)

`git pull --rebase` already at `804de91` (round 15: food on low health, a drowning escape that holds, a tunnel climb that stays on the tunnel, no full-bag stall). Unit tests, every `tests/*.test.js` except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000 --test-skip-pattern resources`: **555 passed, 0 failed** (44.3 s). The note expected 546; nothing failed. Services restarted with `AGENT_MODEL=off`. Supervisor log: `model server disabled`.

`python -u tests/combat_integration.py`, model off. Exit 0, 305 s (21:52:39Z–21:57:44Z). `All combat acceptance tests passed`. One run.

`4_creeper` (lane): ttk 5.3 s, hits 3, `damage_taken=0`, end health 20, killed, no crater at the spawn, the midpoint, or the bot start. Dashboard fight result at 21:54:39Z: `tactic=bow hits=3 shots=3 released=3 landed=3 damage taken=0`.

`4b_creeper_roofed`: ttk 7.2 s, hits 3, `damage_taken=0`, end health 20, killed, no crater. At 21:54:47Z `Combat: pillar-up 2 at 1496,-60,1497 (creeper at 7.8)`, then `pillar perched 2 up`. Fight result at 21:54:53Z: `tactic=bow hits=3 shots=2 released=2 landed=2 damage taken=0`. Both creepers stayed at 0 damage.

Drowning latch: the combat dashboard window (21:52:41Z join through 21:57:42Z, 411 lines) has no `drown`, `swimming up`, `resumed`, `water`, or air line. The arena fights never entered water, so the latch was not exercised here.

## 2026-10-17 03:31–06:39 IST — dual soak (`514dd40`, bot code `804de91`)

`AGENT_MODEL=off`, one soak, exit 0, 11290 s (22:01:05Z–01:09:15Z). `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Dashboard window used below is 22:01:08Z–01:09:01Z (the stop of the previous flat world through the soak stop, before the restore's dashboard came back). After the stop, the flat world was restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, `difficulty=peaceful`). Supervisor log: `model server disabled`. Anchors this seed: hard [142, 131, 31], normal [310, 131, 30]. No second soak. Interventions 13, resumes 5.

The wood / stone-pick / furnace / iron-pick columns are the first sample that held the item. End predicates differ where the table, furnace, or pick was gone at the bell: normal1 `stone` no (furnace 0, stone pick still 1 in the end inventory line, iron pick already gone), normal2 `wood` no and `stone` no (table 0, furnace 0, both picks still 1), hard1 `wood` no and `stone` no (table 0, furnace 0, both picks still 1), hard3 empty at the bell after four deaths.

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 181 | 271 | 391 | 16 | 2 at 722 | — | 0 | no food held (bar min 13) | 1 |
| normal2a2 | 120 | 211 | — | — | 4 | 0 | — | 0 | no food held (bar min 5) | 0 |
| normal3a3 | 150 | 211 | 271 | 602 | 16 | 0 | — | 0 | ate 6 (1 failed: the food bar did not rise) | 0 |
| hard1a1 | 211 | 421 | — | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard2a2 | — | — | — | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard3a3 | 211 | 301 | 331 | — | 0 | 0 | — | 0 | not hungry (bar min 17) | 4 |

### Deaths

Five `Bot died at` lines, matching the soak counter.

- 22:38:51Z `BuilderBot burned to death` at 285, -20, 137 (normal1). The previous 30 s: three `craft stone_shovel` jobs each ending `Missing ingredients or a nearby crafting table`, then `stone failed 3 times; exploring before retry`, an explore, `Reflex: preempted by Misc World Survival Chain`, `resumed the explore job`, and `Health or food is low` at 22:38:43Z. No lava line in that slice.
- 00:59:18Z `BuilderBot was slain by Zombie Villager` at 146, 147, -7 (hard3). The previous 30 s: `Reflex: fleeing` a mixed crowd, mob defense preempts the fight, a shelter is submitted, `resumed the fight job`, `Tool left the inventory: stone_sword`, then the kill.
- 01:00:14Z `BuilderBot was slain by Zombie Villager` at 107, 140, -41. The previous 30 s: `Short of shelter blocks: 0 held, 24 needed at (101, 143, -42)`, `fleeing creeper`, `creeper at 5.9 overrides the shelter hold`, a wood gather, then the kill.
- 01:00:31Z `BuilderBot was slain by Zombie Villager` at 90, 132, -25. The previous 30 s includes the death above, `respawned at night`, `Server set position to (96, 143, -26)`, `Short of shelter blocks: 0 held, 22 needed at (93, 143, -31)`, another fleeing crowd, then the kill.
- 01:07:56Z `BuilderBot was slain by Zombie` at 132, 124, 25. The previous 30 s: `Server set position to (142, 131, 31)` at 01:07:27Z, then `Cannot reach or harvest` on dark_oak_log at (135, 134, 31), (135, 132, 31), (135, 133, 31), (139, 134, 23), (138, 134, 22), (138, 132, 22), (138, 130, 22), and (133, 129, 31), with mob defense preempting and resuming the gather the whole way. `Misc World Survival Chain engaging` at 01:07:55Z, then the kill.

### Diamond trips

One `[diamond-rung]` gather, 22:20:34Z, `targetY -53`, `strip:true`, count 3. Diamonds held 0 on every sample. No `diamond_pickaxe` line. No `descent stopped`. No `Left the tunnel`.

Diamond-step samples walked y=126, 117, 110, 101, 90, 84, 77, 69, 62, 55, 50, 45, 39, 30, 21, 12, 6, 0, -5, -9 (t=993 to t=1565), all with 0 diamonds. Tunnel lines on that descent: `moved 3 west to start a new staircase at (259, 50, 109)` at 22:25:51Z, `bridged a gap under (267, 29, 114)` at 22:27:25Z, `filled a hole under (267, 27, 112)` at 22:27:30Z, `filled a hole under (267, -7, 78)` at 22:30:00Z. It then stood at [273, -10, 72] from t=1625 to t=1926. The run's lowest sample is later, [280, -21, 135] at t=2047, step already `stone`, diamonds still 0, hp 17, and that is the burn above. Did not reach y=-53.

### Drowning

One `swimming up` line: 23:55:51Z `WorldSurvival: drowning (air 6), swimming up` (normal3, during an iron gather that was already `Inventory nearly full`). The next line is `Reflex: Misc World Survival Chain engaging`, not `resumed`. No second `swimming up`. `Completed explore` at 23:56:13Z. No drown death. The bot got out.

### Low health

No stretch of health under 10 lasted more than a minute. The only sample under 10 is normal3 t=1566, hp 7.3, bar 17, `recovering: health 7`, 4 food items, eaten 2. The next sample (t=1596) is hp 14.6, eaten 3, and t=1626 is hp 20, eaten 4. Meals on that run are the `Food: ate` lines below.

`Health or food is low` is on 182 timestamped lines from 22:38:43Z to 23:50:36Z. The long run of them is normal2, health still 20, bar down to 5, with nothing to eat (see the loop below).

### Full bag

The string `waiting: bag full` is the soak status, not a dashboard line. Dashboard says `the bag is full; no crafting for 5 min, clearing junk first` three times: 22:31:26Z, 23:40:54Z, 23:54:55Z.

normal1's status stayed `waiting: bag full (stone craft)` at [273, -10, 72] from t=1625 to t=1926 (301 s), starting at the 22:31:26Z line. No `Dropped N` line falls inside that 301 s. The tosses just before it are 22:30:42Z `Dropped 291 cobblestone` and 22:30:50Z `Dropped 104 dirt`. The next came-back is 22:38:10Z, after the bot had left that cell.

Thirteen `Dropped N (toward` lines in the window: 291 cobblestone, 104 dirt, 62 cobblestone, 25 andesite, 63 cobblestone, 21 dirt, 21 granite, two 2 spruce sapling, 152 cobblestone, 13 dirt, 152 cobblestone, 128 cobblestone. Seven `came back into the inventory` lines (dirt, granite, cobblestone, cobblestone, andesite, cobblestone, dirt). One toss refusal: 23:34:42Z `No room to toss spruce_sapling (open run 2)`.

### Bucket

No `water_bucket` line, so none was logged as held. 22:15:35Z fill at (317, 113, 18) `out of reach (14.2)`, 22:15:36Z fill at (313, 114, 11) `out of reach (22.2)`, then 22:15:44Z `the bucket failed twice; no water fills for 15 min`. A bucket was crafted at 22:14:53Z and again at 23:37:17Z. One later use at (297, 29, 42) at 23:40:22Z logged no failure line. `MLG Water Bucket Fall Chain` engaged at 23:50:35Z and 23:54:07Z.

### Bed

No `shears`, no shear result, no wool line, no `white_bed`, no `Home set`, no `Sleeping`. One bed line: 22:20:14Z `no sheep after 3 search legs; bed set aside for 10 min`. A later food fight killed a sheep (23:30:27Z, 3 hits) and did not shear it. Bed 0 on every run.

### Food

Lowest bar on a meal line is 14. Soak sample mins are 13, 5, 15, 20, 20, 17. Meals, all normal3: `cooked_chicken` 14 to 20 at 23:44:49Z and 23:50:16Z, `cooked_chicken` 17 to 20 at 23:51:08Z, `cooked_mutton` 14 to 20 at 23:51:52Z and 23:57:17Z, `cooked_beef` 14 to 20 at 00:03:17Z. `Food: meal failed - the food bar did not rise (2 tries)` at 23:51:01Z. Hunts that connected: one cow (3 hits), one sheep (3 hits), three chickens (1 hit each), all 23:29Z–23:32Z. hard3 submitted three pig fights at 00:53Z–00:55Z; two ended `no target` / `stopped`, and the third has no `Fight result` before the deaths. normal1 and normal2 ate nothing.

### Hard runs

No hard run reached an iron pick or an ingot. None sat on (141, 131, 30). The scouted hard anchor was [142, 131, 31]. No block read was taken: the bot never stayed put on (141, 131, 30), and the one return to (142, 131, 31) lasted under 30 s and ended in the zombie kill above, after which the soak had already restored the flat world.

- hard1 furthest rung is the stone pick (421 s; wooden pick 211 s). No furnace. It stood at [140, 131, 32], one block off the old anchor, from t=181 to t=271 while the wooden pick was crafted, then moved. Two unstucks, at [140, 126, 37] and [139, 125, 37]. From t=722 to t=1264 it held a shelter at [123, 121, 32] (`working: shelter`). It ended with both picks still held, table 0, furnace 0, 1 raw iron.
- hard2 furthest rung is planks and a table. The wooden pick never appeared (`wood` —). It stood at [128, 111, 48] from t=211 to t=572 on `queued: goto`, then at [128, 110, 48] from t=602 to the bell (t=1264), step `night` then `wood`, still `queued: goto` until the last sample `backing off (3s): wood`. No unstuck. Ended with 14 planks, 4 sticks, a table, and no pick.
- hard3 furthest rung is the furnace (331 s; stone pick 301 s, wooden pick 211 s). It then stood at [147, 147, -7] from t=481 to t=662 on a food fight, and at [89, 76, -22] on `night: no shelter; holding for morning` for 12 samples. `Explore stopped early at (89, 76, -22)` at 01:07:20Z and 01:07:21Z. The four deaths above emptied it. The 01:07:27Z teleport back to the anchor is the 30 s in the last death.

`Cannot reach or harvest` 36 lines (19 of them `skipping`), spread 22Z 10, 23Z 2, 00Z 8, 01Z 16. `No path to the goal!` once, 22:13:55Z, a smelt walk back to the furnace at 328,119,30 on normal1. `Explore stopped early` three job lines: (339, 114, 42) at 22:09:14Z, and the two at (89, 76, -22). Server log inside the soak window (IST 03:31–06:39): nine `BuilderBot moved wrongly!` warnings, 04:24:48–04:24:57 IST (22:54:48Z–22:54:57Z), no coordinates on the warning. Not the hard anchor.

### Other loops

- normal2 stood at [203, 153, 30] from t=1024 to the bell (t=2408, 1384 s), step `wood`, `backing off`, bar 5, health 20, no food held. From 23:01:28Z the same lines repeat for the rest of that stand: `Health or food is low` and `craft dark_oak_planks`. No `Food: ate` on this run.
- `craft stone_shovel` / `Missing ingredients or a nearby crafting table` repeats from 22:49:19Z through 22:57Z (normal2), about 15 submits inside a few minutes, and the missing-ingredients line continues out to 23:52:59Z (66 timestamped lines).
- No `Left the tunnel`. The round-14 tunnel-exit drop did not show up. The craft-every-8-seconds torch loop did not show up either (`No room for crafting result` was not a minutes-long cluster).

## 2026-10-17 11:50–11:55 IST — combat (`e405f20`)

`git pull --rebase` already at `e405f20` (round 16: food emergencies jump the ladder, a kit craft that failed 3 times is skipped, a superseded paused job is cancelled, the witch flee is bounded). Unit tests, every `tests/*.test.js` except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000 --test-skip-pattern resources`: **557 passed, 0 failed** (41.6 s). The note expected 548; nothing failed. Services restarted with `AGENT_MODEL=off`. Supervisor log: `model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit`.

`python -u tests/combat_integration.py`, model off. Exit 0, 301 s (06:20:29Z–06:25:30Z). `All combat acceptance tests passed`. One run.

`4_creeper` (lane): ttk 7.3 s, hits 5, `damage_taken=0`, end health 20, killed, no crater at the spawn, the midpoint, or the bot start. Dashboard: `Combat: pillar-up 2 at 1499,-60,1518 (creeper at 7.3)` at 06:22:18.277Z, `pillar perched 2 up` at 06:22:19.076Z. Fight result at 06:22:24.958Z: `tactic=bow hits=5 shots=0 released=0 landed=0 damage taken=0`.

`4b_creeper_roofed`: ttk 7.2 s, hits 3, `damage_taken=0`, end health 20, killed, no crater. At 06:22:33.558Z `Combat: pillar-up 2 at 1496,-60,1497 (creeper at 8.0)`, then `pillar perched 2 up`. Fight result at 06:22:39.425Z: `tactic=bow hits=3 shots=2 released=2 landed=2 damage taken=0`. Both creepers stayed at 0 damage.

### Witch

`7_witch: ttk=1.0 hits=0.0 crits=0.0 damage_taken=0`. The harness printed `NOTE: witch survived the duel (job failed, lost 0 hp)` and recorded it as the measured 26.3 limit. The suite still passed. The witch was not killed.

Timestamped dashboard lines for that fight, all inside one second:

- 06:23:48.353Z `Combat: avoid witch`
- 06:23:48.353Z `Combat event: avoid avoid: the witch kites and out-potions the rush - break line of sight (7c/26.3)`
- 06:23:48.415Z `Combat: avoiding witch - benched for 60s, breaking line of sight`
- 06:23:48.475Z `Fight result: no target tactic=avoid hits=0 crits=0 sweeps=0 shots=0 released=0 landed=0 damage taken=0 disengages=0 result=finished`
- 06:23:48.479Z `Job: Fight timed out; witch is still standing`

In the combat window 06:20:29Z–06:25:30Z there are **0** `fleeing witch` lines and **0** `fled a witch for 45 s` lines. The fight job took the avoid path and ended before a reflex flee could run, so the 45 s bound was not exercised here.

## 2026-10-17 11:58–15:06 IST — dual soak (`2a21bb1`, bot code `e405f20`)

`AGENT_MODEL=off`, one soak, exit 0, 11276 s (06:28:52Z–09:36:48Z). `SOAK DONE (clean)`. Anchors this seed: hard [141, 131, 30], normal [310, 131, 30]. Interventions 9, resumes 0, deaths 0. After the stop, the flat world was restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, `difficulty=peaceful`). Supervisor log: `model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit`. Dashboard window used below is 06:30:41.596Z–09:36:32.456Z (soak world connect through the last `Autopilot stopped`, 1770 timestamped lines).

The wood / stone-pick / furnace / iron-pick columns are the first sample that held the item. End predicates differ where the table or the rest of the kit was gone at the bell: normal2 `wood` no (table 0, wooden pick still 1), hard1 and hard2 `wood` no and `stone` no (table 0, furnace 0, both picks still 1), hard3 `wood` no and `stone` no (table 0, furnace 0, stone pick still 1, stone axe/sword/shovel 0).

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 211 | 271 | 391 | 16 | 2 at 632 | 933 | 0 | ate 1 | 0 |
| normal2a2 | 90 | 211 | 331 | 512 | 16 | 4 at 783 | — | 3 | ate 2 | 0 |
| normal3a3 | 90 | 211 | 271 | 452 | 17 | 2 at 843 | — | 0 | ate 1 | 0 |
| hard1a1 | 120 | 271 | — | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard2a2 | 90 | 211 | — | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard3a3 | 211 | 391 | — | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |

normal2 also held a diamond pick from t=2353. The other five runs never did.

### Deaths

Zero `Bot died` lines in the window. The soak counter is 0.

### Food emergencies

None. Sample bars are 15–20, 15–20, 16–20, 20, 20, 20. Health is 20 on every sample. Zero `Health or food is low` lines. The bar never sat at 6 or under, and health never sat under 10, so no food job was required for that rule.

### `craft failed 3 times; skipped`

Zero lines. Stone shovel crafts completed (the tool shows up in the inventory after each submit). The 3-failure skip was not hit.

### `was superseded`

Zero lines.

### Witch

Zero `fleeing witch` lines. Zero `fled a witch for 45 s` lines. One crowd line at 08:54:07.384Z, the start of hard2, lists a witch among skeletons, creepers, and zombies (`Reflex: fleeing skeleton,skeleton,creeper,...witch,...`). That is the mixed-crowd flee, and it is a single line.

### Full bag

`waiting: bag full` is the soak status. Dashboard says `the bag is full; no crafting for 5 min, clearing junk first` four times: 07:06:08.589Z, 08:16:25.031Z, 08:21:26.318Z, 08:26:27.635Z.

normal1 has the 07:06:08Z line and no sample whose status is `waiting: bag full`. Drops inside the following minutes: 07:06:11.630Z `Dropped 158 cobbled_deepslate` and 07:08:37.509Z `Dropped 64 cobblestone`. The next chest craft is 07:30:17.425Z, on the next run.

normal3 stood at [231, 88, 13] from t=1415 to t=2017 (602 s), cobble stuck at 317. Status `waiting: bag full (iron craft)` from t=1475 to t=1716 (241 s) and again on most samples through t=2017, with short `backing off` gaps at t=1746, 1806, 1866, 1927, and 1987. That stand is the 08:16:25Z, 08:21:26Z, and 08:26:27Z lines. In 08:16:25Z–08:26:27Z there is no `Dropped N` line. `No room to toss cobblestone (open run 0)` is on 08:16:25.066Z, 08:17:25.536Z, 08:18:25.957Z, 08:19:26.417Z, 08:20:26.882Z, 08:21:26.369Z, 08:21:34.448Z, 08:22:34.882Z, 08:23:35.367Z, 08:24:35.828Z, and 08:25:36.292Z. No chest craft falls in that window. The run's only chest craft is earlier, 07:30:17.425Z `craft chest`, placed at 07:44:02.081Z `home chest placed at 413,39,136` (normal2, bag not full).

Other `Dropped N` lines in the window: 5 cobblestone, 22 cobblestone, 248 cobblestone, 158 cobbled_deepslate, 64 cobblestone, 73 cobblestone, 5 spruce sapling, 3 cobblestone.

### Diamond trips

Four `gather diamond_ore` submits, each `targetY -53`, `strip:true`, count 3: 06:47:17.738Z (normal1), 07:27:18.773Z and 07:49:39.833Z (normal2), 08:10:22.541Z (normal3).

- normal1 diamond-rung samples walk y=99, 10, 1, -4, -8, -15, -20, -25 (t=933 to t=1505), diamonds 0. At 06:57:17.943Z `Could not climb back up the tunnel: Time limit reached`. The step then leaves diamond-rung. A later iron sample is [314, -53, 7] at t=1656, diamonds 0, diamond pick 0. The run's lowest y is -53. Diamonds held 0. No `diamond_pickaxe` line on this run.
- normal2 lowest sample is [403, -19, 95] at t=2142. Diamond-rung samples: y=-14 with 0 diamonds (t=2262), y=-18 with 1 (t=2292), y=-18 with 3 (t=2323). 07:49:52.838Z `BuilderBot has made the advancement [Diamonds!]`. 07:50:17.303Z `skipping deepslate_diamond_ore at 422,-18,98 (Cannot reach or harvest this block)`. 07:51:06.788Z `craft diamond_pickaxe`. The pick is held from t=2353 (diamonds then 0). It is still in the end inventory (`diamond_pickaxe` 1). The y=-53 strip was not reached. Six `descent stopped at y=62` lines, 07:27:18.773Z–07:27:23.796Z, water beside the staircase; the later trip still found the three diamonds above that stop.
- normal3 diamond-rung samples walk y=155 down to y=76 (t=1084 to t=1385), diamonds 0. 08:15:51.736Z `descent stopped at y=73`. Lowest y on the run is 76. No diamond pick. The bag-full stand above starts on the next samples.

### Bucket

Zero lines that name `water_bucket` as held. Two fill failures: 06:40:42.956Z `(316, 130, 0)` out of reach 21.2, then 06:40:53.861Z `the bucket failed twice; no water fills for 15 min`; 07:10:53.749Z `(129, -22, 79)` out of reach 13.3, then 07:11:01.483Z the same 15 min line. A bucket was crafted at 06:40:23.731Z, 07:23:00.971Z, and 08:03:38.212Z. Uses at 07:06:20.744Z `(71, -42, 17)`, 07:27:09.668Z `(401, 62, 124)`, and 08:27:53.727Z `(239, 99, 9)` (that last one `Completed use` at 08:28:23.990Z) logged no `produced no water bucket` line. `MLG Water Bucket Fall Chain` engaged once, 07:44:29.157Z.

### Bed

Zero `shears` lines and zero shear results. normal1 killed sheep instead: three `Fight result: sheep` lines at 06:46:05.032Z, 06:46:11.534Z, and 06:46:16.505Z, 2 hits each. 06:47:08.557Z `craft white_bed`, `Completed craft` at 06:47:16.842Z. Bed stays 1 on every normal1 sample from t=933 to the bell. Zero `Home set` lines. Zero `Sleeping` lines. The other three bed lines are `no sheep after 3 search legs; bed set aside for 10 min` at 07:26:25.075Z, 08:09:16.252Z, and 08:29:03.951Z. Bed 0 on those five runs.

### Food

Lowest bar on a meal line is 14. Sample mins are 15, 15, 16, 20, 20, 20. Meals: `cooked_mutton` 14 to 20 at 07:03:01.005Z, `cooked_chicken` 14 to 20 at 07:38:35.262Z, `cooked_beef` 14 to 20 at 07:51:52.911Z, `cooked_beef` 14 to 20 at 08:31:05.208Z. Hunts that connected: three sheep (2 hits each) at 06:46Z, one chicken (2 hits) at 07:17:52.434Z, two cows (3 and 2 hits) at 07:18:27.682Z and 07:18:41.418Z, one cow (3 hits) at 07:57:24.760Z. Hard runs stayed at bar 20 with eaten 0.

### Hard runs

No hard run reached a furnace or an iron pick. Each one sealed a shelter and the dashboard then goes quiet until dawn.

- hard1 furthest rung is the stone pick (271 s; wooden pick 120 s). It stood at [152, 130, 36] from t=632 to the bell (t=1264, 632 s), status `working: shelter`. 08:40:49.855Z–08:40:58.943Z is ten `Cannot reach or harvest` stone lines in one second. 08:43:22.179Z `Shelter: sealed at (152, 130, 36)`. The next timestamped line is 08:52:49.238Z `Shelter: dawn (tod 7)`. It ended with both picks still held, table 0, furnace 0.
- hard2 furthest rung is the stone pick (211 s; wooden pick 90 s). It stood at [148, 131, 29] from t=662 to t=1234 (572 s), `working: shelter`. Earlier same-cell stands: [139, 129, 23] t=30–120 on `wood: craft`, [142, 126, 23] t=150–271 on `working: gather`, [146, 131, 27] t=481–572 on `working: craft`. 09:01:46.257Z–09:01:55.320Z is ten `Cannot reach` stone lines in nine seconds. 09:04:43.311Z `Shelter: sealed at (148, 131, 29)`. 09:04:58.981Z `Night mine: could not climb back into (148, 131, 29): Took to long to decide path to goal!`, then `pillaring up the sump from y=129`, then `back in the shelter`. The next line after the re-seal is 09:14:05.207Z `Shelter: dawn (tod 7)`. It ended `backing off (2s): stone` at [149, 133, 31], both picks held, table 0, furnace 0.
- hard3 furthest rung is the stone pick (391 s; wooden pick 211 s). 3 raw iron, 0 ingots. From 09:15:28.884Z to 09:16:07.985Z, `Cannot reach or harvest` on dark_oak_log (and three oak_log) repeats, about forty lines in 39 s, around the anchor. It then stood at [133, 125, 40] from t=722 to the bell (t=1264, 542 s), `working: shelter`. 09:27:22.564Z `Night mine: not back in the shelter` (bot at (133, 125, 40), box at (146, 126, 36)), then 09:27:34.797Z `Shelter: sealed at (133, 125, 40)`. The next line is 09:35:21.322Z `Shelter: dawn (tod 11)`. It ended there, table 0, furnace 0, stone pick still 1.

### Other loops

- normal1, after the failed tunnel climb, explores at about y=-47 from t=1686 to the bell (t=2409). From 06:58:20.748Z to 07:11:43.989Z the same coal job repeats 29 times: `gather coal_ore` count 4 `targetY 32`. `iron failed 3 times; exploring before retry` is on 12 lines from 06:58:51.206Z to 07:11:52.076Z. Bar stayed at least 15. The run ended at [153, -47, 12].
- normal2 stood at [405, 55, 128] from t=1054 to t=1204 (150 s) and again t=1446 to t=1568 (122 s), `working: gather`. 07:32:55.883Z–07:35:44.827Z is ten `Cannot reach` iron_ore lines, then two more at 07:41:05.379Z and 07:41:25.438Z. In that first stand, `swimming up` is four lines, 07:32:39.632Z–07:32:41.870Z, air 5, 4, 3, then 5. No drown death.
- Zero `Left the tunnel` lines. Zero `craft failed 3 times; skipped` lines, as above.

## 2026-10-18 04:33–04:54 IST — units and integration (`84f6d70`)

`git pull --rebase` was already up to date at `84f6d70` (round 17: dig a pocket to toss junk into when boxed in, mine deeper and longer at night). Unit tests, every `tests/*.test.js` except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000 --test-skip-pattern resources`: **558 passed, 0 failed** (41.8 s). The note expected 549; nothing failed.

`Stop-Agent.ps1` could not reach `127.0.0.1:8766` (supervisor already down). The PIDs in `data/processes.json` (69624, 59648) were dead, and ports 8765, 8766, 8081, and 25569 were free, so `Start-Agent.ps1 -NoBrowser` ran with `AGENT_MODEL=off`. Supervisor log: `model server disabled (config.model.enabled=false)`.

`python -u tests/integration.py`, model off. Exit 0, 1066 s (04:36:17–04:54:03 IST). `All in-game integration tests passed`.

`Reflex paused the gather: Reflex: preempted by Mob Defense`. `PASS: A4 escaped the lava trench (hp 19.8, at [1652, -59, 1650])`.

## 2026-10-18 04:55–08:03 IST — dual soak (`a7ab088`, bot code `84f6d70`)

`AGENT_MODEL=off`, one soak, exit 0, 11286 s (23:25:43Z–02:33:47Z). `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Anchors this seed: hard [141, 131, 30] (scout printed canopy light 14), normal [310, 131, 30]. Interventions 4, resumes 0, deaths 0. Dashboard window used below is 23:25:44.561Z–02:33:35.046Z (1660 timestamped lines). The six runs are the six `Autopilot started` / `Autopilot stopped` pairs: normal1 23:28:52.078Z–00:09:00.239Z, normal2 00:09:12.032Z–00:49:21.444Z, normal3 00:49:33.426Z–01:29:41.900Z, hard1 01:29:56.373Z–01:51:00.672Z, hard2 01:51:12.423Z–02:12:16.440Z, hard3 02:12:28.228Z–02:33:32.239Z. After the stop, the flat world was restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, `difficulty=peaceful`, properties written 08:03:49 IST). Supervisor log still says the model server is disabled (`config.model.enabled=false`). No second soak.

The wood / stone-pick / furnace / iron-pick columns are the first sample that held the item. End predicates differ where the kit was gone at the bell: normal1 `wood` no and `stone` no (table 0, iron pick 0, stone pick still 1, furnace still 1), normal2 `stone` no (stone pick 0, iron pick 0, furnace still 1), hard2 `stone` no (furnace 0, iron pick still 1), hard3 `stone` no and `iron` no (furnace 0, iron pick 0).

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 181 | 271 | 542 | 18 | 2 at 903 | — | 0 | ate 1 (1 failed: the food bar did not rise) | 0 |
| normal2a2 | 150 | 211 | 271 | 421 | 16 | 2 at 723 | — | 0 | no food held (bar min 0) | 0 |
| normal3a3 | 90 | 211 | 301 | 391 | 16 | 2 at 722 | — | 0 | no food held (bar min 5) | 0 |
| hard1a1 | 90 | 150 | 271 | 482 | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard2a2 | 120 | 361 | 451 | 602 | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard3a3 | 151 | 271 | — | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |

### Deaths

Zero `Bot died` lines in the window, and none of `was slain`, `burned to death`, `drowned`, or `blew up`. The soak counter is 0. There is no 30 s slice to quote.

### Full bag

`waiting: bag full` is the soak status. Dashboard says `the bag is full; no crafting for 5 min, clearing junk first` three times: 00:02:10.930Z, 00:07:16.128Z, 00:38:13.120Z.

normal1 stood at [200, 47, -72] from t=1957 to the bell (t=2408, 451 s). Status `waiting: bag full (iron craft)` from t=2017 to t=2288 (271 s) and again t=2348 to t=2408 (60 s), with `backing off (3s): iron` at t=2318. Cobble stayed 288, then 285. In that stand the dashboard has eight `No room to toss cobblestone (open run 1)` lines, one a minute, 00:01:17.450Z through 00:08:16.602Z (419 s). No `Drop: dug a` line falls in that stand, and no `Dropped N` line does either. `stone_shovel craft failed 3 times; skipped for 10 min` at 00:01:57.790Z, during the same stand.

Three pockets, each `Drop: dug a 5-cell pocket east to toss into`, and each followed within 3 s by `Dropped cobblestone came back into the inventory`:

- 00:37:49.729Z then 00:37:52.427Z (normal2, 1717.7 s after Autopilot started, sample t=1716 at [233, -52, -123])
- 00:38:16.765Z then 00:38:19.479Z (same hole; the 00:38:13.120Z bag-full line is between them)
- 01:15:30.844Z then 01:15:33.524Z (normal3, 1557.4 s after Autopilot started, between samples y=-18)

The only tosses that completed were later, on open ground: 01:21:00.695Z `Dropped 291 cobblestone (toward 1,0, open 8)` and 01:21:52.629Z `Dropped 23 andesite (toward -1,0, open 8)`. Eight `came back into the inventory` lines in the window (seven cobblestone, one spruce sapling at 01:00:54.500Z). normal2's bag-full status is a single sample, t=1776, at [233, -52, -123], cobble 256.

### Night mine

All three hard runs logged `Night mine:`. None sat a hard night with no night-mine line.

- hard1, furthest rung the iron pick (482 s; furnace 271 s). Sealed at 01:39:57.104Z `(143, 140, 3)`. 01:40:19.828Z `Night mine: down from the shelter at (143, 140, 3) (tod 12616)`. 01:40:36.909Z `could not climb back into (143, 140, 3): Took to long to decide path to goal!`, then `walking the tunnel back by hand from (142, 140, 3)`, then `not back in the shelter (opened onto a cave at 144,138,4; 2 steps, 0 ore items, 0 wall digs)`. It resealed at (142, 140, 3) at 01:40:43.256Z and sat there from t=662 to the bell (t=1264, 602 s), hp 20. Deepest sample on the dig is y=138 (t=632, cobble 54). Cobble on the night samples went 51 → 54 → 47. Iron ore stayed 0, ingots stayed 2. No `Tunnel: mined` coal or iron line in this night. Dawn line 01:49:49.749Z `Shelter: dawn (tod 16)`.
- hard2, furthest rung the iron pick (602 s; furnace was held at 451 s and was gone at the bell). Sealed at 02:01:15.162Z `(146, 135, 6)`. 02:01:35.784Z `Night mine: down from the shelter at (146, 135, 6) (tod 12616)`. Samples on the way down: t=632 y=133 cobble 17, t=662 y=126 cobble 37, t=692 y=123 cobble 62 at [164, 123, 6]. 02:03:00.331Z `walking the tunnel back by hand from (172, 123, 6)`, 02:03:14.862Z `pillaring up the sump from y=133`, 02:03:17.669Z `back in the shelter (done; 27 steps, 0 ore items, 0 wall digs)`. Back at [146, 135, 6] from t=752 to the bell (512 s), hp 20, cobble 76 then 79. The dig gained cobble (16 at the seal to 78 on the way back) and 0 ore. Iron ore stayed 0. No coal line in this night. Dawn 02:11:05.715Z, morning 02:12:09.932Z `tod 1296`.
- hard3, furthest rung the stone pick (271 s). No furnace and no iron pick on this run. The first sample already held 4 ingots. Sealed at 02:22:27.329Z `(135, 138, 5)`. 02:22:50.719Z `Night mine: down from the shelter at (135, 138, 5) (tod 12600)`. 02:23:36.565Z `could not climb back into (135, 138, 5): Navigation made no progress at (135, 136, 5)`, then `pillaring up the sump from y=136`, then 02:23:37.764Z `back in the shelter (Staircase stalled at (134, 135, 5); 2 steps, 0 ore items, 0 wall digs)`. Deepest sample y=136, cobble still 12. It sat at [135, 138, 5] from t=692 to the bell (572 s), hp 20, cobble 12 until the last sample (t=1264, cobble 27). Iron ore stayed 0, ingots stayed 4. No coal line in this night. Dawn 02:32:20.601Z `tod 0`, morning 02:33:10.797Z `tod 1000`.

### Diamond trips

Three `gather diamond_ore` submits, each `targetY -53`, `strip:true`, count 3: 23:51:26.413Z (normal1), 00:27:34.730Z (normal2), 01:05:06.113Z (normal3). Diamonds held 0 on every sample. No `diamond_pickaxe` line. No `descent stopped`.

- normal1 diamond-rung samples walk y=157 down to y=29 (t=1355 to t=1927), diamonds 0. The run's lowest y is 29. No diamond pick.
- normal2 diamond-rung samples walk y=61 down to y=-48 (t=1114 to t=1686), diamonds 0, diamond pick 0. The next samples are the pocket above, y=-52, diamonds still 0. Did not reach y=-53.
- normal3 diamond-rung samples walk y=102 down to y=-17 (t=933 to t=1505), diamonds 0. Lowest y on the run is -18. 01:11:37Z, 01:11:41Z, and 01:11:46Z are three `no safe way down` staircase moves at y=2. 01:16:52.427Z `Could not climb back up the tunnel: Left the tunnel at (347, 2, -126) (330,-17,-107 is out of reach)`. No diamond pick.

### Bed

Zero `shears` lines, zero `wool` lines, zero `white_bed`, zero `Home set`, zero `Sleeping`. Bed 0 on every sample. normal1 killed sheep instead of shearing: a food fight at 23:33:46.181Z (2 hits) and two bed-rung hunts at 23:49:35.226Z and 23:50:31.030Z (2 hits each, both `Completed hunt`). 23:50:46.535Z `no sheep after 3 search legs; bed set aside for 10 min`. The same set-aside line is on normal2 at 00:25:23.018Z. normal3 submitted bed explores at 01:04:49Z and 01:24:06Z and never logged a bed craft.

### Bucket

Zero lines that name `water_bucket`. A bucket was crafted at 23:39:57Z, 00:19:36Z, and 01:00:16Z. The use at 23:41:08Z `(220, 62, 87)` logged no failure line. Fill failures: 00:20:03.194Z `(314, 114, 11)` out of reach 21.5, then `the bucket failed twice; no water fills for 15 min`; 01:00:43.387Z `(310, 115, 11)` clay in the way, a second use at 01:00:54Z `(317, 113, 17)`, then the same 15 min line at 01:01:03.247Z.

### Food

Lowest bar on a meal line is 14. Sample mins are 16, 0, 5, 20, 20, 20. The only meal that landed is normal1: `Food: meal failed - the food bar did not rise (2 tries)` at 23:47:12.281Z, then `Food: ate cooked_mutton (bar 14 -> 20)` at 23:47:18.932Z. Hunts that connected: one sheep (2 hits) and one pig (3 hits) at 23:33:46.181Z and 23:35:24.070Z, the two bed-rung sheep above, and one pig (3 hits) at 01:35:12.304Z on hard1 while the bar stayed 20. normal2's bar fell 15 → 0 from t=1024 to t=2047 and stayed 0 through the bell (t=2409). Hp was 1 from t=2107 to t=2409 (302 s). No death. normal3 ended at [315, 77, 110], bar 5, hp 18, no food held.

### Other loops

- The round-16 coal job did not repeat. `gather coal_ore` lines are spread through the window and are not an 8-line cluster.
- normal3, from 01:25:24.189Z to 01:29:34.718Z (251 s), the same food explore repeats 30 times: `explore` north, `surfaceCeiling 93`, `forFood true`. `Explore stopped early at (315, 77, 110)` is on 29 lines in that span. The bot was already on that cell from t=2198. Bar 5, hp 18, cobble 66, iron pick still held.
- `No room for crafting result` is three lines (00:02:10.407Z, 00:07:15.581Z, 00:38:12.342Z), each with a bag-full line, not a minutes-long craft loop.
- `Health or food is low` is five job lines from 00:41:57.131Z to 00:47:42.703Z (normal2, bar still above 0 at that point) and a one-second burst at 01:24:55Z (normal3). Zero `swimming up` lines.

## 2026-10-18 09:21–09:26 IST — combat (`a0bc73f`)

`git pull --rebase` was already up to date at `a0bc73f` (round 18: climb to the surface before a food search, step clear of tossed junk, say why a gather target is out of reach). Unit tests, every `tests/*.test.js` except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000 --test-skip-pattern resources`: **559 passed, 0 failed** (41.5 s). The note expected 550; nothing failed.

Services restarted with `AGENT_MODEL=off`. `Stop-Agent.ps1` saved the test world and stopped the services. Supervisor log: `model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit`.

`python -u tests/combat_integration.py`, model off. Exit 0, 310 s (03:51:35Z–03:56:40Z). `All combat acceptance tests passed`. One run.

`4_creeper` (lane): ttk 7.3 s, hits 5, `damage_taken=0`, end health 20, killed, no crater at the spawn, the midpoint, or the bot start. Dashboard: `Combat: pillar-up 2 at 1499,-60,1518 (creeper at 7.1)` at 03:53:23.582Z. Fight result at 03:53:30.289Z: `tactic=bow hits=5 shots=0 released=0 landed=0 damage taken=0`.

`4b_creeper_roofed`: ttk 7.2 s, hits 3, `damage_taken=0`, end health 20, killed, no crater. At 03:53:38.765Z `Combat: pillar-up 2 at 1496,-60,1497 (creeper at 7.8)`, then `pillar perched 2 up` at 03:53:39.540Z. Fight result at 03:53:44.590Z: `tactic=bow hits=3 shots=1 released=1 landed=1 damage taken=0`.

## 2026-10-18 09:29–12:17 IST — dual soak (`eadbb50`, bot code `a0bc73f`)

`AGENT_MODEL=off`, one soak, exit 0, 10060 s (03:59:32Z–06:47:11Z). `SOAK DONE (with errors)`. The results file was left unpromoted (`triple had errors (2); data/soak-results.json left untouched; full results in data/soak-results-20261018-121659.json`). Anchors this seed: hard [141, 131, 30] (canopy light 14), normal [310, 131, 30] (open sky 15). Interventions 9, resumes 2, deaths 2. Five valid runs. hard3 was attempted three times (`hard3a3`, `hard3a4`, `hard3a5`) and each was invalid: `dawn/clear weather not confirmed after retries (observe: timeOfDay=None weather=None)`. The harness printed `WARNING: fewer than 3 valid runs per anchor: {"normal": 3, "hard": 2}`. Dashboard window used below is 04:01:22.763Z–06:47:00.043Z (join through `Stopped by user`, 1844 timestamped lines). The five runs are the five `Autopilot started` / `Autopilot stopped` pairs: normal1 04:02:26.978Z–04:42:35.433Z, normal2 04:42:47.185Z–05:22:55.029Z, normal3 05:23:06.980Z–06:03:14.917Z, hard1 06:03:28.280Z–06:24:31.797Z, hard2 06:24:43.560Z–06:45:45.001Z. Between hard2's stop and `Stopped by user` the dashboard has no other line. After the stop, the flat world was restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, `difficulty=peaceful`, properties written 12:17:14 IST). Supervisor log still says `model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit`. No second soak.

The wood / stone-pick / furnace / iron-pick columns are the first sample that held the item. End predicates differ where the kit was gone at the bell: normal1 `stone` no (stone pick 0, furnace 0, iron pick 0, bed 0), normal2 `wood` no (table 0), normal3 `wood` no and `stone` no (wooden pick 0, stone pick 0, furnace 0, iron pick 0), hard2 `wood` no and `stone` no (pick 0, table 0, furnace 0, cobble 0). hard3 is absent from the table because no attempt was counted.

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 211 | 301 | 542 | 18 | 2 at 873 | 602 | 0 | ate 3 | 1 |
| normal2a2 | 90 | 181 | 271 | 391 | 16 | 2 at 692 | — | 0 | ate 1 | 0 |
| normal3a3 | 90 | 211 | 361 | 572 | 16 | 1 at 1023 | — | 0 | ate 3 | 1 |
| hard1a1 | 90 | 180 | 361 | — | 8 | 0 | — | 0 | not hungry (bar 20) | 0 |
| hard2a2 | 301 | — | — | — | 0 | 0 | — | 0 | not hungry (bar 20) | 0 |

hard2 also recorded two harness sample errors, both `sample error: 'position'`. Those are the two errors that kept the triple from being promoted.

### Deaths

Two deaths. The soak counter is 2.

normal1, 04:39:52.080Z `Bot died at 390, 55, 179`, cause `BuilderBot drowned`. The run had started at 04:02:26.978Z, so this is about t=2246. The 30 s before it:

- 04:39:26.972Z `gather log` count 3, then `Inventory nearly full; deposit items first`
- 04:39:29.737Z `WorldSurvival: drowning (air 4), swimming up`
- 04:39:31.760Z `WorldSurvival: drowning (air 2), swimming up`
- 04:39:34.997Z `wood failed 3 times; exploring before retry`, explore `surfaceY 54`
- 04:39:38.674Z `No path to the goal!`
- 04:39:43.217Z the same log gather, again `Inventory nearly full; deposit items first`
- 04:39:47.476Z `Food: ate cooked_mutton (bar 17 -> 20)`
- 04:39:49.300Z `WorldSurvival: drowning (air 0), swimming up`
- 04:39:52.079Z `BuilderBot drowned`

Autopilot restarted at 04:40:04.873Z (`resumes=1` on this run). Sample bars on the run stay 15–20 and sample hp stays 18.4–20; the death itself sits between samples.

normal3, 06:01:43.881Z `Bot died at 381, -54, 107`, cause `BuilderBot burned to death`. The run had started at 05:23:06.980Z, so this is about t=2257. The 30 s before it:

- 06:01:17.703Z `gather iron_ore` count 6 `targetY 16`, then `Inventory nearly full; deposit items first`
- 06:01:25.752Z `iron failed 3 times; exploring before retry`, explore distance 64
- 06:01:31.048Z through 06:01:37.170Z the same explore is preempted and resumed six times by `Misc World Survival Chain` (about one preempt a second)
- 06:01:33.697Z `Bucket-into-lava skipped: Job interrupted`
- 06:01:37.177Z `Health or food is low`
- 06:01:43.880Z `BuilderBot burned to death`

Autopilot restarted at 06:01:44.545Z. The next meal is 06:01:45.290Z `Food: ate cooked_porkchop (bar 19 -> 20)`. Sample bars on the run stay 15–20 and sample hp stays 20. The lowest sample y is -46; the death is at y=-54, between samples.

### Ascend

Zero `Ascend:` lines in the window, and zero jobs whose type is `ascend`. There is no from/to y to report, and no food job or meal followed an ascend because none ran.

The food explores that did run were surface searches: 04:08:01.184Z and 04:08:11.660Z (`forFood true`, surface floors 116 and 115) on normal1, and three more at 04:47:20.581Z, 04:47:28.854Z, and 04:47:37.004Z (`surfaceFloor 131`) at the start of normal2. Meals landed later with the bar still in the teens: `cooked_mutton` 14 to 20 at 04:30:15.490Z and 04:36:31.039Z, `cooked_mutton` 17 to 20 at 04:39:47.476Z, `glow_berries` 14 to 16 at 05:21:55.393Z, `cooked_porkchop` 14 to 20 at 05:41:09.770Z, `cooked_beef` 14 to 20 at 05:58:48.914Z, and the post-death porkchop above.

Sample food mins are 15, 14, 15, 20, 20. Sample hp mins are 18.4, 20, 20, 20, 20. No sample has a bar at or under 6, so that span is 0 s. The underground time (normal1 down to y=-51, normal3 down to y=-46, the burn at y=-54) was diamond, iron, and wood steps, with the bar still 14–20, which is the stretch where a food-step climb would have had to start.

### Full bag

Zero `Drop: dug a` lines. No pocket was dug.

`came back into the inventory` is nine lines: cobblestone at 04:16:45.636Z, 04:27:46.675Z, 04:27:59.647Z, and 04:29:00.028Z; granite at 05:19:05.929Z; dirt at 05:36:47.288Z and 05:43:34.889Z; diorite at 05:49:23.748Z; gravel at 06:00:09.893Z. None of those follows a pocket line.

Tosses that completed, on open ground: 04:34:46.276Z `Dropped 65 tuff`, 04:34:54.035Z `Dropped 64 cobblestone`, 04:34:59.026Z `Dropped 65 tuff`, 05:18:54.790Z `Dropped 448 cobblestone`, 05:19:01.886Z `Dropped 52 gravel`, 05:35:30.277Z `Dropped 34 cobblestone`, 05:43:27.226Z `Dropped 241 cobblestone`, 05:49:15.284Z `Dropped 59 dirt`, 05:49:19.685Z `Dropped 76 cobblestone`, then smaller granite, sapling, gravel, andesite, and cobble drops through 06:00:06.026Z `Dropped 22 cobbled_deepslate`.

`the bag is full; no crafting for 5 min, clearing junk first` is six lines: 04:27:55.525Z (normal1), 05:08:05.706Z, 05:13:07.401Z, and 05:18:09.407Z (normal2), 05:43:23.577Z and 05:49:38.293Z (normal3).

`waiting: bag full` from the samples:

- normal1, one sample, t=1565, at [299, -32, 128], `waiting: bag full (stone craft)`, cobble 192. The next sample is already `backing off` and cobble has fallen to 71.
- normal2, at [361, 17, -151], cobble stuck at 474: t=1535 to t=1805 (270 s) and t=1866 to t=2106 (240 s), both `waiting: bag full (stone craft)`, with `backing off (1s): stone` at t=1836 between them. `No room to toss cobblestone (open run 1)` repeats once a minute from 05:08:05.769Z through 05:17:09.080Z, after an `open run 0` line at 05:07:49.636Z. The 448-cobble drop at 05:18:54.790Z is what ends that stand.
- normal3, single samples at t=1625, 1685, 1746, 1806, and 1866, all at [413, 0, 187], `waiting: bag full (iron craft)`, cobble 64. Those are 60 s apart and not a continuous stand.

### Cannot reach

356 `Cannot reach or harvest` lines in the window. 10 gather attempts (20 lines, each attempt plus its `skipping` twin) carry `(walk: ...)`. The other 336 lines have no walk clause. The walk text is cut at 50 characters, which is why the timeout lines end in `(onGround tr`.

Grouped by that walk error:

- `No path to the goal!` — 5 attempts. 06:08:51.119Z stone at (144, 127, 31), bot at (152, 128, 41), 13.6 away (hard1). 06:26:24.026Z dark_oak_log at (132, 126, 39), bot at (135, 125, 28), 11.1 away; 06:26:25.041Z dark_oak_log at (131, 127, 39), same cell, 11.5 away; 06:26:25.999Z dark_oak_log at (131, 126, 39), same cell, 11.4 away (hard2). 06:34:21.578Z grass_block at (143, 130, 28), bot at (143, 137, 32), 8.3 away (hard2).
- `Navigation timed out at (...) (onGround tr` — 4 attempts, all iron_ore. 04:15:42.799Z ore at (357, 44, 84), bot at (354, 57, 91), 15.2 away. 05:38:01.492Z ore at (338, 54, 79), bot at (344, 54, 75), 7.5 away. 05:38:21.592Z ore at (357, 44, 84), bot at (345, 49, 74), 15.7 away. 05:41:14.042Z ore at (349, 60, 76), bot at (345, 61, 67), 9.5 away.
- `Navigation left the surface at (135, 126, 29)` — 1 attempt. 06:25:23.448Z dark_oak_log at (138, 134, 22), bot at (135, 126, 29), 11.0 away.

### Hard runs

hard1 furthest rung is the furnace (361 s; stone pick 180 s, wooden pick 90 s). No iron pick. It stood at [152, 128, 41] from t=331, including a food fight from t=391 to t=572 with the bar at 20. 06:13:32.139Z `Shelter: sealed at (152, 128, 41)`. 06:13:50.936Z `Night mine: down from the shelter at (152, 128, 41) (tod 12605)`. Samples on the way down: t=632 y=126 cobble 11, t=662 y=120 cobble 29, t=692 y=116 cobble 54 at [152, 116, 58]. 06:15:06.120Z `Night mine: could not climb back into (152, 128, 41): No path to the goal!`, then `walking the tunnel back by hand from (152, 116, 59)`, then 06:15:13.527Z `not back in the shelter (opened onto a cave at 151,117,60; 20 steps, 0 ore items, 0 wall digs)`. It resealed at (152, 116, 53) at 06:15:17.612Z and sat there from t=722 to the bell (t=1263), hp 20, cobble 53, iron ore 0. Cobble on the dig went 11 to 54. Dawn 06:23:20.982Z `Shelter: dawn (tod 5)`.

hard2 furthest rung is the wooden pick (301 s). The stone pick, the furnace, and the iron pick never appeared, and cobble stayed 0 on every sample. From 06:24:58.187Z to 06:29:50.685Z, `Cannot reach or harvest` on dark_oak_log is 83 attempts (about 292 s), mostly with no walk clause; the four walk lines quoted above fall in that span and the minute after it. It then stood at [141, 133, 30] from t=271 to t=571 (wood, then stone, then dusk-dirt) with cobble still 0. 06:34:39.879Z `Shelter: Short of shelter blocks: 0 held, 14 needed at (143, 137, 32); night pillar instead`, and 06:34:40.164Z `the night job failed (...); night pillar until morning`. No `Night mine:` line on this run. It sat at [143, 140, 32] from t=632 to t=1143 (511 s), status `night: no shelter; holding for morning`, hp 20, cobble 0, iron ore 0. The last samples (t=1173, t=1201) are `queued: gather` on stone, still there, still cobble 0.

hard3 did not run. Three setup attempts, each with `timeOfDay=None` and `weather=None`, and the dashboard is empty from 06:45:45.001Z until 06:47:00.043Z.

### Diamond trips

Two `gather diamond_ore` submits, each `targetY -53`, `strip:true`, count 3: 04:18:35.684Z (normal1) and 04:57:48.934Z (normal2). normal3 never submitted one. Diamonds held 0 on every sample. No `diamond_pickaxe` line. No `descent stopped` line.

- normal1 diamond-rung samples walk y=44 down to y=-50 (t=993 to t=1475), diamonds 0, at x=358 falling to x=286, z=115. The next sample (t=1505) has left the rung for `backing off: inventory` at y=-33. The run's lowest y is -51, later, on an iron explore at [441, -51, 104] (t=1866), diamonds still 0. The y=-53 strip was not reached. No diamond pick. Bed stayed 1 through these samples.
- normal2 diamond-rung samples walk y=164 down to y=17 (t=903 to t=1475), diamonds 0. 05:00:33.478Z and 05:00:37.676Z are `no safe way down` staircase moves at y=127. 05:07:48.975Z `Could not climb back up the tunnel: Time limit reached`. The next samples are the bag-full stand at [361, 17, -151]. Did not reach y=-53. No diamond pick.

### Bed

normal1 crafted a black bed: submit 04:12:00.361Z, `Completed craft` 04:12:08.325Z. Bed is 1 on the samples from t=602 through the underground samples, including the diamond rung. Zero `Home set` lines. Zero `Sleeping` lines. The end inventory has bed 0, after the drown emptied it. normal2 at 04:57:17.210Z `no sheep after 3 search legs; bed set aside for 10 min`. Bed 0 on the other four valid runs. Sheep fights on normal1 were food hunts (3, 3, and 2 hits at 04:07:46.404Z, 04:08:35.590Z, and 04:09:21.873Z), before the bed craft.

### Bucket

Zero lines that name `water_bucket`. A bucket was crafted at 04:12:57.995Z, 04:51:32.961Z, and 05:34:28.546Z. The use at 04:13:07.196Z `(352, 68, 86)` reached `Completed use` at 04:13:20.697Z and logged no failure line. The use at 05:34:56.831Z `(352, 67, 84)` failed at 05:35:25.676Z: `Filling the bucket at (352, 67, 84) produced no water bucket (3 tries; no change after the use)`. A second use was submitted at 05:35:34.561Z `(353, 66, 77)`. `MLG Water Bucket Fall Chain` engaged at 04:30:35.810Z, 04:39:17.609Z, 05:36:06.670Z, 05:42:17.444Z, and 05:47:46.754Z. The lava death above logged `Bucket-into-lava skipped: Job interrupted`.

### Other loops

- normal2's `No room to toss cobblestone` line, once a minute from 05:07:49.636Z to 05:17:09.080Z, while the bot stood on [361, 17, -151]. That is the long bag-full stand above. It ended when the 448-cobble drop landed.
- hard2's dark-oak refusals, 83 attempts from 06:24:58.187Z to 06:29:50.685Z, then the 511 s hold at [143, 140, 32] with no night-mine line.
- hard1, after the failed climb home, sat at [152, 116, 53] from t=722 to the bell. The dashboard between the reseal (06:15:17.612Z) and dawn (06:23:20.982Z) has no further job line.
- The coal-job repeat from earlier rounds did not show up. `No room for crafting result` is not a minutes-long cluster in this window.

## 2026-10-18 12:40–12:58 IST — units and integration (`0e8fb13`)

`git pull --rebase` was already up to date at `0e8fb13` (round 19: a drowning escape that holds while bobbing, clear a nearly full bag, never resume a job into a hazard, no cave explores deep down). Unit tests, every `tests/*.test.js` except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000 --test-skip-pattern resources`: **561 passed, 0 failed** (41.3 s). The note expected 552; nothing failed.

Services restarted with `AGENT_MODEL=off`. `Stop-Agent.ps1` saved the test world and stopped the services. `Start-Agent.ps1 -NoBrowser` then brought the dashboard up. Supervisor log: `model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit`.

`python -u tests/integration.py`, model off. Exit 0, 1064 s (12:40:38–12:58:22 IST, 07:10:38Z–07:28:22Z). `All in-game integration tests passed`.

`Reflex paused the gather: Reflex: preempted by Mob Defense`. Dashboard at 07:26:34.924Z: `Pause trace: gather -> Reflex: preempted by Mob Defense`, then 07:26:36.215Z `Reflex: resumed the gather job` and 07:26:45.775Z `Completed gather`. `PASS: A4 escaped the lava trench (hp 19.8, at [1648, -59, 1648])`. The dashboard shows the escape start at 07:28:20.241Z `Reflex: Misc World Survival Chain engaging`, after a teleport to (1648, -60, 1647).

## 2026-10-18 13:03–16:11 IST — dual soak (`3577f3a`, bot code `0e8fb13`)

`AGENT_MODEL=off`, one soak, exit 0, 11280 s (13:03:42–16:11:42 IST, 07:33:42Z–10:41:42Z). `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Anchors this seed: hard [142, 131, 31] (canopy light 10), normal [310, 131, 30] (open sky 15). Interventions 26, resumes 0, deaths 0. Six valid runs. hard3 started: `--- soak run hard3a3/3: dawn, clear weather, empty inventory, full vitals, spawn [142, 131, 31]`. There was no `dawn/clear weather not confirmed` line and no `timeOfDay=None`. Dashboard window used below is 07:33:43.058Z–10:41:31.404Z (`Stopped by user` through `Disconnected`, 1289 timestamped lines). The six runs are the six `Autopilot started` / `Autopilot stopped` pairs: normal1 07:36:55Z–08:17:02.475Z, normal2 08:17:14.302Z–08:57:20.908Z, normal3 08:57:32.665Z–09:37:39.220Z, hard1 09:37:53.800Z–09:58:57.457Z, hard2 09:59:09.240Z–10:20:13.004Z, hard3 10:20:24.877Z–10:41:28.597Z. After the stop, the flat world was restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, `difficulty=peaceful`, properties written 16:11:45 IST). Supervisor log still says `model server disabled (config.model.enabled=false)`. No second soak.

The wood / stone-pick / furnace / iron-pick columns are the first sample that held the item. Five runs never held a wooden pick. Peak logs on those runs were 0, 0, 2, 1, and 1.

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 211 | 271 | 391 | 19 | 2 at 722 | — | 0 | no food held (food min 14) | 0 |
| normal2a2 | — | — | — | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 0 |
| normal3a3 | — | — | — | — | 0 | 0 | — | 0 | not hungry enough (food min 17) | 0 |
| hard1a1 | — | — | — | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 0 |
| hard2a2 | — | — | — | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 0 |
| hard3a3 | — | — | — | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 0 |

### Deaths

Zero `Bot died` lines in the window, and none of `drowned` or `burned`. The soak counter is 0. There is no 30 s slice to quote.

### Drowning

Zero `swimming up` lines, and zero `WorldSurvival: drowning` lines. The bot did not drown. The drowning latch was not exercised on this soak.

### Full bag

`Inventory nearly full` is four job lines, all on normal1. Each one is followed at once by `the bag is full; no crafting for 5 min, clearing junk first` and a drop job.

- 08:01:11.967Z, then a cobblestone drop. 08:01:32.450Z `Drop: dug a 5-cell pocket east to toss into`, and 08:01:35.840Z `Dropped cobblestone came back into the inventory`.
- 08:02:52.725Z, then a furnace smelt (`took 5 iron_ingot`) and `The furnace drop was not collected`.
- 08:09:51.579Z, then `Dropped 33 cobbled_deepslate (toward 0,-1, open 8)` at 08:09:55.989Z, which completed. 08:10:00.679Z `cobbled_deepslate dropped twice in 3 min; inventory step set aside for 5 min`.
- 08:10:00.718Z, then `Dropped 8 gravel (toward 0,-1, open 8)` at 08:10:04.845Z, which completed.

A fifth bag-full line, 08:06:14.240Z, follows `No room for crafting result` at 08:06:13.328Z. That drop dug a pocket (below) and the cobbled deepslate came back.

`waiting: bag full` from the samples, all on normal1, all at the same hole:

- t=1505, one sample, at [363, -6, 190], `waiting: bag full (stone craft)`, cobble 256.
- t=1625 to t=1715 (90 s), same cell, `waiting: bag full (stone craft)`, cobble 128.
- t=1806 to t=1896 (90 s), at [358, -14, 191], `waiting: bag full (iron craft)`, cobble 64.

The other five runs have no `waiting: bag full` sample.

### Pocket

Four `Drop: dug a 5-cell pocket east to toss into` lines. Each is followed within 3 s by `came back into the inventory`.

- 07:50:47.490Z, spruce sapling back at 07:50:50.169Z.
- 08:01:32.450Z, cobblestone back at 08:01:35.840Z.
- 08:03:47.082Z, cobblestone back at 08:03:49.744Z, and again at 08:04:34.970Z.
- 08:06:29.200Z, cobbled deepslate back at 08:06:32.741Z and 08:06:37.842Z.

Tosses that completed, after those pockets: 07:49:47.590Z `Dropped 2 spruce_sapling`, 08:02:17.854Z `Dropped 192 cobblestone (toward 1,0, open 5)`, 08:05:35.490Z `Dropped 64 cobblestone`, 08:07:37.305Z `Dropped 21 cobbled_deepslate`, 08:08:38.731Z `Dropped 8 andesite`, then the 33 cobbled deepslate and the gravel drops above, and 08:10:13.276Z `Dropped 2 spruce_sapling`. Zero `No room to toss` lines and zero `open run` lines.

### Hazard cancel and deep underground

`led into a hazard; cancelled` is two lines, both on hard3, and both sit under a second after a harness unstuck teleport. The dashboard does not name water, lava, or fire on either.

- 10:27:26.241Z `Server set position to (153, 137, 34)` (the lift from [151, 133, 32]), World Survival engages, and 10:27:27.793Z `Reflex: the gather job led into a hazard; cancelled, not resumed`. The next gather is a new wood submit at 10:27:27.702Z.
- 10:28:56.541Z `Server set position to (155, 141, 36)` (the lift from [153, 137, 34]), and 10:28:57.904Z the same cancel.

`failed 3 times deep underground; no cave explore` is seven lines, all `iron`, from 08:11:03.963Z to 08:16:32.741Z (about 46 s apart). The bot was already at [382, -16, 141]. It was still there at the bell (t=2407). No cave explore ran in that stretch.

### Ascend

Eight `Ascend:` lines, all on normal1, all in the same 38 s, and the climb did not reach the surface (surface 122).

- 08:11:24.058Z `Ascend: path up stopped (Took to long to decide path to goal!)` and `Ascend: y=-19 -> -16 (surface 122)`.
- 08:11:36.932Z, 08:11:49.909Z, and 08:12:02.015Z each `Ascend: path up stopped (Navigation made no progress at (382, -16, 141) (last path: n)` with `Ascend: y=-16 -> -16 (surface 122)`, and each has `Could not climb toward the surface from y=-16`.

Samples from t=2076 to t=2407 stay at [382, -16, 141], step `food` then `iron`, bar 14, eaten 0. Zero `Food: ate` lines in the window.

### Cannot reach

450 `Cannot reach or harvest` lines: 225 gather attempts plus the skipping twin of each. Zero of them say `walk ok`. Every attempt carries a walk error.

Grouped by that walk error:

- `Navigation made no progress at (...)` — 198 attempts. normal2 81 spruce_log, normal3 96 spruce_log, hard2 5 dark_oak_log, hard3 16 dark_oak_log. Sample: 08:17:39.347Z spruce_log at (335, 132, 29), bot at (312, 128, 32), 23.2 from the eye (normal2, and the same cell again on normal3 at 08:57:57.848Z). Dark oak: 10:02:21.442Z at (154, 126, 70), bot at (142, 129, 31), 40.8 (hard2); 10:25:00.292Z at (139, 135, 23), bot at (143, 131, 28), 7.3 (hard3).
- `Navigation left the surface at (...)` — 17 attempts, all dark_oak_log. hard1 8, hard2 1, hard3 8. Sample: 09:39:40.670Z at (141, 131, 31), bot at (153, 126, 59), 30.8 (hard1); 10:22:11.594Z at (141, 136, 31), bot at (153, 126, 59), 31.5 (hard3).
- `Navigation timed out at (...) (onGround ...)` — 10 attempts. normal2 3 spruce, normal3 3 spruce, hard2 3 dark oak, hard3 1 dark oak. Sample: 08:24:30.974Z spruce_log at (330, 106, 62), bot at (331, 98, 57), 8.5 (normal2); 10:26:08.492Z dark_oak_log at (138, 135, 22), bot at (151, 133, 32), 16.7 (hard3).

Dark-oak attempts on the hard runs are 42, and every one is in those three walk-error groups. None says `walk ok`. The closest sample is the 7.3 eye distance above, and the walk still made no progress.

### Hard runs

hard3 did start, on a confirmed dawn and clear sky. None of the three hard runs logged `Night mine:`. None held a wooden pick. Furthest held item is a log (peak 2, 1, and 1).

- hard1 furthest rung is short of the wooden pick (logs peaked at 2). Sealed at 09:48:44.982Z `(142, 129, 31)` (`3 blocks placed`). Dawn 09:57:47.226Z `Shelter: dawn (tod 18)`. Morning 09:58:37.040Z `Shelter: morning (tod 1018, nearest hostile 19.3); opening up`. The last sample (t=1264) is `queued: gather` at [141, 129, 31], hp 20, cobble 0. It sat sealed from the seal to morning. The harness lifted it once off [142, 131, 31] and returned it once from y=108.
- hard2 furthest rung is the same (logs peaked at 1, planks peaked at 4, wooden pick 0). 10:09:51.484Z `Shelter: Short of shelter blocks: 4 held, 7 needed at (142, 128, 31); night pillar instead`, then `night pillar until morning`. No `Night mine:` line. The last sample is back at [142, 131, 31] on `working: gather`, planks 4, cobble 0. The harness returned it from y=122 and from y=120.
- hard3 furthest rung is the same (logs peaked at 1, planks 4 at the bell, wooden pick 0). The two hazard cancels above are on this run. Sealed at 10:31:14.323Z `(155, 141, 36)` (`3 blocks placed`), which is the second unstuck lift. Samples from t=843 to the bell (t=1264) stay at [155, 141, 36], `working: shelter`, hp 20, cobble 0. Dawn 10:40:17.993Z `Shelter: dawn (tod 16); staying sealed until the morning is light and clear`. The stop is 10:41:28.597Z, and there is no morning-open line. No `Night mine:` line.

### Diamond trips

One `gather diamond_ore` submit, 07:54:07.909Z, `targetY -53`, `strip:true`, count 3, on normal1. normal2, normal3, and the hard runs never submitted one. Diamonds held 0 on every sample. No `diamond_pickaxe` line.

The trip walked to y=-14. 08:00:54.192Z, 08:00:58.890Z, and 08:01:04.740Z are three `no safe way down` staircase moves at y=-14. 08:01:04.743Z `descent stopped at y=-14` (cave opening under the floor, `no safe way on`). The y=-53 strip was not reached. The run's lowest sample is later, [356, -26, 186] at t=1986, on `iron: gather`, diamonds still 0. The sample before it (t=1956) is [358, -24, 184], `working: use`.

### Bed

Zero `Home set` lines. Zero `Sleeping` lines. Zero bed crafts. Bed 0 on every sample. normal1 at 07:53:37.203Z `no sheep after 3 search legs; bed set aside for 10 min`, after two bed explores (07:51:40.338Z and 07:53:09.954Z).

### Bucket

Zero lines that name `water_bucket`. A bucket was crafted at 07:46:36.027Z. The use at 08:09:19.268Z `(360, -25, 184)` failed at 08:09:38.367Z: `Filling the bucket at (360, -25, 184) produced no water bucket (3 tries; no change after the use)`. A second use was submitted at 08:09:38.453Z `(353, -28, 184)` and logged `Completed use` at 08:09:50.813Z, with no second failure line and no `water_bucket` line. There is no `the bucket failed twice` line.

### Other loops

- normal2 and normal3 stood on the wood gather. normal2 has 81 spruce failures and normal3 has 96, almost all `Navigation made no progress` with the bot at (312, 128, 32) and the log 23 away at (335, 132, 29). The harness unstuck that cell and returned the bot from y=98 or y=97 three times on each run (the return cap). After the third return both runs stayed down: the last sample of each is [331, 97, 57], still `working: gather` on wood, logs 0.
- normal1, after the ascend stalled, repeated `iron failed 3 times deep underground; no cave explore` seven times from 08:11:03.963Z to 08:16:32.741Z while standing on [382, -16, 141]. That is the rest of the run.
- hard1 sat sealed from 09:48:44.982Z until morning at 09:58:37.040Z. hard3 sat sealed from 10:31:14.323Z through the bell. The dashboard in those spans has no night-mine line.

## 2026-10-18 16:32–16:37 IST — units and combat (`f99d6d7`)

`git pull --rebase` was already up to date at `f99d6d7` (round 20: never wedge the pathfinder on a null block; clear a stale digging flag after every walk). Unit tests, every `tests/*.test.js` except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000 --test-skip-pattern resources`: **562 passed, 0 failed** (43.0 s). The note expected 553; nothing failed.

Services restarted with `AGENT_MODEL=off`. `Stop-Agent.ps1` saved the test world and stopped the services. The old test-server and dashboard PIDs were dead, and 8765/8766/8081/25569 were not listening. `Start-Agent.ps1 -NoBrowser` then brought the dashboard up. Supervisor log: `model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit`.

`python -u tests/combat_integration.py`, model off. Exit 0, 313 s (16:32:38–16:37:50 IST, 11:02:38Z–11:07:50Z). `All combat acceptance tests passed`. One run.

`4_creeper` (lane): ttk 7.4 s, hits 5, `damage_taken=0`, end health 20, killed, no crater at the spawn, the midpoint, or the bot start. Dashboard: `Combat: pillar-up 2 at 1499,-60,1518 (creeper at 7.3)` at 11:04:31.059Z, then `pillar perched 2 up` at 11:04:31.882Z, then `perch 2 up is inside the fuse ring; knocking the creeper back (at 3.6)` and three `pillar-strike` lines. Fight result at 11:04:37.714Z: `tactic=bow hits=5 shots=0 released=0 landed=0 damage taken=0`.

`4b_creeper_roofed`: ttk 5.3 s, hits 2, `damage_taken=0`, end health 20, killed, no crater. At 11:04:46.358Z `Combat: pillar-up 2 at 1496,-60,1497 (creeper at 8.0)`, then `pillar perched 2 up` at 11:04:47.108Z. Two arrows released (3.03 and 3 b/t) and both landed. Fight result at 11:04:50.908Z: `tactic=bow hits=2 shots=2 released=2 landed=2 damage taken=0`.

The witch leg printed `NOTE: witch survived the duel (job failed, lost 0 hp)` and the suite still exited 0. That is the recorded 26.3 limit, not a suite failure.

## 2026-10-18 16:40–19:48 IST — dual soak (`beab1e1`, bot code `f99d6d7`)

`AGENT_MODEL=off`, one soak, exit 0, 11310 s (16:40:00–19:48:28 IST, 11:10:00Z–14:18:28Z). `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Anchors this seed: hard [142, 131, 31] (canopy light 10), normal [310, 131, 30] (open sky 15). Interventions 7, resumes 2, deaths 2. Six valid runs. Dashboard window used below is 11:10:01.279Z–14:18:16.061Z (`Stopped by user` through `Disconnected`, 2733 timestamped lines). The six runs are the six `Autopilot started` / `Autopilot stopped` pairs: normal1 11:13:36.718Z–11:53:43.768Z (a second `Autopilot started` at 11:41:41.538Z is the resume after the warden death), normal2 11:53:55.659Z–12:34:03.078Z, normal3 12:34:14.923Z–13:14:22.991Z (a second start at 13:07:21.556Z is the resume after the drown), hard1 13:14:37.071Z–13:35:40.916Z, hard2 13:35:52.732Z–13:56:57.639Z, hard3 13:57:09.372Z–14:18:13.267Z. After the stop, the flat world was restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, `difficulty=peaceful`, properties written 19:48:31 IST). Supervisor log still says `model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit`. No second soak.

The wood / stone-pick / furnace / iron-pick columns are the first sample that held the item. **All 6 runs made a wooden pick.** Round 19 was 1 of 6. End `wood` is no where the table was gone at the bell: normal1 (table 0, wooden pick still 1), normal3 (table 0, wooden pick 1), hard1 (table 0, wooden pick 1).

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 211 | 301 | 511 | 16 | 2 at 872 | — | 0 | ate 1 | 1 |
| normal2a2 | 90 | 211 | 301 | 722 | 16 | 3 at 1053 | — | 0 | ate 2 | 0 |
| normal3a3 | 241 | 361 | 422 | 572 | 16 | 2 at 994 | — | 0 | ate 1 | 1 |
| hard1a1 | 90 | 241 | — | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 0 |
| hard2a2 | 332 | 392 | 512 | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 0 |
| hard3a3 | 211 | 331 | 451 | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 0 |

### Deaths

Two deaths. The soak counter is 2.

normal1, 11:41:33.304Z `Bot died at 234, -33, 96 (killed by warden)`. The line before it is 11:41:33.300Z `BuilderBot was obliterated by a sonically-charged shriek`. The run had started at 11:13:36.718Z, so this is about t=1677. The 30 s before it:

- 11:41:11.587Z `use` bucket at (213, -42, 93), then 11:41:11.661Z `No path to the goal!`
- 11:41:12.633Z `no sheep after 3 search legs; bed set aside for 10 min`
- 11:41:20.796Z `gather diamond_ore` `targetY -53`
- 11:41:20.798Z through 11:41:32.925Z, thirteen `deepslate_diamond_ore` attempts, every one `walk ok`, bot standing at (234, -33, 96), eye distance 11.7 to 18.6

normal3, 13:06:51.648Z `BuilderBot drowned` and `Bot died at 239, 60, 83`. The run had started at 12:34:14.923Z, so this is about t=1957. The 30 s before it:

- 13:06:22.420Z drop 11 cobblestone, then 13:06:26.832Z `Dropped cobblestone came back into the inventory`
- 13:06:27.471Z `no sheep after 3 search legs; bed set aside for 10 min`, then 13:06:27.489Z `Explore stopped early at (239, 60, 83)`
- 13:06:35.547Z `gather coal_ore` refused `Inventory nearly full; deposit items first`
- 13:06:43.604Z `the bag is full; no crafting for 5 min, clearing junk first`
- 13:06:43.627Z `Tool left the inventory: stone_shovel (43 uses left)`
- 13:06:43.628Z `No room to toss cobblestone (open run 3)`

Zero `swimming up` lines and zero `WorldSurvival: drowning` lines in the window. The death text is still `BuilderBot drowned`.

### Pathfinder wedge

`Navigation made no progress` is 2 lines, both on normal1. Neither says `last path: none`.

- 11:30:09.843Z `Navigation made no progress at (287, 92, 60) (last path: success, 35 steps, 256 nodes)`
- 11:49:33.631Z smelt walk-back `Navigation made no progress at (140, 143, -48) (last path: s)`

Per run: normal1 2, normal2 0, normal3 0, hard1 0, hard2 0, hard3 0. Zero lines contain `last path: none`. No run repeats that phrase for minutes. The round-19 wedge (198 of those lines, then every later run stuck) did not return. The other `last path:` text in the window is a timeout truncated to `parti` or `part` (iron at 12:02:46.945Z, stone at 13:43:19.251Z and 13:43:39.350Z), one line each plus its skipping twin.

`logs/dashboard-uncaught.log` gained no bytes during the soak (size stayed 2576174). Its last timestamp is 2026-10-16T09:10:15.319Z, which is outside this window. There is no line to quote from the soak window.

### Ascend

Zero `Ascend:` lines. Four meals, each `Food: ate cooked_chicken (bar 14 -> 20)`, with no climb in front of them: 11:52:39.546Z (normal1), 12:15:44.593Z and 12:23:10.658Z (normal2), 12:54:34.552Z (normal3).

### Full bag

Zero soak samples say `waiting: bag full`. The dashboard line `the bag is full; no crafting for 5 min, clearing junk first` is 100 times.

The long one is normal2, 12:11:03.142Z to 12:23:37.515Z (754 s), the same line alternating with `Dropped 30 cobblestone` and `Dropped 2 gravel`, and with `iron failed 3 times deep underground; no cave explore` (11 of those, 12:11:40.550Z to 12:23:37.515Z). Samples stay on [281, 92, 41] from t=1053 to t=1745 (692 s), `inventory` drop and `iron` gather, cobble bouncing between 64 and 94. Later shorter bursts: 12:29:19.825Z, 12:31:51.593Z, 12:32:11.810Z, and four lines from 12:33:23.444Z to 12:33:47.669Z.

normal3 stands on [256, 69, 60] from t=1325 to t=1896 (571 s), `backing off: iron`, cobble 64. The matching log is `Inventory nearly full` plus `iron failed 3 times deep underground; no cave explore` from 12:56:34.828Z to 13:05:39.819Z (16 of those lines). The drown above is the end of that stand.

### Pocket

Five `Drop: dug a 5-cell pocket` lines. Three are followed within 4 s by `came back into the inventory`.

- 11:26:00.582Z east, cobblestone back at 11:26:04.310Z.
- 11:40:28.824Z south, then 11:40:32.787Z `Dropped 254 cobblestone` and 11:40:37.402Z `Dropped 26 cobbled_deepslate`. No came-back on that pocket.
- 11:53:27.445Z east, then 11:53:31.156Z `Dropped 48 dirt` and 11:53:35.894Z `Dropped 17 pink_petals`. No came-back on that pocket.
- 12:49:37.158Z east, dirt back at 12:49:39.799Z.
- 12:50:47.936Z east, cobblestone back at 12:50:50.593Z.

Other came-backs with no pocket on the same toss: cobblestone 12:09:07.294Z and 12:23:43.313Z, gravel 12:11:29.422Z and 12:32:02.855Z, diorite 12:32:23.541Z, pink petals 12:44:20.894Z, dirt 12:48:14.643Z, cobblestone 13:06:26.832Z (the line in the drown's 30 s).

### Cannot reach

148 gather attempts (297 lines with the skipping twin). 142 say `walk ok`. 6 carry a walk error.

- `walk ok` — normal1 13, normal2 24, hard1 39, hard2 20, hard3 46.
- `Navigation timed out at (...) (onGround ...)` — 3 attempts. normal2 1 iron_ore at 12:02:46.945Z, ore (281, 92, 45), bot at (284, 92, 54), 9.6 away. hard2 2 stone, 13:43:19.251Z and 13:43:39.350Z.
- `No path to the goal!` — 2 attempts. normal3 1, hard2 1 (the dark-oak line below).
- `Took to long to decide path to goal!` — 1 attempt. normal3 dark oak, below.

Dark-oak attempts are 104. 102 say `walk ok`. 2 carry a walk error.

- hard1, 36 attempts, all `walk ok`, 13:16:14.344Z to 13:22:32.321Z (378 s). Sample: 13:16:14.344Z at (135, 135, 31), bot at (141, 131, 31), 6.5 from the eye.
- hard2, 21 attempts, 20 `walk ok`, 13:35:52.995Z to 13:37:10.577Z (78 s). Sample: 13:35:52.995Z at (135, 134, 31), bot at (142, 130, 31), 7.7. The walk error is 13:37:10.577Z at (132, 134, 31), `walk: No path to the goal!`, bot at (135, 129, 34), 5.8.
- hard3, 46 attempts, all `walk ok`, 13:57:10.457Z to 13:58:04.288Z (54 s). Sample: 13:57:10.457Z at (135, 134, 31), bot at (142, 130, 31), 7.6.
- normal3, 1 attempt, 13:08:00.445Z at (100, 140, -39), `walk: Took to long to decide path to goal!`, bot at (92, 133, -46), 12.1.

### Hard runs

All three started on a confirmed dawn. Furthest rung is the stone pick on hard1 and the furnace on hard2 and hard3. No hard run held an iron pick. Cobble on a night dig did not move the way a night mine would.

- hard1 furthest rung is the stone pick (241 s; wooden pick 90 s). No furnace. Dark-oak refusals above, then sealed at 13:24:41.661Z `(149, 131, 35)` (`17 blocks placed`). 13:24:59.733Z `Night mine: not from here (no floor under (149, 130, 35))`. Samples from t=602 to t=1234 stay at [149, 131, 35], `working: shelter`, cobble 16. Dawn 13:34:29.500Z `tod 2`. Morning 13:35:23.405Z `tod 1062, nearest hostile 16.2`. The last sample (t=1264) is still there, cobble 25. Two hazard cancels, 13:18:43.564Z and 13:21:39.911Z, each `the gather job led into a hazard; cancelled, not resumed`, the first one second after `preempted by Misc World Survival Chain`.
- hard2 furthest rung is the furnace (512 s; stone pick 392 s, wooden pick 332 s). 13:46:41.696Z `Could not seal the shelter in 30 s: 1 open cells, first at 128,122,35; night pillar instead`, then `night pillar until morning`. No `Night mine:` line. Samples from t=543 to t=1235 stay at [128, 122, 35], hp 20, cobble 0, furnace 1. The last of those are `working: fight` on food with the bar at 20.
- hard3 furthest rung is the furnace (451 s; stone pick 331 s, wooden pick 211 s). Sealed at 14:07:19.045Z `(162, 149, 32)` (`24 blocks placed`). 14:07:32.644Z `Night mine: not from here (cave opening under 162,148,32 (3+ deep))`. Samples from t=602 stay at [162, 149, 32], `working: shelter`. Dawn 14:17:02.496Z `tod 14`. Morning 14:17:52.594Z `tod 1014, nearest hostile 26.4`.

### Diamond trips

Four `gather diamond_ore` submits, each `targetY -53`, `strip:true`, count 3: 11:30:10.597Z and 11:41:20.796Z (normal1), 12:26:24.311Z (normal2), 12:56:04.531Z (normal3). Diamonds held 0 on every sample. No `diamond_pickaxe` line. No hard run submitted one.

- normal1, first submit, the walk failed at once: 11:30:09.843Z `Navigation made no progress at (287, 92, 60) (last path: success, 35 steps, 256 nodes)`. The second submit is the thirteen `walk ok` skips in the death's 30 s, bot already at y=-33. Lowest sample is [234, -35, 98] at t=1594, diamonds 0. The y=-53 strip was not reached. The warden kill ended that trip. No diamond pick.
- normal2 samples walk the rung from y=70 to y=30 (t=1926 to t=2106). 12:29:19.135Z `descent stopped at y=31` (`dropped to y=31 below the step at (269, 32, 50)`). The next sample (t=2136) has left the rung for `working: drop` at [267, 30, 51]. The run's lowest sample is later, [279, 19, 70] at t=2317, on `iron: gather`, diamonds still 0. Did not reach y=-53. No diamond pick.
- normal3's submit is the same second as `Inventory nearly full; deposit items first` (12:56:04.531Z). No sample is on `diamond-rung`. From t=1325 the bot stands at [256, 69, 60] until t=1896, then the drown at [239, 60, 83]. The y=-53 strip was not reached. No diamond pick.

### Bed

Zero `Home set` lines. Zero `Sleeping` lines. Zero bed crafts. Bed 0 on every sample. `no sheep after 3 search legs; bed set aside for 10 min` at 11:41:12.633Z (normal1), 12:26:13.171Z (normal2), 12:55:55.431Z and 13:06:27.471Z (normal3).

### Bucket

Zero lines that name `water_bucket`. Buckets were crafted at 11:24:13.980Z, 11:51:39.008Z, 12:09:21.062Z, and 12:47:22.923Z. The use at 11:24:34.686Z `(314, 114, 11)` failed: `Filling the bucket at (314, 114, 11) produced no water bucket (3 tries; out of reach (17.8))`. 11:24:42.504Z `the bucket failed twice; no water fills for 15 min`. A later use at 11:41:11.587Z `(213, -42, 93)` got `No path to the goal!` and no second failure line. The use at 12:25:46.816Z `(277, 71, 67)` reached `Completed use` at 12:26:02.112Z. The use at 12:55:23.888Z `(276, 71, 66)` reached `Completed use` at 12:55:55.336Z. Neither completed use logged a `water_bucket` line. `MLG Water Bucket Fall Chain` engaged at 12:31:30.943Z.

### Other loops

- normal2's bag-full drop, 12:11:03.142Z to 12:23:37.515Z, the same cobble/gravel toss and the same deep-underground iron line, while the bot stood on [281, 92, 41].
- normal3's iron back-off, t=1325 to t=1896 at [256, 69, 60], the same `Inventory nearly full` / `deep underground` pair, ending in the drown.
- hard1's dark-oak refusals, 36 `walk ok` attempts from 13:16:14.344Z to 13:22:32.321Z, then the sealed stand from 13:24:41.661Z until morning with `Night mine: not from here`.
- hard2 sat at [128, 122, 35] from 13:46:42.577Z `night pillar until morning` through the bell. The dashboard in that span has no night-mine line.

## 2026-10-18 20:16–20:33 IST — units and integration (`510f660`)

`git pull --rebase` was already up to date at `510f660` (round 21: an empty path is a failure, leave the deep dark, run from wardens, swim up after 8 s under water). HEAD is that bot commit. Unit tests, every `tests/*.test.js` except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000 --test-skip-pattern resources`: **565 passed, 0 failed** (41.6 s). The note expected 556; nothing failed.

Services restarted with `AGENT_MODEL=off`. `Stop-Agent.ps1` saved the test world and stopped the services. The old test-server and dashboard PIDs were dead, and 8765/8766/8081/25569 were not listening. `Start-Agent.ps1 -NoBrowser` then brought the dashboard up. Supervisor log: `model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit`.

`python -u tests/integration.py`, model off. Exit 0, 1070 s (20:16:08–20:33:58 IST, 14:46:08Z–15:03:58Z). `All in-game integration tests passed`. No test failed on the new empty-path rule. The dashboard window (469 timestamped lines) has zero `empty path` lines and zero `No path to the goal!` lines.

Reflex line from the suite: `Reflex paused the gather: Reflex: preempted by Mob Defense`. Dashboard at 15:02:12.913Z: `Pause trace: gather -> Reflex: preempted by Mob Defense`, then 15:02:14.080Z `Reflex: resumed the gather job`. The suite also logged `PASS: armed bot reflex killed the zombie`, `PASS: unarmed bot fled to 9.8 blocks`, `PASS: creeper avoided at 11.0 blocks`, `PASS: reflex auto-ate without a job (12 -> 18)`, `PASS: reflex auto-equipped the iron chestplate`, and `PASS: reflex surfaced the drowning bot`.

`PASS: A4 escaped the lava trench (hp 19.8, at [1653, -59, 1652])`. The dashboard shows the escape start at 15:03:56.626Z `Reflex: Misc World Survival Chain engaging`, after a teleport to (1653, -60, 1651).

## 2026-10-18 20:36–20:41 IST — combat (`5031ea7`, bot code `510f660`)

`python -u tests/combat_integration.py`, model off, same process as the integration restart. Exit 0, 319 s (20:36:26–20:41:45 IST, 15:06:26Z–15:11:45Z). `All combat acceptance tests passed`. One run. The dashboard window (283 timestamped lines) has zero `empty path` lines and zero `No path to the goal!` lines.

`4_creeper` (lane): ttk 7.3 s, hits 5, `damage_taken=0`, end health 20, killed, no crater at the spawn, the midpoint, or the bot start. Dashboard: `Combat: pillar-up 2 at 1499,-60,1518 (creeper at 7.3)` at 15:08:18.316Z, then `pillar perched 2 up` at 15:08:19.156Z, then `perch 2 up is inside the fuse ring; knocking the creeper back (at 3.6)` and three `pillar-strike` lines. Fight result at 15:08:24.978Z: `tactic=bow hits=5 shots=0 released=0 landed=0 damage taken=0`.

`4b_creeper_roofed`: ttk 6.2 s, hits 2, `damage_taken=0`, end health 20, killed, no crater. At 15:08:33.414Z `Combat: pillar-up 2 at 1496,-60,1497 (creeper at 8.0)`, then `pillar perched 2 up` at 15:08:34.179Z. Two arrows released (both 2.98 b/t) and both landed. Fight result at 15:08:38.029Z: `tactic=bow hits=2 shots=2 released=2 landed=2 damage taken=0`.

The witch leg printed `NOTE: witch survived the duel (job failed, lost 0 hp)` and the suite still exited 0. That is the recorded 26.3 limit, not a suite failure.

## 2026-10-18 20:43–23:51 IST — dual soak (`d282c8b`, bot code `510f660`)

`AGENT_MODEL=off`, one soak, exit 0, 11281 s (20:43:01–23:51:00 IST, 15:13:01Z–18:21:00Z). `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Anchors this seed: hard [141, 131, 30] (canopy light 8), normal [310, 131, 30] (open sky 15). Interventions 2, resumes 0, deaths 0. Six valid runs. Dashboard window used below is 15:13:02.761Z–18:20:48.448Z (`Stopped by user` through `Disconnected`, 1989 timestamped lines). The six runs are the six `Autopilot started` / `Autopilot stopped` pairs: normal1 15:16:09.651Z–15:56:17.942Z (20:46:09–21:26:17 IST), normal2 15:56:29.714Z–16:36:37.448Z (21:26:29–22:06:37 IST), normal3 16:36:49.060Z–17:16:56.355Z (22:06:49–22:46:56 IST), hard1 17:17:10.881Z–17:38:14.715Z (22:47:10–23:08:14 IST), hard2 17:38:26.457Z–17:59:29.982Z (23:08:26–23:29:29 IST), hard3 17:59:41.818Z–18:20:45.623Z (23:29:41–23:50:45 IST). After the stop, the flat world was restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, `difficulty=peaceful`, properties written 23:51:03 IST). Supervisor log still says `model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit`. No second soak.

The wood / stone-pick / furnace / iron-pick columns are the first sample that held the item. **4 of 6 runs made a wooden pick.** Round 20 (`f99d6d7` / soak report `bd4e371`) was 6 of 6. hard2 and hard3 never held one. Round 20 hard runs: stone pick on all three, furnace on hard2 (512 s) and hard3 (451 s), no iron pick. This round hard1 reached the furnace (331 s); hard2 and hard3 stopped on wood. All three normal runs still reached an iron pick (542 / 662 / 482 s; round 20 was 511 / 722 / 572 s). End `wood` is no on hard2 and hard3 (wooden pick 0). End `stone` is no on normal1 (furnace 0 at the bell, stone pick still 2) and on hard2 and hard3.

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 120 | 241 | 301 | 542 | 16 | 2 at 813 | — | 0 | ate 1 | 0 |
| normal2a2 | 120 | 181 | 241 | 662 | 16 | 2 at 993 | — | 0 | ate 1 | 0 |
| normal3a3 | 90 | 181 | 271 | 482 | 16 | 2 at 843 | — | 0 | ate 1 | 0 |
| hard1a1 | 180 | 271 | 331 | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 0 |
| hard2a2 | — | — | — | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 0 |
| hard3a3 | — | — | — | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 0 |

### Deaths

Zero `Bot died` lines in the window, and none of `drowned`, `slain`, `burned`, or `obliterated`. The soak counter is 0. There is no 30 s slice to quote.

### Empty path

`empty path` lines, including the gather skip twin that repeats the same failure: normal1 4, normal2 2, normal3 3, hard1 44, hard2 96, hard3 182.

Without the skip twin:

- normal1 4, normal2 2, normal3 3, all `Left the furnace` (a walk back). None of those positions repeats 5 times. Sample: 15:27:09.908Z `Left the furnace at (303, 92, 55): No path to the goal! (empty path at (304, 92, 55), last path: partial, 0 steps, 91 nodes)`.
- hard1: 20 `Gather: attempt` on `dark_oak_log`, 2 `Job:` lines, 1 tunnel step, 1 `Night mine` climb. The gather burst is 17:19:10.523Z–17:19:40.951Z (30 s) at bot (141, 130, 28), `last path: noPath, 0 steps, 1 nodes`, eye distance 6.2–7.9. The harness then unstuck that cell (teleport to (143, 134, 30) at 17:19:41.336Z) and a wooden pick was crafted at 17:19:56.078Z. It did not sit there for minutes.
- hard2: 17 dark-oak attempts (17:39:02.152Z–17:40:07.952Z) plus 62 `Job:` lines. 61 of those jobs are the same cell: `Job: No path to the goal! (empty path at (136, 124, 28), last path: noPath, 0 steps, 1 nodes)`, from 17:39:56.815Z through 17:48:14.844Z (about 8 min). Samples stay on [136, 124, 28], `backing off: wood`, planks 8, logs 0, wooden pick 0, from t=90 to t=602.
- hard3: 58 dark-oak attempts plus 1 oak_log attempt, and 64 `Job:` lines. 75 events sit at (142, 131, 28) from 17:59:47.577Z to 18:03:27.150Z, then 48 at (142, 132, 30) from 18:03:43.988Z to 18:09:08.247Z (`last path: noPath, 0 steps, 1 nodes`, two of them 2 nodes). Samples back off wood from t=60 to t=572. At t=271 the bot is `working: craft` with 10 planks and still no wooden pick. End kit: sticks 4, planks 10, table 1, wooden pick 0.

### Cannot reach

97 gather attempts after dropping the skip twin (the raw `Cannot reach` line count is 194, and that includes the twin). **Zero say `walk ok`.** Round 20 was 142 of 148 attempts `walk ok`.

- `empty path` — hard1 20 dark_oak_log, hard2 17 dark_oak_log, hard3 58 dark_oak_log and 1 oak_log.
- `Navigation left the surface` — normal1 1 spruce_log.

Dark-oak attempts are 95. All 95 carry `walk: No path to the goal! (empty path ...)`.

- hard1, 20 attempts, 17:19:10.523Z–17:19:40.902Z (30 s). Sample: 17:19:10.523Z at (135, 134, 31), bot at (141, 130, 28), 6.8 from the eye.
- hard2, 17 attempts, 17:39:02.152Z–17:40:07.952Z (66 s). Sample: 17:39:02.152Z at (132, 130, 26), bot at (136, 126, 29), 5.7 from the eye.
- hard3, 58 attempts, 17:59:47.577Z–18:04:22.210Z (275 s). Sample: 17:59:47.577Z at (139, 135, 23), bot at (142, 131, 28), 6.9 from the eye.

Spruce is one attempt, not an empty path: 15:16:29.782Z `spruce_log` at (331, 131, 29), `walk: Navigation left the surface at (321, 126, 33)`, bot at (321, 126, 33), 11.6 from the eye.

### Deep dark and warden

Zero `Deep dark` / `deep dark` lines. Zero `warden` / `Warden` lines.

### Swimming up

Zero `swimming up` lines, and zero `WorldSurvival: drowning` lines. The bot did not drown.

### Navigation made no progress

Zero `Navigation made no progress` lines. Zero lines contain `last path: none`. The round-19 wedge did not return. Round 20 had 2 no-progress lines on normal1, neither `last path: none`.

### Full bag

`Inventory nearly full` is 12 job lines (11 on normal1, 1 on normal2). Each quoted slot list:

- 15:45:42.490Z, 15:45:42.904Z, 15:45:50.985Z, 15:45:59.062Z `cobblestone:3 clay_ball:2 snowball:2 stone_pickaxe:2 dirt:2 coal:1 white_wool:1 shield:1 wooden_axe:1 cooked_porkchop:1`
- 15:52:57.943Z `stone_shovel:2 clay_ball:2 snowball:2 stone_pickaxe:2 coal:1 white_wool:1 shield:1 wooden_axe:1 cooked_porkchop:1 spruce_log:1`
- 15:54:03.987Z `stone_pickaxe:2 cobblestone:2 clay_ball:2 snowball:2 stone_shovel:2 coal:1 white_wool:1 shield:1 wooden_axe:1 cooked_porkchop:1`
- 15:55:10.262Z, 15:55:34.588Z, 15:55:34.642Z, 15:55:42.725Z, 15:55:50.802Z `snowball:3 stone_pickaxe:2 cobblestone:2 clay_ball:2 stone_shovel:2 coal:1 white_wool:1 shield:1 wooden_axe:1 cooked_porkchop:1`
- 16:25:18.636Z (normal2) `cobblestone:5 snowball:3 stone_sword:1 wooden_sword:1 cooked_beef:1 bucket:1 wooden_pickaxe:1 cooked_mutton:1 black_wool:1 stick:1`

`waiting: bag full` samples: normal1 has 12, from t=1716 to t=2167, `waiting: bag full (iron craft)`, bouncing between [310, 129, 33], [316, 119, 32], and [310, 121, 31]. normal2 has 18, t=1836 to t=2408 (572 s) all at [423, 42, -4], `waiting: bag full (iron craft)`. normal3 and the hard runs have none.

`the bag is full; no crafting for 5 min, clearing junk first` is 13 lines on normal1 and 4 on normal2.

Drops that completed:

- normal1: 28 dirt, 10 cobblestone, 4 cobblestone, 235 cobblestone, 36 dirt, 15 andesite, 32 dirt, 12 cobblestone, 15 andesite, 12 cobblestone, 4 dirt, 2 spruce_sapling, 1 pink_petals.
- normal2: 13 cobblestone, 74 cobblestone, 13 gravel, 55 cobblestone, 10 dirt, 9 diorite.
- normal3: the cobblestone drop of 140 submitted at 16:59:18.191Z never logged `Dropped` or `Completed drop`.

Pockets, all east, each followed within 4 s by a came-back:

- 15:46:28.903Z, cobblestone back at 15:46:33.441Z.
- 15:55:20.386Z, dirt back at 15:55:23.044Z.
- 16:25:27.102Z, cobblestone back at 16:25:30.982Z.

Other came-backs: cobblestone 15:44:06.885Z, 15:48:25.153Z; dirt 15:47:54.597Z, 15:51:25.258Z, 15:52:26.886Z, 15:53:10.544Z; cobblestone 16:26:20.349Z, 16:26:26.443Z, 16:27:26.883Z.

### Hard runs

All three started on a confirmed dawn. Furthest rung is the furnace on hard1, and short of a wooden pick on hard2 and hard3. No hard run held an iron pick.

- hard1 furthest rung is the furnace (331 s; stone pick 271 s, wooden pick 180 s). The dark-oak empty-path burst above, then the unstuck, then the pick. Sealed at 17:27:30.534Z `(151, 133, 37)` (`4 blocks placed`). 17:27:33.889Z `Night mine: down from the shelter at (151, 133, 37) (tod 12612)`. 17:27:42.422Z `Tunnel climb: step 151,131,37 failed (No path to the goal! (empty path at (150, 130, 37), last pat); digging through natural fill`. 17:27:42.470Z `Night mine: climb back failed: No path to the goal! (empty path at (150, 130, 37), last path: noPath, 0 steps, 2 nodes)`. 17:27:52.687Z `Night mine: could not climb back into (151, 133, 37): Took to long to decide path to goal!`, then `walking the tunnel back by hand from (152, 133, 35)`, then `not back in the shelter (opened onto a cave at 150,131,36; 2 steps, 0 ore items, 0 wall digs)`. It resealed at (152, 133, 35) at 17:27:54.761Z (`3 blocks placed`). Cobble on that dig went 5 to 7. Samples from t=662 stay at [152, 133, 35], `working: shelter`, until the last sample (t=1263) steps to iron at [153, 134, 33], cobble 13. Dawn 17:37:03.899Z `tod 12`. Morning 17:37:54.106Z `tod 1012, nearest hostile 18.1`.
- hard2 furthest rung is 8 planks. No wooden pick. The empty-path repeat above, then 17:49:08.084Z `Shelter: 2 blocks held, 3 for the box; sealing a 1x1 pod (2) at (136, 122, 28)` and 17:49:09.443Z `sealed at (136, 122, 28)` (`2 blocks placed`). No `Night mine:` line. Samples from t=632 to the bell stay at [136, 122, 28], `working: shelter`, cobble 0, wooden pick 0. Dawn 17:58:19.042Z `tod 1`. The run stops at 17:59:29.982Z with no morning-open line.
- hard3 furthest rung is 10 planks and a table. No wooden pick. The empty-path repeat above, then sealed at 18:10:01.076Z `(153, 133, 32)` (`11 blocks placed`). No `Night mine:` line. Samples from t=632 stay at [153, 133, 32], `working: shelter`, cobble 0. Dawn 18:19:35.043Z `tod 15`. The run stops at 18:20:45.623Z with no morning-open line.

### Diamond trips

Three `gather diamond_ore` submits, each `targetY -53`, `strip:true`, count 3: 15:33:32.693Z (normal1), 16:18:19.042Z (normal2), 16:55:20.770Z (normal3). Diamonds held 0 on every sample. No `diamond_pickaxe` line. No hard run submitted one. None reached y=-53.

- normal1 logged `descent stopped at y=153` in the same second as the submit (`water beside` the step, `no safe way on`). Samples still walked the rung from y=149 down to y=18: lowest is [245, 18, -58] at t=1626, diamonds 0. 15:43:25.434Z `Tool left the inventory: wooden_pickaxe (1 uses left, broke)`. 15:43:32.692Z `Could not climb back up the tunnel: Time limit reached`. 15:43:32.693Z `Tunnel needs a suitable tool in the inventory for stone`. The harness then returned the bot from [263, 36, -58] (teleport to (310, 131, 30) at 15:43:45.537Z). No diamond pick.
- normal2 walked to y=35. 16:25:12.052Z `descent stopped at y=35` (cave opening under the floor, `no safe way on`). Lowest sample is [426, 35, 3] at t=1716, diamonds 0. The next samples leave the rung and stand at [423, 42, -4] on the bag-full iron craft through the bell. No diamond pick.
- normal3 walked to y=47. Lowest diamond sample is [366, 47, -105] at t=1324. At 16:59:17.389Z the gather is `preempted by Mob Defense` (a silverfish). 16:59:17.388Z `Tool left the inventory: iron_sword (250 uses left)`. 16:59:18.191Z a drop of 140 cobblestone is submitted. 16:59:27.684Z `Reflex: fleeing silverfish,silverfish,silverfish,silverfish (unarmed - COMBAT_SPEC 7f)`. The dashboard then has no further line until the run stops at 17:16:56.355Z. Samples from t=1354 to t=2407 (1053 s) stay at [366, 47, -105], `queued: drop`. The y=-53 strip was not reached. No diamond pick.

### Bed

Zero `Home set` lines. Zero `Sleeping` lines. Zero `white_bed` lines. Bed 0 on every sample. Shears were submitted at 15:32:32.205Z (`craft shears`). `white_wool:1` is in the normal1 slot lists above, and `black_wool:1` is in the normal2 list. `no sheep after 3 search legs; bed set aside for 10 min` at 15:32:52.448Z and 15:53:57.904Z (normal1), 16:16:37.557Z (normal2), 16:54:16.176Z (normal3).

### Bucket

Zero lines that name `water_bucket`. Buckets were crafted at 15:27:10.366Z, 16:11:09.505Z, and 16:47:40.219Z. The use at 15:52:52.769Z `(311, 115, 10)` failed at 15:52:57.786Z `Took to long to decide path to goal!`. The use at 15:53:14.172Z `(317, 113, 18)` failed the same way at 15:53:19.188Z, then 15:53:22.397Z `the bucket failed twice; no water fills for 15 min`. The use at 16:54:11.130Z `(448, 71, -69)` reached `Completed use` at 16:54:15.332Z, with no `water_bucket` line and no second failure line. normal2 crafted a bucket (it is in the 16:25:18.636Z slot list) and logged no use.

### Other loops

- hard2's wood backoff at [136, 124, 28], t=90 to t=602, the same `empty path at (136, 124, 28), last path: noPath, 0 steps, 1 nodes` job, planks stuck at 8, no pick. That is the run.
- hard3's wood backoff, t=60 to t=572, the same empty-path job at (142, 131, 28) and then (142, 132, 30), planks 10 and a table, wooden pick still 0, then the sealed stand with no night mine.
- normal3's queued cobblestone drop, t=1354 to t=2407 at [366, 47, -105], with a silent dashboard after the silverfish.
- normal2's bag-full iron craft, t=1836 to t=2408 at [423, 42, -4].
- `No room for crafting result` at 15:44:02.894Z and 15:47:42.420Z (normal1), and 16:26:06.678Z, 16:30:41.754Z, 16:35:50.076Z (normal2). Each is followed at once by the bag-full clear.

### Uncaught

`logs/dashboard-uncaught.log` gained no bytes during the soak (size stayed 2576174). Zero lines in that file carry a timestamp inside 15:13:01Z–18:21:00Z. There is no line to quote from the soak window.

## 2026-10-19 00:22–00:41 IST — units and integration (`e1e2f1c`, also `ac4d6c0`)

`git pull --rebase` needed a stash of local `data/` dumps first (`unstaged changes`). After the stash, origin was already up to date, and the stash was popped. HEAD is `e1e2f1c`. Two Round 22 commits, both bot code (neither is docs-only):

- `ac4d6c0` retries a path without mob avoidance when avoidance priced out every step, stairs out when boxed in, and ignores distant silverfish (`src/move-safety.js`, `src/worker.js`, `src/chains/mobDefenseChain.js`, `tests/round15.test.js`).
- `e1e2f1c` treats snowballs and clay balls as junk (`src/autopilot.js`).

Unit tests, every `tests/*.test.js` except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000 --test-skip-pattern resources`: **567 passed, 0 failed** (42.0 s). The note expected 558; nothing failed.

Services restarted with `AGENT_MODEL=off`. `Stop-Agent.ps1` saved the test world and stopped the services. The old test-server and dashboard PIDs were dead, and 8765/8766/8081/25569 were not listening. `Start-Agent.ps1 -NoBrowser` then brought the dashboard up. Supervisor log first line: `model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit`.

`python -u tests/integration.py`, model off. Exit 0, 1063 s (00:23:59–00:41:42 IST, 18:53:59Z–19:11:42Z). `All in-game integration tests passed`.

Reflex line from the suite: `Reflex paused the gather: Reflex: preempted by Mob Defense`. The suite also logged `PASS: armed bot reflex killed the zombie`, `PASS: unarmed bot fled to 10.1 blocks`, `PASS: creeper avoided at 11.0 blocks`, `PASS: reflex auto-ate without a job (11 -> 17)`, `PASS: reflex auto-equipped the iron chestplate`, `PASS: reflex surfaced the drowning bot`, and `PASS: gather paused by a reflex resumed and completed`.

`PASS: A4 escaped the lava trench (hp 19.8, at [1649, -59, 1649])`.

The dashboard window (522 timestamped lines) has zero `empty path` lines, zero `Boxed in` lines, and zero `No path to the goal!` lines. `trying without it` is 23 lines, all the same cell, from 19:00:46.800Z to 19:00:56.463Z: `Navigation: no path with mob avoidance at (1008, -60, 997); trying without it`. The next job line is 19:00:56.999Z `Job: No matching blocks within the allowed radius`, then a harness teleport to (1008, -60, 997) at 19:00:57.741Z. The retry did not log a reached goal before that job ended. The suite still passed.

The soak is next. This round has no combat run.

## 2026-10-19 00:43–03:51 IST — dual soak (`7bc2018`, bot code `e1e2f1c` / `ac4d6c0`)

`AGENT_MODEL=off`, one soak, exit 0, 11283 s (00:43:57–03:51:57 IST, 19:13:57Z–22:21:57Z). `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Anchors this seed: hard [141, 131, 30] (canopy light 14), normal [310, 131, 30] (open sky 15). Interventions 3, resumes 0, deaths 0. Six valid runs. The dashboard window used below is 19:13:57Z–22:21:57Z (3080 timestamped lines). The six runs are the six `Autopilot started` / `Autopilot stopped` pairs: normal1 19:17:05.569Z–19:57:14.545Z (00:47:05–01:27:14 IST), normal2 19:57:26.511Z–20:37:34.027Z (01:27:26–02:07:34 IST), normal3 20:37:45.741Z–21:17:54.123Z (02:07:45–02:47:54 IST), hard1 21:18:08.163Z–21:39:11.948Z (02:48:08–03:09:11 IST), hard2 21:39:23.698Z–22:00:27.452Z (03:09:23–03:30:27 IST), hard3 22:00:39.206Z–22:21:42.958Z (03:30:39–03:51:42 IST). After the stop, the flat world was restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, `difficulty=peaceful`). Supervisor log first line is still `model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit`. No second soak. The integration report commit `7bc2018` is docs-only; the bot code is `e1e2f1c` on top of `ac4d6c0`.

The wood / stone-pick / furnace / iron-pick columns are the first sample that held the item. **All 6 runs made a wooden pick.** Round 21 (`510f660` / soak report `d282c8b`) was 4 of 6. Round 20 (`f99d6d7` / soak report `bd4e371`) was 6 of 6. **All 6 runs also held a stone pick and a furnace.** Round 20 hard runs: stone pick on all three (241 / 392 / 331 s), furnace on hard2 (512 s) and hard3 (451 s), no furnace on hard1, no iron pick. Round 21 hard runs: hard1 furnace 331 s (stone pick 271 s, wooden pick 180 s); hard2 stopped at 8 planks; hard3 stopped at 10 planks and a table. This round the hard furnace times are 301 / 331 / 241 s, and the hard stone-pick times are 181 / 181 / 151 s. hard1's furnace was gone at the bell (stone pick still 2), so its end `stone` predicate is no. normal3's end `wood` is no (table 0, wooden pick still 1) and its end `stone` is no (stone pick 0, furnace still 1). All three normal runs still reached an iron pick (391 / 572 / 542 s). Round 21 was 542 / 662 / 482 s. Round 20 was 511 / 722 / 572 s. normal3's iron pick was gone at the bell (`iron_pickaxe` 0, `iron_sword` 1). No hard run held an iron pick.

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 211 | 271 | 391 | 16 | 3 at 632 | — | 0 | not hungry enough (food min 16) | 0 |
| normal2a2 | 90 | 181 | 301 | 572 | 16 | 4 at 903 | — | 0 | ate 2 | 0 |
| normal3a3 | 90 | 331 | 421 | 542 | 16 | 2 at 812 | — | 0 | ate 4 | 0 |
| hard1a1 | 120 | 181 | 301 | — | 8 | 0 | 481 | 0 | not hungry enough (food min 20) | 0 |
| hard2a2 | 90 | 181 | 331 | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 0 |
| hard3a3 | 120 | 151 | 241 | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 0 |

### Deaths

Zero `Bot died` lines in the window, and none of `drowned`, `slain`, `burned`, or `obliterated`. The soak counter is 0 on every run. There is no 30 s slice to quote.

### Trying without it

608 lines, `Navigation: no path with mob avoidance at (...); trying without it`, in 307 bursts (a burst is consecutive retries at the same cell). Line counts: scout (before the first autopilot) 33, normal1 82, normal2 113, normal3 51, hard1 186, hard2 38, hard3 105.

Outcome of each burst, from the next dashboard line:

- 152 bursts: the next retry is a different cell, so the bot had moved.
- 70 bursts: the next line is `Completed` (gather, craft, or the scout gather).
- 60 bursts: the next line is other progress (a tool change, a gather column note, or an advancement).
- 23 bursts: the next line is a failure. Each one:
  - normal1 19:19:15.735Z, 19:19:16.833Z, 19:19:47.975Z at (331, 131, 29) → `Boxed in at (331, 131, 29): no way to stair out`.
  - normal1 19:25:35.099Z at (321, 127, 20) → empty path, `partial, 0 steps, 959 nodes`.
  - normal1 19:31:09.002Z at (369, 105, 56) → `Left the furnace`, empty path, 206 nodes.
  - normal1 19:45:30.899Z at (497, -33, 77) → `Left the furnace`, empty path, 79 nodes.
  - normal2 19:59:05.960Z at (325, 138, 23) → `Boxed in ... no way to stair out`.
  - normal2 20:04:54.870Z at (262, 129, 77) → empty path, 1456 nodes.
  - normal2 20:07:30.722Z at (250, 109, 69) → `Left the furnace`, empty path, 16 nodes.
  - normal2 20:13:27.724Z at (253, 109, 71) → `Left the furnace`, empty path, 692 nodes.
  - normal2 20:28:53.098Z at (197, 32, 67) → `Left the furnace`, empty path, 429 nodes.
  - normal3 20:47:17.499Z at (324, 114, 31) → `Left the furnace`, empty path, 18 nodes.
  - normal3 21:11:11.346Z at (451, -4, 139) → `Dropped cobbled_deepslate came back into the inventory`.
  - hard1 21:26:27.466Z through 21:26:36.638Z, seven bursts at (151, 147, -45) and (149, 148, -44) → `Job: Reflex: preempted by Mob Defense`.
  - hard1 21:28:27.921Z at (146, 148, -41) → `Job: Current job cancelled`.
  - hard1 21:28:32.940Z at (146, 148, -41) → `Job: No clear spot to place a white_bed`.
  - hard1 21:30:32.285Z at (146, 145, -40) → `Job: Current job cancelled`.
- 2 bursts on hard3 had no following line inside the look-ahead: 22:12:44.059Z at (150, 141, -4) and 22:13:20.312Z at (149, 142, -4). The night-mine climb then failed (below). Those retries did not put the bot back in the shelter.

The scout burst (33 lines at (141, 131, 30) and (140, 130, 31), 19:16:08.474Z–19:16:38.110Z) ended at `Completed gather`. The hard anchor was confirmed after that.

### Boxed in

Four lines. Every one is `no way to stair out`. None logged a dug step.

- normal1, three times at (331, 131, 29): 19:19:15.831Z, 19:19:16.941Z, 19:19:48.080Z. The t=151 sample already holds a wooden pick. The stone pick is the t=211 sample. The stair-out dug nothing, and the ladder still reached stone.
- normal2, once at (325, 138, 23): 19:59:07.406Z. Wooden pick was already the t=90 sample. The stone pick is the t=181 sample. The stair-out dug nothing, and the stone job still ran.

### Empty path

`empty path` lines: normal1 5, normal2 4, normal3 1, hard1 0, hard2 0, hard3 0. Round 21 was 4, 2, 3, 44, 96, 182. Two of the ten visited 1–2 nodes. Both are normal1, both `Job:` at (331, 131, 29), `last path: noPath, 0 steps, 1 nodes`, one second apart (19:19:15.832Z and 19:19:16.941Z), and both are the boxed-in failures above. The other eight visited more than 2 nodes (16 to 1456). No cell repeats for minutes. Round 21 hard2 sat about 8 min and hard3 about 9 min on `noPath, 0 steps, 1 nodes`. That repeat is absent here.

All ten:

- 19:19:15.832Z and 19:19:16.941Z `Job: No path to the goal! (empty path at (331, 131, 29), last path: noPath, 0 steps, 1 nodes)`.
- 19:25:35.181Z `Job:` at (321, 127, 20), `partial, 0 steps, 959 nodes`.
- 19:31:09.065Z `Left the furnace at (369, 105, 57)` at (369, 105, 56), `partial, 0 steps, 206 nodes`.
- 19:45:30.931Z `Left the furnace at (497, -33, 76)` at (497, -33, 77), `noPath, 0 steps, 79 nodes`.
- 20:04:55.156Z `Job:` at (262, 129, 77), `partial, 0 steps, 1456 nodes`.
- 20:07:30.775Z `Left the furnace at (250, 112, 69)` at (250, 109, 69), `noPath, 0 steps, 16 nodes`.
- 20:13:27.773Z `Left the furnace at (252, 109, 71)` at (253, 109, 71), `partial, 0 steps, 692 nodes`.
- 20:28:53.144Z `Left the furnace at (196, 32, 67)` at (197, 32, 67), `noPath, 0 steps, 429 nodes`.
- 20:47:17.561Z `Left the furnace at (324, 114, 30)` at (324, 114, 31), `noPath, 0 steps, 18 nodes`.

### Cannot reach

30 gather attempts (60 lines with the skip twin). **Zero say `walk ok`.** Round 20 was 142 of 148 attempts `walk ok`. Round 21 was zero, and all 95 dark-oak attempts were empty paths. This window has no dark-oak `Cannot reach` line.

- spruce_log 21. normal2 has 1, at 19:57:29.573Z `(332, 135, 25)`, `walk: Navigation left the surface at (319, 126, 28)`, 14.8 from the eye. normal3 has 20, the same walk clause. A burst at 20:39:13.456Z–20:39:17.856Z is six spruce logs around (360, 125, 30), the bot walking the surface down to about y=123. The wooden pick is still the t=90 sample.
- coal_ore 3, all hard1, 21:25:57.782Z–21:25:59.789Z, `walk: No path to the goal!`, bot at (143, 152, -38), 11.0–11.6 from the eye. The furnace was already the t=301 sample.
- iron_ore 1, hard1, 21:27:45.798Z at (152, 157, -23), `walk: Navigation timed out at (147, 156, -44)`, 21.4 from the eye.
- stone 5. hard2 one, 21:43:52.857Z at (135, 128, 16), `Navigation timed out at (127, 128, 18)`, 8.3 from the eye. hard3 four, 22:02:36.824Z–22:02:39.957Z around (141, 128, 18), `walk: No path to the goal!`, bot at (136, 129, 31), 12.9–14.2 from the eye. The stone pick is still the t=151 sample.

### Silverfish

Zero `silverfish`, `Silverfish`, and `endermite` lines. Round 21 normal3 fled four silverfish and then the dashboard was silent for 17 min. That did not happen.

### Deep dark

26 lines, all normal1, all the same sentence: `Job: Deep dark: sculk_catalyst at (511, -31, 79); leaving (warden)`, from 19:47:48.121Z to 19:52:40.119Z (about 5 min, 26 times). Samples from t=1836 to t=2167 stay on [503, -35, 77], `backing off: iron`, diamonds 0. The next sample (t=2198) has moved to [500, -36, 91]. The leave line stopped repeating. No warden kill. Zero `Warden` lines. The same 26 lines are the only `warden` mentions.

### Full bag

`Inventory nearly full` is 10 job lines. Each quoted slot list:

- 19:44:41.276Z, 19:44:42.123Z, 19:44:50.186Z, 19:44:58.240Z `snowball:6 cobblestone:3 cobbled_deepslate:2 coal:1 iron_sword:1 stone_sword:1 stone_axe:1 spruce_log:1 wooden_axe:1 spruce_sapling:1`
- 19:47:09.693Z `cobblestone:3 snowball:3 cobbled_deepslate:2 coal:1 iron_sword:1 stone_sword:1 stone_axe:1 spruce_log:1 wooden_axe:1 spruce_planks:1`
- 19:47:38.977Z `cobblestone:3 cobbled_deepslate:2 stone_pickaxe:2 coal:1 iron_sword:1 raw_iron:1 stone_sword:1 crafting_table:1 spruce_log:1 wooden_axe:1`
- 19:55:27.929Z `cobbled_deepslate:3 stone_pickaxe:2 cooked_mutton:1 iron_sword:1 raw_iron:1 stone_sword:1 crafting_table:1 spruce_log:1 wooden_axe:1 snowball:1`
- 21:10:31.857Z and 21:11:02.317Z `clay_ball:3 cobbled_deepslate:3 cobblestone:1 shield:1 dirt:1 stone_sword:1 granite:1 wooden_pickaxe:1 wooden_sword:1 spruce_planks:1`
- 21:11:20.440Z `cobbled_deepslate:3 wheat_seeds:1 cobblestone:1 shield:1 dirt:1 stone_sword:1 granite:1 wooden_pickaxe:1 flowering_azalea:1 wooden_sword:1`

Snowball and clay_ball are still in those lists. They were also dropped in bulk (below), and snowball came back twice.

`waiting: bag full` samples: normal1 has 1, t=1746, at [497, -33, 77], `waiting: bag full (iron craft)`. normal3 has 4, t=2288 to t=2408 (120 s), all at [454, -1, 151], `waiting: bag full (food craft)`, food bar 2. The other runs have none.

`the bag is full; no crafting for 5 min, clearing junk first` is 7 lines on normal1 (19:44:42.109Z–19:55:28.375Z) and 4 on normal3 (21:10:32.866Z–21:16:30.242Z). `No room for crafting result` is once, 21:16:29.493Z, immediately before the last of those four.

Drops that completed:

- normal1: 80 snowball, 128 cobblestone, 84 snowball, 128 cobblestone, 128 cobblestone, 84 snowball, 128 cobblestone, 128 cobblestone, 128 cobblestone, 64 clay_ball, 49 cobbled_deepslate, 64 clay_ball, 128 cobbled_deepslate.
- normal2: 20 snowball, 22 dirt, 10 cobblestone, 23 dirt, 264 cobblestone, 32 cobbled_deepslate, 28 dirt, 32 cobbled_deepslate, 80 cobblestone, 27 andesite, 25 granite, 27 andesite.
- normal3: 319 cobblestone, 88 clay_ball, 319 cobblestone, 136 clay_ball, 110 cobbled_deepslate, 136 clay_ball, 136 clay_ball.

Pockets:

- 19:43:43.259Z south (normal1). The next lines are `Dropped 128 cobblestone`, `Dropped 84 snowball`, `Dropped 128 cobblestone` (19:43:47.488Z–19:43:58.973Z). No came-back within 4 s.
- 21:05:32.087Z east (normal3). Then 319 cobblestone, 88 clay_ball, 319 cobblestone (21:05:36.341Z–21:05:48.122Z). No came-back within 4 s.
- 21:11:16.530Z east (normal3). 21:11:19.739Z `Dropped cobbled_deepslate came back into the inventory`.

Came-backs: snowball 19:29:42.193Z and 19:47:30.178Z, andesite 19:55:39.941Z, cobbled_deepslate 21:11:19.739Z and 21:13:00.074Z. One of the three pockets came back. Round 21 was 3 of 3.

### Hard runs

All three started on a confirmed dawn. Furthest rung is the furnace on all three. No hard run held an iron pick. hard1 also crafted a bed (below) and held 4 raw iron.

- hard1 furthest rung is the furnace (301 s; stone pick 181 s, wooden pick 120 s), then a white bed at 481 s that never placed. Sealed at 21:28:42.966Z `(146, 148, -41)` (`11 blocks placed`). 21:28:43.227Z `Night mine: down from the shelter at (146, 148, -41) (tod 12852)`. 21:30:33.142Z `Night mine: could not climb back into (146, 148, -41): No path to the goal!`, then `pillaring up the sump from y=146`, then 21:30:34.366Z `back in the shelter (done; 27 steps, 8 ore items, 4 wall digs)`. Dawn 21:38:01.027Z `tod 12`. The run stops at 21:39:11.948Z with no morning-open line. End kit: stone pick 2, furnace 0, bed 1, raw iron 4, cobble 77, torches 5.
- hard2 furthest rung is the furnace (331 s; stone pick 181 s, wooden pick 90 s). Sealed at 21:49:43.825Z `(158, 141, 29)` (`21 blocks placed`). 21:49:47.192Z `Night mine: down from the shelter at (158, 141, 29) (tod 12619)`. 21:50:00.126Z `could not climb back: Took to long to decide path to goal!`, then `walking the tunnel back by hand from (158, 141, 30)`, then `not back in the shelter (opened onto a cave at 157,138,28; 2 steps, 0 ore items, 0 wall digs)`. Resealed at (158, 141, 30) at 21:50:04.900Z (`7 blocks placed`). Dawn 21:59:17.167Z `tod 19`. Morning 22:00:07.106Z `tod 1019, nearest hostile 17.0`. End kit: furnace 1, stone pick 1, cobble 3, iron ore 0.
- hard3 furthest rung is the furnace (241 s; stone pick 151 s, wooden pick 120 s). The four stone `No path` attempts above are at 22:02, and the stone pick is still the t=151 sample. Sealed at 22:10:41.264Z `(150, 144, -5)` (`14 blocks placed`). 22:11:02.126Z `Night mine: down from the shelter at (150, 144, -5) (tod 12609)`. 22:12:53.488Z `could not climb back: Took to long to decide path to goal!`, then `walking the tunnel back by hand from (149, 144, -4)`, then `not back in the shelter (done; 27 steps, 0 ore items, 0 wall digs)`. Resealed at (149, 144, -4) at 22:13:14.356Z (`21 blocks placed`). A second descent at 22:13:14.617Z `(tod 15249)` timed out at 22:13:41.259Z `Navigation timed out at (149, 144, -3) (onGround true, last path: partial, 1 steps, 2200 nodes)`, then `opened onto a cave at 150,142,-5; 2 steps, 0 ore items, 0 wall digs`. Resealed at (149, 144, -3) at 22:13:48.382Z (`12 blocks placed`). Samples from t=963 to the bell (t=1264) stay at [149, 144, -3], `working: shelter`, cobble 23, furnace 1. Dawn 22:20:32.163Z `tod 9`. The run stops at 22:21:42.958Z with no morning-open line.

### Diamond trips

Four `gather diamond_ore` submits, each `targetY -53`, `strip:true`, count 3: 19:33:01.055Z and 19:47:09.693Z (normal1), 20:15:44.297Z (normal2), 20:55:18.564Z (normal3). Diamonds held 0 on every sample. No `diamond_pickaxe` line. No hard run submitted one. None reached y=-53.

- normal1 walked to y=-44. Lowest sample is [543, -44, 115] at t=2409, step `iron`, diamonds 0. 19:41:54.487Z `Tunnel: mined deepslate_diamond_ore in the wall at 492,-27,76`. No later line names a diamond item, and the samples stay at 0. The second submit is 19:47:09.693Z, during the bag-full clear. From 19:47:48.121Z the deep-dark leave above repeats until 19:52:40.119Z while the bot stands at [503, -35, 77]. The y=-53 strip was not reached. No diamond pick.
- normal2 lowest sample is [198, -23, 10] at t=1685, step `diamond-rung`, diamonds 0. It did not reach y=-53. No diamond pick.
- normal3 lowest sample is [416, -18, 81] at t=1655, step `inventory`, diamonds 0. The run then stands at [454, -1, 151] on the bag-full food craft through the bell, food bar 2. The y=-53 strip was not reached. No diamond pick.

### Bed

Zero `Home set` lines. Zero `Sleeping` lines. Zero `shears` lines. Bed 0 on every normal sample. `no sheep after 3 search legs; bed set aside for 10 min` at 19:32:54.943Z (normal1), 20:26:42.819Z (normal2), 20:55:12.469Z (normal3).

hard1 hunted sheep (21:23:02.900Z `fight` sheep, 21:23:20.026Z `hunt` sheep, both `result=finished`) and submitted `craft white_bed` at 21:25:38.402Z. The bed is the t=481 sample. Placement failed: from 21:28:29.243Z to 21:28:36.714Z the server refused every `place white_bed` (`the block is still air`) at (145, 148, -42), (145, 149, -42), (147, 149, -42), (144, 148, -39), and (144, 149, -41), bot at (146, 148, -41) holding `white_bed`. 21:28:36.714Z `Job: No clear spot to place a white_bed`. 21:28:37.379Z `the night job failed (No clear spot to place a white_bed); sheltering again`. The end inventory still has `bed` 1. It did not sleep.

### Bucket

Zero lines that name `water_bucket`. Buckets were crafted at 19:25:13.250Z (normal1), 20:10:10.963Z (normal2), and 20:49:11.117Z (normal3). normal1 used one at 19:25:27.631Z `(317, 113, 18)` and got `Took to long to decide path to goal!` at 19:25:34.588Z, then a second use at 19:25:34.962Z `(313, 114, 11)` got the empty path at (321, 127, 20), then 19:25:43.009Z `the bucket failed twice; no water fills for 15 min`. normal2's use at 20:31:00.518Z `(206, 30, 73)` is `Job: No path to the goal!` on the next line, with no second failure line and no `water_bucket` line. normal3's uses at 20:49:29.333Z `(317, 113, 18)` and 20:49:30.399Z `(313, 114, 11)` are each `Job: No path to the goal!` immediately, then 20:49:38.436Z `the bucket failed twice; no water fills for 15 min`.

### Other loops

- normal1's deep-dark leave, the same catalyst at (511, -31, 79), 26 times from 19:47:48.121Z to 19:52:40.119Z, while samples stay on [503, -35, 77] from t=1836 to t=2167.
- normal3's bag-full food craft, t=2288 to t=2408 at [454, -1, 151], food bar 2, and the three harness returns from y=117 at the start of that run (t=120, t=150, t=181 all [351, 117, 25], wooden pick already held).
- hard1's white-bed placement, seven refused places in 8 s, then the shelter.
- hard3's sealed stand at [149, 144, -3] from t=963 to t=1264 after the second night mine opened a cave.
- One `LOOP_STALL event loop 787 ms late (keep-alive answers wait behind it)` at 19:59:48.303Z. Zero `LOOP_SLOW`. Zero `Navigation made no progress`. Zero `last path: none`. Zero `swimming up`. Zero `WorldSurvival: drowning`.

### Uncaught

`logs/dashboard-uncaught.log` gained no bytes during the soak (size stayed 2576174). Zero lines in that file carry a timestamp inside 19:13:57Z–22:21:57Z. There is no line to quote from the soak window.

## 2026-10-19 04:07–04:15 IST — units and combat (`edd3b0c`)

`git pull --rebase` needed a stash of local `data/` dumps first (`unstaged changes`). After the stash, origin was already up to date, and the stash was popped. HEAD is `edd3b0c` (`Round 23: place a bed where its head fits, climb out of the deep dark`). The handover for this round is bed placement and the deep-dark climb. It does not ask for an integration run, so this round is units, one combat run, then the soak.

Unit tests, every `tests/*.test.js` except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000 --test-skip-pattern resources`: **569 passed, 0 failed** (41.4 s). The note expected 560; nothing failed.

Services restarted with `AGENT_MODEL=off`. `Stop-Agent.ps1` saved the test world and stopped the services. `Start-Agent.ps1 -NoBrowser` then brought the dashboard up. Supervisor log first line: `model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit`.

`python -u tests/combat_integration.py`, model off, same process as that restart. Exit 0, 306 s (04:10:41–04:15:47 IST, 22:40:41Z–22:45:47Z). `All combat acceptance tests passed`. One run. Damage was measured, so there is no second run.

`4_creeper` (lane): ttk 7.4 s, hits 5, `damage_taken=0`, end health 20, killed, no crater at the spawn, the midpoint, or the bot start. Dashboard: `Combat: pillar-up 2 at 1499,-60,1518 (creeper at 7.1)` at 22:42:40.653Z, then `pillar perched 2 up` at 22:42:41.453Z, then `perch 2 up is inside the fuse ring; knocking the creeper back (at 3.8)` and three `pillar-strike` lines. Fight result at 22:42:47.302Z: `tactic=bow hits=5 shots=0 released=0 landed=0 damage taken=0`.

`4b_creeper_roofed`: ttk 5.3 s, hits 2, `damage_taken=0`, end health 20, killed, no crater at the spawn corner or the arena center. At 22:42:56.087Z `Combat: pillar-up 2 at 1496,-60,1497 (creeper at 7.8)`, then `pillar perched 2 up` at 22:42:56.853Z. Two arrows released (2.97 b/t and 2.99 b/t) and both landed. Fight result at 22:43:00.641Z: `tactic=bow hits=2 shots=2 released=2 landed=2 damage taken=0`.

The witch leg printed `NOTE: witch survived the duel (job failed, lost 0 hp) - recorded as a measured 26.3 limit` and the suite still exited 0. Dashboard at 22:44:08.797Z: `Combat: avoid witch` and `avoid: the witch kites and out-potions the rush`, then 22:44:08.928Z `Job: Fight timed out; witch is still standing`. That is the recorded 26.3 limit, not a suite failure.

The soak is next.


## 2026-10-19 04:17–07:25 IST — dual soak (`467a65e`, bot code `edd3b0c`)

`AGENT_MODEL=off`, one soak, exit 0, 11281 s (04:17:46–07:25:46 IST, 22:47:46Z–01:55:46Z). `SOAK DONE (clean)`, promoted to `data/soak-results.json`. Anchors this seed: hard [142, 131, 31] (canopy light 10), normal [310, 131, 30] (open sky 15). Interventions 2, resumes 1, deaths 1. Six valid runs. The dashboard window used below is 22:47:46Z–01:55:47Z (2719 timestamped lines). The runs are the `Autopilot started` / `Autopilot stopped` pairs: normal1 22:50:54.341Z–23:31:02.348Z (04:20:54–05:01:02 IST), normal2 23:31:14.284Z–00:11:22.474Z (05:01:14–05:41:22 IST), normal3 00:11:34.246Z–00:51:41.807Z (05:41:34–06:21:41 IST), hard1 00:51:56.292Z–01:13:00.130Z (06:21:56–06:43:00 IST), hard2 01:13:11.851Z–01:34:15.562Z (06:43:11–07:04:15 IST; a second `Autopilot started` at 01:28:14.532Z is the resume after the death), hard3 01:34:27.318Z–01:55:30.990Z (07:04:27–07:25:30 IST). After the stop, the flat world was restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, `difficulty=peaceful`, properties written 07:25:48 IST). Supervisor log first line is still `model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit`. No second soak. The combat report commit `467a65e` is docs-only; the bot code is `edd3b0c`.

The wood / stone-pick / furnace / iron-pick columns are the first sample that held the item. **All 6 runs made a wooden pick, a stone pick, and a furnace.** Round 22 (`e1e2f1c` / soak report `eb493c9`) was also 6 of 6, with hard wood 120/90/120, hard stone 181/181/151, hard furnace 301/331/241, and normal iron 391/572/542. This round the hard times are wood 90/120/90, stone 150/211/211, furnace 241/301/361. hard1's furnace is gone at the bell (stone pick still 1), so its end `stone` predicate is no, the same shape as round 22 hard1. hard2's end kit is empty because of the death below, so its end `wood` and `stone` are no; the rung times were already recorded. normal2's end `stone` is no (stone pick 0, stone shovel 0, furnace still 1). All three normal runs still reached an iron pick (round 22 was 391/572/542; this round is 512/572/722). normal2's iron pick was gone at the bell (`iron_pickaxe` 0, `iron_sword` 1). No hard run held an iron pick.

| Run | Wood | Stone pick | Furnace | Iron pick | Torches | Armour worn | Bed | Diamonds | Food | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 211 | 301 | 512 | 17 | 4 at 873 | — | 0 | ate 2 (food min 15) | 0 |
| normal2a2 | 120 | 181 | 241 | 572 | 16 | 2 at 842 | — | 0 | ate 1 (food min 14) | 0 |
| normal3a3 | 90 | 241 | 331 | 722 | 17 | 2 at 903 | — | 0 | ate 1 (food min 13; one eat timed out) | 0 |
| hard1a1 | 90 | 150 | 241 | — | 8 | 0 | — | 0 | not hungry enough (food min 20) | 0 |
| hard2a2 | 120 | 211 | 301 | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 1 |
| hard3a3 | 90 | 211 | 361 | — | 0 | 0 | — | 0 | not hungry enough (food min 20) | 0 |

### Deaths

One death. The soak counter is 1 on hard2 and 0 on the other five. Dashboard: `2026-10-19T01:27:47.571Z Bot died at 116, 123, 12 (killed by zombie)` and `2026-10-19T01:27:47.574Z Bot died; inspect the world before resuming`. No `drowned`, `slain`, `burned`, or `obliterated` line. The terminal then printed `operator: resumed the ladder after death 1`.

The 30 s before that (01:27:17Z–01:27:47Z) is the shelter being rebuilt while a creeper at 5.6–6.0 keeps preempting it. The spine, quoted:

- 01:27:12.090Z `Shelter: sealed at (126, 131, 28) (24 blocks placed)` then 01:27:12.353Z `Night mine: down from the shelter at (126, 131, 28) (tod 16952)`.
- 01:27:28.356Z `Reflex: creeper at 6.0 overrides the shelter hold` and `Night: knocked off the pillar`, then `Reflex: fleeing creeper (never melee a creeper)`.
- 01:27:28.563Z `Shelter: moved from 126,131,28 to (126, 129, 28); building a new box here`.
- 01:27:30.764Z `Autopilot: the night job cancelled (Reflex: preempted by Mob Defense); sheltering again`.
- 01:27:36.853Z `Shelter: moved from 123,128,25 to (121, 126, 23)`.
- 01:27:38.361Z `Reflex: night crowd (3 hostiles); pillaring up instead of fleeing` and `Night: caught outside in a crowd; pillar-up 3 at 121,126,23`. 01:27:38.661Z `Night: pillar-up failed (left the column at 0/3; rose 1.41, 1 clicks, holding cobblestone, on grass_block, airborne)`.
- 01:27:39.166Z through 01:27:43.265Z the box moves again: `(120, 126, 20)`, `(120, 126, 19)`, `(120, 126, 18)`, `(120, 124, 18)`, `(119, 124, 15)`, `(118, 124, 14)`, `(118, 123, 14)`. Between each move the same pair repeats: `Reflex: creeper at 5.7–6.0 overrides the shelter hold` / `Job: Reflex: preempted by Mob Defense`.
- 01:27:46.111Z `Reflex: creeper fuse (swell 1) sprinting past 7`.
- 01:27:47.571Z `Bot died at 116, 123, 12 (killed by zombie)`.

The death message names a zombie. The 30 s of log names the creeper. After the resume the bot seals at `(101, 128, -8)` at 01:28:52.063Z (`19 blocks placed`) with an empty inventory, and samples from t=933 to the bell (t=1264) stay at [101, 128, -8], `working: shelter`, food bar 20, saturation 3. Dawn 01:33:04.944Z `tod 12`. The run stops at 01:34:15.562Z with no morning-open line.

### Bed

Zero `craft white_bed` lines. Zero `place white_bed` lines. Zero `Home set` lines. Zero `Sleeping` lines. Bed 0 on every sample, including the hard runs. Round 22 hard1 crafted a white bed at 481 s; every place was refused (`the block is still air`); no Home set; no sleep. This round never got as far as a place, so the new foot/head placement was not exercised.

- normal1 23:03:20.691Z `craft shears`. 23:20:17.241Z `no sheep after 3 search legs; bed set aside for 10 min`.
- normal2 23:47:48.134Z `no sheep after 3 search legs; bed set aside for 10 min`. Later slot lists still hold `black_wool:1` (first at 00:01:38.378Z, still there at 00:09:16.044Z). No bed craft after that wool.
- normal3 00:41:35.753Z `no sheep after 3 search legs; bed set aside for 10 min`.
- hard1 hunted sheep and both fights finished, and still no bed item. 00:58:32.683Z `fight` sheep, result 00:58:45.665Z `Fight result: sheep tactic=melee hits=3 ... result=finished`. 00:59:20.176Z `hunt` sheep, result 00:59:25.754Z `Fight result: sheep tactic=melee hits=3 ... result=finished`. End inventory `bed` 0.
- hard3 01:42:33.561Z `hunt` sheep, then 01:44:03.610Z `Job: Hunt timed out fighting sheep`.

### Deep dark

One refusal, on normal2. It did not repeat. Round 22 normal1 repeated `leaving (warden)` 26 times in about 5 min on the same sculk catalyst after mining one deepslate diamond ore at y=-27.

- 23:58:36.531Z `Job: Tunnel stopped: deep dark (sculk_sensor at (420, -52, 87))`.
- 23:58:37.136Z `Autopilot: deep dark - climbing out; diamond trips set aside for 20 min`.
- 23:58:40.079Z `Ascend: path up stopped (No path to the goal!)`.
- 23:58:40.079Z `Ascend: y=-24 -> -18 (surface 96)`.

No second `deep dark` line, no second `Ascend:` line, and zero `warden` lines. The lowest normal2 sample is [413, -42, 90] at t=1625. The next sample (t=1655) is [413, -12, 120], and from t=1685 to t=2167 the bot stays near y=-9 to y=-7. Diamonds held stay 0. The climb stopped 114 blocks under the surface it named, and the y=-53 strip was not mined.

### Trying without it

485 lines, `Navigation: no path with mob avoidance at (...); trying without it`, in 309 bursts. Round 22 was 608 lines in 307 bursts. Line counts: normal1 66, normal2 27, normal3 46, hard1 201, hard2 118, hard3 27.

Four bursts are 8 lines or longer, all under a minute:

- hard1, 15 lines at (143, 125, 33), 00:55:13.312Z–00:55:50.767Z. The same second is `Could not climb back up the tunnel: No path to the goal!`. The furnace is still the t=241 sample (about 00:55:57).
- hard1, 99 lines at (131, 143, -15), 00:56:32.672Z–00:57:29.206Z. The next line is 00:57:29.673Z `Completed gather`. The retry reached the gather.
- hard2, 19 lines at (134, 133, 34), 01:13:31.493Z–01:13:41.392Z, and 18 lines at (135, 135, 31), 01:14:02.462Z–01:14:11.752Z. Both are in the first 90 s. The wooden pick is the t=120 sample, the stone pick t=211, the furnace t=301.

### Boxed in

Zero `Boxed in` lines. Nothing was dug as a stair-out. Round 22 had four lines, all `no way to stair out`, zero steps dug.

### Empty path

`empty path` lines: normal1 5, normal2 0, normal3 4, hard1 1, hard2 0, hard3 0. Round 22 was 5/4/1/0/0/0. Every one this round is `Left the furnace`, and every search visited 83–440 nodes. None visited 1–2 nodes. No cell repeats for minutes.

- 23:06:49.259Z at (351, 62, 92), `partial, 0 steps, 241 nodes`.
- 23:08:32.443Z at (361, 54, 89), `partial, 0 steps, 196 nodes`.
- 23:24:51.368Z at (406, 22, 102), `partial, 0 steps, 233 nodes`.
- 23:26:24.155Z and 23:27:22.644Z at (404, 35, 103), `noPath, 0 steps, 83 nodes` then `98 nodes`.
- 00:19:19.217Z at (255, 128, 51), `partial, 0 steps, 233 nodes`.
- 00:19:46.178Z, 00:23:18.237Z, 00:26:03.096Z at (254, 127, 52), `partial, 0 steps, 248 / 440 / 236 nodes`.
- 01:00:46.090Z at (131, 143, -49), `partial, 0 steps, 268 nodes`.

### Cannot reach

33 gather attempts (66 lines with the skip twin). **Zero say `walk ok`.** Round 22 was also zero `walk ok`.

- spruce_log 1, normal1, 22:51:15.061Z `(331, 131, 29)`, `walk: Navigation left the surface at (321, 126, 33)`, 10.9 from the eye. The wooden pick is still the t=90 sample.
- The other normal1 attempts are navigation timeouts on the way down (354,59 / 364,45 / 406,8–9 / 408,15–27), 8 attempts.
- hard1 2. One `The goal was changed before it could be completed!` at (130, 143, -48). One timeout at (136, 134, -51).
- hard2 stone 12, 01:16:31.445Z–01:16:42.680Z, all `walk: No path to the goal!`, bot at (137, 128, 31), 11.6–13.2 from the eye. The stone pick is still the t=211 sample.
- hard3 stone 10, 01:36:24.730Z–01:36:32.888Z, the same `No path` clause, bot at (127, 127, 27), 16.0–18.3 from the eye. The stone pick is still the t=211 sample.

### Silverfish

Zero `silverfish`, `Silverfish`, and `endermite` lines.

### Full bag

`Inventory nearly full` is 19 job lines. No `waiting: bag full` sample. `the bag is full; no crafting for 5 min, clearing junk first` is 20 lines, all on normal1 (23:06:49.604Z–23:29:31.782Z) and normal2 (00:01:38.639Z–00:09:24.092Z). `No room for crafting result` is once, 23:27:31.290Z, immediately before one of the normal1 clears.

Each quoted slot list:

- 23:06:49.260Z `cobblestone:3 dirt:2 stone_pickaxe:2 iron_ingot:1 spruce_planks:1 cooked_beef:1 spruce_sapling:1 cooked_porkchop:1 spruce_log:1 wooden_pickaxe:1`
- 23:07:18.472Z `cobblestone:2 dirt:2 stone_pickaxe:2 iron_ingot:1 spruce_planks:1 cooked_beef:1 spruce_sapling:1 cooked_porkchop:1 spruce_log:1 wooden_pickaxe:1`
- 23:12:36.483Z `cobblestone:5 dirt:2 stone_shovel:1 spruce_planks:1 coal:1 spruce_sapling:1 cooked_porkchop:1 wooden_pickaxe:1 wooden_axe:1 leather:1`
- 23:17:22.919Z `cobblestone:3 andesite:2 stone_pickaxe:2 dirt:2 iron_ingot:1 coal:1 spruce_sapling:1 cooked_porkchop:1 wooden_pickaxe:1 wooden_axe:1`
- 23:17:39.134Z `andesite:2 cobblestone:2 stone_pickaxe:2 dirt:2 iron_ingot:1 coal:1 spruce_sapling:1 cooked_porkchop:1 wooden_pickaxe:1 wooden_axe:1`
- 23:18:16.434Z `cobblestone:4 andesite:2 stone_pickaxe:2 iron_ingot:1 coal:1 spruce_sapling:1 cooked_porkchop:1 wooden_pickaxe:1 wooden_axe:1 leather:1`
- 23:19:42.676Z `cobblestone:4 dirt:2 stone_pickaxe:2 iron_ingot:1 coal:1 spruce_sapling:1 cooked_porkchop:1 andesite:1 wooden_pickaxe:1 wooden_axe:1`
- 23:20:37.378Z `stone_pickaxe:2 cobblestone:2 andesite:1 dirt:1 coal:1 spruce_sapling:1 cooked_porkchop:1 moss_block:1 wooden_pickaxe:1 wooden_axe:1`
- 23:22:05.976Z `clay_ball:2 cobblestone:2 stone_pickaxe:2 dirt:1 coal:1 spruce_sapling:1 cooked_porkchop:1 moss_block:1 wooden_pickaxe:1 wooden_axe:1`
- 23:28:23.622Z `cobblestone:2 stone_pickaxe:2 iron_shovel:1 spruce_sapling:1 coal:1 iron_ingot:1 moss_block:1 wooden_pickaxe:1 wooden_axe:1 leather:1`
- 23:29:27.871Z `cobblestone:4 stone_pickaxe:2 iron_shovel:1 spruce_sapling:1 coal:1 iron_ingot:1 moss_block:1 wooden_pickaxe:1 wooden_axe:1 leather:1`
- 00:01:38.378Z `cobblestone:3 cobbled_deepslate:2 furnace:1 wooden_sword:1 leather:1 clay_ball:1 raw_iron:1 wooden_axe:1 dirt:1 black_wool:1`
- 00:01:58.884Z `clay_ball:2 cobbled_deepslate:2 furnace:1 wooden_sword:1 leather:1 raw_iron:1 wooden_axe:1 dirt:1 black_wool:1 cooked_porkchop:1`
- 00:02:18.043Z `cobblestone:3 cobbled_deepslate:2 furnace:1 wooden_sword:1 leather:1 raw_iron:1 wooden_axe:1 dirt:1 black_wool:1 cooked_porkchop:1`
- 00:06:40.241Z `cobbled_deepslate:4 clay_ball:2 furnace:1 wooden_sword:1 leather:1 raw_iron:1 wooden_axe:1 water_bucket:1 black_wool:1 cooked_porkchop:1`
- 00:08:02.654Z, 00:08:11.495Z, and 00:08:51.792Z `clay_ball:2 cobblestone:2 cobbled_deepslate:2 furnace:1 wooden_sword:1 leather:1 raw_iron:1 wooden_axe:1 water_bucket:1 black_wool:1`
- 00:09:16.044Z `cobblestone:2 cobbled_deepslate:2 furnace:1 wooden_sword:1 leather:1 clay_ball:1 raw_iron:1 wooden_axe:1 water_bucket:1 black_wool:1`

Clay, a second stone pick, leather, moss, and `black_wool:1` are still in those lists. `water_bucket:1` is in the normal2 lists from 00:06:40.241Z on.

Drops that completed:

- normal1: 46 dirt, 2 cobblestone, 2 spruce_sapling, 2 cobblestone, 79 cobblestone, 66 dirt, 79 cobblestone, 66 dirt, 87 cobblestone, 66 dirt, 216 cobblestone, 78 dirt, 216 cobblestone, 99 andesite, 129 cobblestone, 99 andesite, 159 cobblestone, 74 dirt, 35 andesite, 92 clay_ball, 51 cobblestone, 132 cobblestone, 44 clay_ball, 13 granite, 7 andesite, 2 spruce_sapling, 2 gravel, 2 diorite, 44 clay_ball, 129 cobblestone, 129 cobblestone, 44 clay_ball.
- normal2: 69 cobblestone, 56 clay_ball, 106 cobblestone, 77 cobbled_deepslate, 106 cobblestone, 106 cobblestone, 124 clay_ball, 106 cobblestone, 124 clay_ball, 106 cobblestone, 124 clay_ball, 106 cobblestone, 64 clay_ball, 63 andesite, 48 cobbled_deepslate, 11 diorite, 7 dirt, 48 cobbled_deepslate, 64 clay_ball, 53 cobbled_deepslate.
- normal3: 34 dirt, 46 dirt, 177 cobblestone, 64 clay_ball, 177 cobblestone.

Pockets:

- 23:17:34.909Z east (normal1). 23:17:38.760Z `Dropped cobblestone came back into the inventory` (3.9 s).
- 23:17:56.475Z east (normal1). The next came-back is dirt at 23:18:16.231Z (20 s), so not within 4 s.
- 00:40:53.759Z east (normal3). Then 177 cobblestone, 64 clay_ball, 177 cobblestone (00:40:57.660Z–00:41:07.726Z). No came-back after that pocket.

Came-backs, all ten: cobblestone 23:17:38.760Z and 23:43:38.931Z, dirt 23:18:16.231Z, andesite 23:20:03.182Z, clay_ball 23:20:56.810Z, cobbled_deepslate 00:06:44.660Z, clay_ball 00:08:51.232Z, 00:09:03.084Z, and 00:09:11.115Z, diorite 00:09:39.400Z. One of the three pockets came back within 4 s. Round 22 was also 1 of 3.

### Hard runs

All three started on a confirmed dawn. Furthest rung is the furnace on all three. No hard run held an iron pick.

- hard1 furthest rung is the furnace (241 s; stone pick 150 s, wooden pick 90 s). The 99-line avoidance retry above ends at `Completed gather`. Sealed at 01:01:50.364Z `(138, 133, -51)` (`3 blocks placed`). 01:02:18.997Z `Night mine: down from the shelter at (138, 133, -51) (tod 12604)`. 01:04:24.411Z `could not climb back into (138, 133, -51): No path to the goal!`, then `walking the tunnel back by hand from (137, 132, -49)`, then `not back in the shelter (done; 27 steps, 8 ore items, 6 wall digs)`. Resealed at (137, 132, -49) at 01:04:34.301Z (`14 blocks placed`). Dawn 01:11:48.991Z `tod 4`. Morning 01:12:39.006Z `tod 1004, nearest hostile 19.8`. End kit: stone pick 1, furnace 0, bed 0, raw iron 9, cobble 158, torches 5. The furnace is gone at the bell, as in round 22 hard1.
- hard2 furthest rung is the furnace (301 s; stone pick 211 s, wooden pick 120 s). The twelve stone `No path` attempts above are at 01:16, and the stone pick is still the t=211 sample. Sealed at 01:23:16.270Z `(132, 125, 29)` (`15 blocks placed`). 01:23:34.920Z `Night mine: down from the shelter at (132, 125, 29) (tod 12612)`. 01:25:35.744Z `could not climb back: Navigation timed out at (126, 128, 28)`, then `not back in the shelter (done; 27 steps, 4 ore items, 3 wall digs)`. Resealed at (126, 131, 28) at 01:27:12.090Z (`24 blocks placed`). A second descent at 01:27:12.353Z `(tod 16952)` is the death above. After the resume, samples stay at [101, 128, -8] with an empty inventory through the bell. Dawn 01:33:04.944Z `tod 12`. No morning-open line.
- hard3 furthest rung is the furnace (361 s; stone pick 211 s, wooden pick 90 s). The ten stone `No path` attempts above are at 01:36, and the stone pick is still the t=211 sample. Sealed at 01:45:57.939Z `(126, 134, 1)` (`22 blocks placed`). 01:45:58.202Z `Night mine: down from the shelter at (126, 134, 1) (tod 13963)`. 01:46:15.080Z `climb back failed: No path to the goal!`. 01:46:29.537Z `could not climb back: Took to long to decide path to goal!`, then `opened onto a cave at 122,132,3; 2 steps, 0 ore items, 0 wall digs`. Resealed at (127, 134, 1) at 01:46:37.640Z (`12 blocks placed`). Dawn 01:54:19.862Z `tod 3`. The run stops at 01:55:30.990Z with no morning-open line. End kit: furnace 1, stone pick 1, cobble 0, iron ore 0.

### Diamond trips

Three `gather diamond_ore` submits, each `targetY -53`, `strip:true`, count 3: 23:09:58.084Z (normal1), 23:49:30.233Z (normal2), 00:30:42.483Z (normal3). Diamonds held 0 on every sample. No `diamond_pickaxe` line. No line names a diamond ore block mined. No hard run submitted one. None reached a sample at y=-53.

- normal1's lowest sample on that rung is [382, 28, 93] at t=1264, then it is back on stone/iron at y=45. The run's lowest sample overall is [367, -1, 93] at t=1775, step `bed-rung`, diamonds 0. The y=-53 strip was not reached. No diamond pick.
- normal2's lowest sample is [413, -42, 90] at t=1625, diamonds 0. The tunnel stop names a sculk sensor at y=-52 (above). The ascend then stopped at y=-18. No diamond pick.
- normal3's lowest sample is [222, -50, 154] at t=1745, step `diamond-rung`, diamonds 0. The next sample (t=1776) is `stone` `working: craft` at [220, -48, 154]. It did not reach y=-53. No diamond pick. From t=1836 to the bell (t=2407) it stands at [220, -45, 147], `waiting: Misc World Survival Chain` (the drowning loop below).

### Bucket

Buckets were crafted at 23:01:18.150Z (normal1), 23:43:23.293Z (normal2), and 00:26:07.541Z (normal3). Each use ended `Completed use`: 23:03:49.103Z `(353, 68, 87)` completed 23:03:57.930Z; 23:48:06.522Z `(418, 70, 64)` completed 23:49:00.659Z; 00:29:46.633Z `(254, 62, 131)` completed 00:29:55.159Z. There is no `the bucket failed twice` line. Round 22's uses failed on `No path` or a path timeout and never logged `water_bucket`.

normal2's slot lists name `water_bucket:1` from 00:06:40.241Z through 00:09:16.044Z. normal1 and normal3 never log the words `water_bucket`. normal3, after its completed use, hits lava: 00:42:01.652Z and 00:42:01.703Z `Bucket-into-lava skipped: No ground below to pour against`, then 00:42:02.714Z `WorldSurvival: dousing (onFire true, lavaWindow true)`.

### Food

No `Health or food is low` line and no `Health below` line. Lowest food bar in the samples: normal1 15, normal2 14, normal3 13, hard runs 20. Meals: normal1 ate 2 (bar 15..20), normal2 ate 1 (bar 14..20), normal3 ate 1 (bar 13..20) and one eat failed (`23 failed: Promise timed out. (2 tries)`). Hard runs: not hungry enough, food min 20. hard2's saturation is 3 after the death while the food bar stays 20.

### Other loops

- normal3's drowning stand. 00:42:01.646Z `Reflex: Misc World Survival Chain engaging`, then the lava-bucket skip above, then `WorldSurvival: drowning (air ...), swimming up` from 00:42:13.860Z through 00:51:30.561Z (about 9.3 min, air bouncing between 10 and 400). Samples from t=1836 to t=2407 stay at [220, -45, 147], food 16 down to 13, diamonds 0. The run ends there. Round 22 had zero `swimming up` and zero `WorldSurvival: drowning`.
- hard2's shelter-move cascade and the empty stand at [101, 128, -8] from t=933 to t=1264 after the zombie death.
- hard1's 99-line avoidance retry at (131, 143, -15), 57 s, then `Completed gather`.
- normal2's deep-dark climb, one shot, stopped at y=-18 with the surface named as 96.
- Place refusals that are not a bed: 22:56:14.262Z `place furnace` at (316, 87, 70) `the block is still air`; 23:44:50.146Z and 23:46:00.750Z `place crafting_table` at (388, 96, 71) `the block is still air`; 00:59:26.560Z `place furnace` at (129, 143, -48) `the block is still air`. The furnace rung still landed on every run.
- One harness return: `operator: returned the bot from y=119` during normal1. Zero `LOOP_STALL`. Zero `LOOP_SLOW`. Zero `Navigation made no progress`.

### Uncaught

`logs/dashboard-uncaught.log` gained no bytes during the soak (size stayed 2576174, the same size round 22 reported). Zero lines in that file carry a timestamp inside 22:47:46Z–01:55:47Z. There is no line to quote from the soak window.
