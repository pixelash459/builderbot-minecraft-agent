# Cursor (Fable 5.1): take full ownership of BuilderBot (Claude, 2026-10-14 00:50)

You are the same Cursor chat that did rounds 1 and 2 (see `docs/HANDOVER_FROM_CURSOR.md`). You now own the project end to end. GLM (a weaker model) has been stopped mid-task; Claude supervises and reviews. You have a large budget: work long and autonomously, and aim well above what GLM could do. Think like a strong Minecraft speedrunner and a senior engineer at once.

## The goal
BuilderBot should play survival on the user's behalf like a competent human: start with nothing, reliably reach wood tools -> stone kit + furnace -> food -> iron gear + torches -> bed/shelter -> diamonds, survive nights and mobs, explore freely, and obtain requested items, all verified from real game state. Today it reliably fails at step 1 (wooden pickaxe: 1 of 6 soak runs).

## Hard rules (unchanged, non-negotiable)
- Never kill processes by name. Stop only via `Stop-Agent.ps1`/supervisor `/stop`, PIDs in `data/processes.json`, or a PID on a project port (8765, 8766, 8081, 25569) after verifying its command line is inside `minecraft-agent`.
- Every node run: `--max-old-space-size=2048`; `node --test` also `--test-timeout=60000`; everything has a timeout. A guard kills minecraft-agent node processes above 4 GB.
- **Memory is tight: the user games on this PC.** Do NOT start the local model (llama-server on 8081); tests and soaks do not need it. A guard stops it while the game runs.
- Never touch the user's other servers, tools or folders (listed in `LOCAL_RULES.md`, kept out of git); `reference/` is read-only source.
- Test server (`test-server/`, 25569) stays `server-ip=0.0.0.0`. SG-1 may spectate: never kick/teleport/gamemode/target players; every `@e` selector has a `type=` filter; no `@a`/`@p`.
- Never run two soaks at once. Do not run `tests/resources.test.js` until its unbounded growth is fixed (that fix is in scope; add a bounded-heap test).
- No new dependencies without a strong reason; never install the third-party 26.3 mineflayer fork.
- Report honestly with evidence from game state. Never claim success without it.

## Where things stand (Claude, 00:50)
- GLM's work since your round 2 (uncommitted, unreviewed; review it first and keep what is right): `src/autopilot.js`, `src/combat.js`, `src/place-support.js`, `src/crafting.js` (window-close-reopen retry for "destination full"), `src/worker.js` (collect approach range), `src/schema.js`, `src/chains/fallbackTasks.js`, `src/chains/worldSurvivalChain.js`, `src/tasks/movement/escape-from-lava-task.js` (A4 lava fix), tests `chains.test.js`, `combat.test.js`, `place-support.test.js`, `safety.test.js`, `trackers-movement.test.js`, `integration.py`, plus probes `tests/a4-probe.py`, `tests/placement-repro.py`. GLM reported unit tests 168/168 and A4 solved.
- **An integration run GLM started may still be running** (`python tests/integration.py`, output `integration-run.log`). Let it finish (it writes `data/integration-results.json`) before you restart services or start another live test.
- Open issues: table placement on real terrain ("No clear spot to place a crafting_table", 8-15 failures per soak run; see `docs/RESEARCH_FIXES.md` 22:20 for the Voyager/ADAM approach); the bot leaves the surface during explore; normal anchor grove on steep terrain; creeper damage 17.7 (fuse metadata [16] arrives too late: use distance discipline, knockback + back-off at an angle, or the bow); enderman 2-high roof 0/20; witch avoid; `resources.test.js` growth.
- Specs: `AGENTS.md`, `docs/AUTONOMY_SPEC.md`, `docs/COMBAT_SPEC.md` (7f: never fight unarmed), `docs/ALTOCLEF_PORT_SPEC.md`, `docs/TASK_API.md`, `docs/RESEARCH_FIXES.md`, `docs/GLM_NEXT.md` (the task GLM was on).

## How to work
- Use web search for current, version-correct fixes (Minecraft 26.x / Paper 26.3 behaviour, mineflayer and pathfinder issues, how strong bots like AltoClef/Voyager/ADAM/Mindcraft solve each problem) instead of trial and error; cite sources in your handover.
- You may refactor where it clearly removes a root cause (e.g. a unified, robust block-placement primitive; a surface/terrain-aware gathering planner), but keep the API/MCP job JSON stable and every existing test green.
- Measure with the dual soak (normal + hard, 3 runs each, seed 12345) and the integration and combat suites. Fix root causes found in the run data (`data/soak-results-*.json` jobs/samples), then measure again. Iterate.
- Every few hours, and at the end, append a dated section to `docs/HANDOVER_FROM_CURSOR.md`: files changed, test outputs, the soak table (wooden-pickaxe and stone-pickaxe time per run, failure counts by message), and open issues, so Claude can review and GLM can take over later.

## Milestones, in order
1. Integration suite green with GLM's changes reviewed.
2. Wooden pickaxe in >= 5 of 6 soak runs, with 0 "No clear spot" failures.
3. Stone pickaxe + furnace in >= 4 of 6 runs; no deaths in normal mode.
4. Food and the first night survived in hard mode; creeper arena damage < 10.
5. Iron tools, then onwards up the ladder as far as you can take it.
