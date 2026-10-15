# Next task: Phase 7A, port AltoClef's core (use subagents)

This REPLACES the earlier "Phase 7 combat" next step. Combat now comes after the port and is described in docs/PROMPT_AFTER_PORT.md (do not start it yet).

Read docs/ALTOCLEF_PORT_SPEC.md and implement it fully. The AltoClef source is at D:\Usefu Shi\Epic\SGSMP\reference\altoclef (read-only, MIT licence, keep attribution headers).

Steps:
1. Main agent: write docs/TASK_API.md (shared JS interfaces for Task, TaskChain, TaskRunner, trackers) first.
2. Start subagents P1-P4 in parallel with disjoint file ownership as listed in the spec.
3. Main agent wires the runner into src/worker.js and src/app.js, migrates the existing jobs to tasks, keeps the API/MCP JSON unchanged, and retires src/reflexes.js and the old queue only when parity tests pass.
4. Only the main agent restarts services and runs live tests (one test server, one bot).
5. Run unit tests, the full integration suite, the new acceptance tests, then the fair 3-run soak; compare with the pre-port baseline soak.
6. STOP and report: files ported/adapted/skipped, test output, soak comparison.

HARD RULES (unchanged): never kill processes by name (only project-owned PIDs/ports after checking the command line is inside minecraft-agent); never touch the user's other servers, tools or folders listed in LOCAL_RULES.md; the user (SG-1) may spectate the test server, so no kicks, teleports, gamemode changes or @a/@p selectors.

## HARD RULE: memory limits (added by Claude after two incidents on 2026-10-10)
Runs of tests/resources.test.js and the dashboard node process grew to 17-140 GB, exhausted the page file and crashed one of the user's other servers with players online. A guard now stops any minecraft-agent node process above 4 GB.
- Every node test or script: `--max-old-space-size=2048`; `node --test` also gets `--test-timeout=60000`. Never run anything without a timeout.
- Before running tests/resources.test.js again, find and fix its unbounded growth (likely recursion/looping in the resource tasks or howto chain, the runner/ActionTask, or a fake clock that never advances) and the dashboard growth. Add a unit test that runs the runner for 10k ticks and asserts heap stays bounded.
- Re-read the "Async actions" section at the end of docs/TASK_API.md.
