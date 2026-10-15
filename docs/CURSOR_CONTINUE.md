# Handover to Cursor: continue BuilderBot (GLM hit its usage limit)

You are continuing work another agent (GLM in ZCode) was doing on this project. Claude supervises and reviews. Work in `D:\Usefu Shi\Epic\SGSMP\minecraft-agent\` on this Windows PC (run locally, not in the cloud).

## Read first
`AGENTS.md`, `README.md`, `docs/RESEARCH_FIXES.md` (current priorities, with sources), `docs/ALTOCLEF_PORT_SPEC.md`, `docs/TASK_API.md` (binding contract incl. "Async actions"), `docs/COMBAT_SPEC.md`. The bot is Mineflayer 4.39.0 on a Paper 26.3 test server through ViaBackwards (client protocol 1.21.4), with a ported AltoClef task system (`src/tasks`, `src/chains`), combat (`src/combat.js`, `src/chains/fightTask.js`), and the autopilot ladder (`src/autopilot.js`).

## Hard rules (non-negotiable)
- NEVER kill processes by name (no `Get-Process java|node|python | Stop-Process`, no `taskkill /IM`). This killed the user's other servers and their control panel (see LOCAL_RULES.md) before. Only stop this project's processes: `Stop-Agent.ps1` / supervisor `/stop`, PIDs in `data/processes.json`, or a PID on a project port (8765, 8766, 8081, 25569) after confirming its command line runs from inside `minecraft-agent`.
- Memory: every node test/script runs with `--max-old-space-size=2048`, `node --test` also with `--test-timeout=60000`; never run anything without a timeout. Earlier leaks reached 100+ GB and crashed one of the user's other servers. A guard stops any minecraft-agent node process above 4 GB.
- Never touch the user's other servers, tools or folders (listed in `LOCAL_RULES.md`, kept out of git); `reference/` is read-only source.
- The test server (`test-server/`, port 25569) listens on the LAN (`server-ip=0.0.0.0`); keep it that way. The user may join as SG-1 (op, spectator): never kick, teleport, change gamemode of, or target players with `@a/@p`; selectors must carry a `type=` filter.
- No new dependencies without a strong reason; never install the third-party 26.3 mineflayer fork.
- Every bot job must verify results from real game state; never report success without evidence. Report failures honestly.

## Where the work stands (checked by Claude at 14:46 on 2026-10-13)
- All `src` files compile; unit tests: 154/154 pass under the memory flags.
- Done but NOT yet verified in game: `tests/soak.py` now sets `advance_time`/`advance_weather` and verifies each rule back (research item 1); `src/forcefield.js` legit force field wired into `src/worker.js` (research item 3); creeper changes in `src/combat.js`; updated `tests/combat_integration.py`.
- Last full in-game suite pass: 2026-10-12 15:00 (45 groups) - before these changes.
- Survival soak history: never a reliable wooden pickaxe yet. Latest valid insight: deaths come from skeletons/zombies in dark oak forest shade; a sticks/craft-stall bug was fixed; the 06:20 soak was invalid (time/weather not confirmed).
- Still open from `docs/RESEARCH_FIXES.md`: item 2 (work from open-sky spots, sky light >= 12, before gathering), item 4 (pathfinder `entitiesToAvoid` + `exclusionAreasStep` mob cost while unarmed; stuck watchdog), item 5 (creeper arena damage ~16.8 -> keep beyond ~7 blocks / break line of sight when fusing), enderman 2-high roof (0/20 samples).

## Do, in order
1. Start the services (`Start-Agent.cmd`) and run the full integration suite (`python tests/integration.py`); fix regressions from the force field / creeper / soak changes until green.
2. Run `tests/combat_integration.py`; confirm the force field does not double-swing with FightTask and that creeper damage drops.
3. Implement research items 2 and 4 (and the enderman roof if cheap), with unit tests.
4. Run the dual soak (`tests/soak.py`, normal + hard, 3 runs each). The run must refuse to start unless the rules and daylight/clear weather are confirmed. Report per run: logs, planks, sticks, table, wooden pickaxe (and time), deaths with cause and time of day, interventions.
5. Write `docs/HANDOVER_FROM_CURSOR.md`: what you changed (files), test outputs, soak table, open issues - so GLM can continue after its limit resets. Then stop.

Keep edits small and in the existing code style (ES modules, compact). Do not refactor the architecture.
