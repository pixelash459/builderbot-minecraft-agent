# Current task: reflex control race + fair soak (use subagents)

State when you were stopped: all src files compile, 32/32 unit tests pass, the creeper assertion is back at 8.0, any-species wood is done in the autopilot ladder. The pathfinder ownership fix below is NOT applied yet. The full integration suite last passed at 2026-10-10 11:05 (45 groups), before the later reflex changes.

## How to work: subagents
Use your subagent / parallel task feature so independent work runs at the same time. Rules that keep parallel work safe:
- Each subagent owns specific files and edits ONLY those. Two subagents must never edit the same file.
- Only the main agent restarts services (Stop-Agent / Start-Agent) and runs live tests (tests/integration.py, tests/soak.py, creeper-check.py), one at a time. There is one test server and one bot, so live tests can never run in parallel.
- Subagents may run unit tests (node --test tests/*.test.js) and read anything.
- Each subagent returns a short summary: files changed, unit test output, open questions.

## Work split
**Subagent A: pathfinder ownership (owns src/worker.js, src/reflexes.js, a new tests/ownership.test.js)**
Root cause (confirmed): when a hostile appears, the reflex calls worker.stop() and immediately starts its own pathfinder goto while the interrupted job is still unwinding. The job's finally blocks (exploreLeg: setGoal(null)/stop()/setMovements(previous); navigate: setGoal(null)/clearControlStates; pump: clearControlStates) run after the reflex took over and cancel the reflex's goal ("The goal was changed before it could be completed"); exploreLeg's own hostile watcher can reject at the same moment. Fix:
1. A single control owner token: a job captures the owner/epoch at start; every job-side cleanup touches the pathfinder, control states or movements ONLY if it still owns control.
2. withControl awaits the interrupted job's run promise settling (exposed by the worker, max ~2 s timeout) before the reflex moves, then takes ownership; when the reflex finishes it releases ownership before resuming jobs.
3. setMovements is restored only by the current owner.
4. Unit test with a fake bot that interleaves a job cleanup with a reflex goto and proves the reflex goal survives.

**Subagent B: fair soak (owns tests/soak.py, tests/soak_run.py)**
Before every run, also reset vitals so each run starts equal: full health and food (for example `effect give BuilderBot minecraft:instant_health 1 10 true`, `effect give BuilderBot minecraft:saturation 1 20 true`, then `effect clear BuilderBot`), and confirm health 20 and food 20 from /api/observe before starting the clock. Record peak milestones during the run (first time the wooden pickaxe, crafting table, cobblestone, stone pickaxe and furnace appear, and peak counts), not only the final inventory, since a late death empties it. Keep all existing fairness rules (dawn, clear weather, cleared inventory, fixed spawn, logged interventions).

**Main agent**
1. Start A and B in parallel. While they work, read the integration log from the last failing run to have the creeper/zombie flee evidence ready.
2. When both return: review their diffs, restart services, run creeper-check.py, then the full integration suite (all groups must pass, creeper threshold 8.0).
3. Then run the 3-run soak and report every run from data/soak-results*.json: peak milestones, deaths, interventions, stuck points, per-job evidence.
4. STOP and report: files changed by each subagent, unit and integration output, the 3 soak runs.

Never touch the user's other servers, tools or folders listed in LOCAL_RULES.md. The user (SG-1) may be connected to the test server as a spectator: do not kick, teleport or change their gamemode, and do not use @a/@p selectors.

## HARD RULE: never kill processes by name
A cleanup that killed every java/node/python process by name took down the user's other servers and their control panel (see LOCAL_RULES.md) (forced, unsaved). NEVER kill processes by name — in scripts, inline, or in subagent code. Only stop processes this project started: Stop-Agent.cmd / the supervisor's /stop, PIDs from minecraft-agent/data/processes.json, or a PID from a project-owned port (8765, 8766, 8081, 25569) after confirming that PID's command line runs from inside D:\Usefu Shi\Epic\SGSMP\minecraft-agent.
