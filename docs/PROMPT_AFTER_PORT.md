# After the AltoClef port: Phase 7 combat (use subagents)

Build combat ON the ported task system: the per-mob tactics, combat primitives and section 7f "when not to fight" belong in the ported MobDefenseChain and as tasks, not in src/reflexes.js (which the port retires). Adjust file ownership below accordingly (src/chains/mob_defense.js instead of src/reflexes.js).

Implement docs/COMBAT_SPEC.md fully. Read it first. Same parallel-work rules as before:
- Each subagent owns specific files and edits ONLY those; never two subagents on one file.
- Only the main agent restarts services and runs live tests (one test server, one bot, so live tests are sequential).
- Subagents may run unit tests and read anything, and return: files changed, unit test output, open questions.
- Measure every mechanic on this server (26.3 via ViaBackwards, protocol 1.21.4) before relying on it.

## Work split
**Subagent C: combat primitives (owns a new src/combat.js and tests/combat.test.js)**
Attack cooldown from the held item's attack speed; falling-crit timing (jump, strike on the way down, not sprinting, not in water/ladder, 2 blocks headroom); sprint-knockback with sprint reset; back-pedal spacing; sweep attacks; shield raise/lower around the cooldown; incoming projectile detection (projectile entities whose velocity points at the bot); ballistic bow aim with gravity and target lead (check mineflayer-hawkeye compatibility with mineflayer 4.39 first; pin it if used, else implement the maths); target priority (creeper close > skeleton/witch with line of sight > nearest melee); per-mob tactic selection from the spec's table and available gear. Pure functions wherever possible, so they are unit tested with fake bots.

**Subagent D: gear (owns src/autopilot.js, src/howto.js and their unit tests)**
Make the bot craft and keep: best-tier sword and axe, shield, bow, arrows (flint from gravel, feathers from chickens, string from spiders), full armour of the best available tier, replacement before durability runs out. Add these to the autopilot ladder at the right tiers using the existing obtain chain.

**Subagent E: arena tests (owns a new tests/combat_integration.py)**
The enclosed arena fixtures and the measured tests listed in COMBAT_SPEC.md 7e (normal difficulty and doMobSpawning false during tests, restored afterwards), recording time to kill, hits, crits, damage taken and blocked arrows, plus the baseline comparison with the old attack loop. Write the script; the main agent runs it.

**Main agent**
1. Start C, D and E in parallel.
2. When C returns, wire combat.js into the fight job (style auto/melee/bow) and the threat reflex in src/worker.js and src/reflexes.js (the main agent owns these two files in this phase), keeping the pathfinder ownership rules from the previous task.
3. Restart services, run unit tests, the existing integration suite, then tests/combat_integration.py. Fix failures (delegate file-scoped fixes back to the owning subagent where possible).
4. STOP and report with measured numbers: per mob, time to kill, damage taken, crits vs non-crits, blocked arrows, and the baseline comparison.

Same restrictions: never touch the user's other servers, tools or folders listed in LOCAL_RULES.md; the user (SG-1) may spectate on the test server, so no kicks, teleports, gamemode changes or @a/@p selectors.

## HARD RULE: never kill processes by name
A cleanup that killed every java/node/python process by name took down the user's other servers and their control panel (see LOCAL_RULES.md) (forced, unsaved). NEVER kill processes by name — in scripts, inline, or in subagent code. Only stop processes this project started: Stop-Agent.cmd / the supervisor's /stop, PIDs from minecraft-agent/data/processes.json, or a PID from a project-owned port (8765, 8766, 8081, 25569) after confirming that PID's command line runs from inside D:\Usefu Shi\Epic\SGSMP\minecraft-agent.

## HARD RULE: memory limits (added by Claude after two incidents on 2026-10-10)
Runs of tests/resources.test.js and the dashboard node process grew to 17-140 GB, exhausted the page file and crashed one of the user's other servers with players online. A guard now stops any minecraft-agent node process above 4 GB.
- Every node test or script: `--max-old-space-size=2048`; `node --test` also gets `--test-timeout=60000`. Never run anything without a timeout.
- Before running tests/resources.test.js again, find and fix its unbounded growth (likely recursion/looping in the resource tasks or howto chain, the runner/ActionTask, or a fake clock that never advances) and the dashboard growth. Add a unit test that runs the runner for 10k ticks and asserts heap stays bounded.
- Re-read the "Async actions" section at the end of docs/TASK_API.md.
